/* oxlint-disable react/immutability -- R3F 帧循环内 mutate 为标准模式 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, terrainSurfaceY } from './terrainUtil'
import { skyState } from './lightState'
import { getFarmFrame } from './frameBus'
import { TURBINE_SPEC } from './turbine/geometry'

const HUB_Y = TURBINE_SPEC.hubY
const BLADE_LEN = TURBINE_SPEC.bladeLen
const TILT_DEG = TURBINE_SPEC.tiltDeg
const D2R = THREE.MathUtils.degToRad
const TILT_RAD = D2R(TILT_DEG)
const COS_TILT = Math.cos(TILT_RAD)
const SIN_TILT = Math.sin(TILT_RAD)

// ============================================================================
// 确定性接地投影（3A 白天影子）
//  · 根因：真实阴影贴图在自定义地形 shader + 强补光下对比度不可靠，
//    且正午时太阳高度大、真实投影短，用户要求“任何角度都能看到”
//  · 方案：每台风机下放两层贴地暗化：
//    1) 接地圆盘（contact disc）：半径 ~14m，始终在塔基，锚定接地感，
//       正午也有；
//    2) 定向影带（streak）：沿太阳反方向延伸，长度随太阳高度变化，
//       晨昏长、正午短但保留最小可见长度，带软边渐变纹理；
//  · 实现要点：
//    - 共享 CanvasTexture（streak 64×256、disc 128×128），黑底 alpha 渐变，
//      MeshBasicMaterial 透明混合（src 黑 × alpha + dst×(1-alpha)）= 压暗；
//    - depthTest:false + depthWrite:false + renderOrder 保证不被地形起伏遮挡，
//      同时 y 抬高 0.6~0.9m 避免与能量环 z-fighting；
//    - 方向：atan2(sunDir.x, sunDir.z)（推导见注释），外层 group Y 旋转，
//      内层 mesh X -90° 铺平，Y 缩放 = 长度；
//    - 白天可见、夜晚淡出：opacity = dayF × (base + lowSunBoost)，dayF<0.05 隐藏；
//    - 长度：elDeg 0→54°，length = 38 + 130×(1 - sinEl)^1.35，
//      最小 32m（正午仍可见），最大 ~168m（晨昏），在场区压平带内起伏小；
// ============================================================================

function makeStreakTexture(): THREE.CanvasTexture {
  const W = 64
  const H = 256
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(W, H)
  const d = img.data
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1) // 0=root, 1=tip
    const lengthAlpha = Math.pow(1 - v, 1.35) // 根部实、尖部虚
    const wFactor = 1 - v * 0.55 // 尖部收窄
    for (let x = 0; x < W; x++) {
      const u = (x / (W - 1) - 0.5) * 2 // -1..1
      const absU = Math.abs(u)
      let a = 0
      if (absU <= wFactor) {
        const wn = absU / wFactor
        const widthAlpha = Math.pow(1 - wn, 2.2)
        a = widthAlpha * lengthAlpha
        // 根部 0-15% 再加一点实度，让塔基处更明显
        if (v < 0.15) a *= 0.85 + 0.15 * (1 - v / 0.15)
      }
      const idx = (y * W + x) * 4
      d[idx] = 255
      d[idx + 1] = 255
      d[idx + 2] = 255
      d[idx + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.NoColorSpace
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

function makeDiscTexture(): THREE.CanvasTexture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  // 中心最暗，向外快速衰减，边缘完全透明 - 用白色+alpha，由材质 color 着色为深蓝黑
  g.addColorStop(0, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.28, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.18)')
  g.addColorStop(0.82, 'rgba(255,255,255,0.04)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.NoColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  return tex
}

const SHADOW_COLOR = new THREE.Color('#08101e')

// 共享纹理（模块级单例，client only）
let sharedStreak: THREE.CanvasTexture | null = null
let sharedDisc: THREE.CanvasTexture | null = null
function getSharedTextures() {
  if (typeof document === 'undefined') return { streak: null as unknown as THREE.CanvasTexture, disc: null as unknown as THREE.CanvasTexture }
  if (!sharedStreak) sharedStreak = makeStreakTexture()
  if (!sharedDisc) sharedDisc = makeDiscTexture()
  return { streak: sharedStreak, disc: sharedDisc }
}

function GroundShadow({ x, z, y, idx }: { x: number; z: number; y: number; idx: number }) {
  const outerRef = useRef<THREE.Group>(null!)
  const bladeRootRef = useRef<THREE.Group>(null!)
  const streakRef = useRef<THREE.Mesh>(null!)
  const softRef = useRef<THREE.Mesh>(null!)
  const discRef = useRef<THREE.Mesh>(null!)
  const discOuterRef = useRef<THREE.Mesh>(null!)
  const streakMatRef = useRef<THREE.MeshBasicMaterial>(null!)
  const softMatRef = useRef<THREE.MeshBasicMaterial>(null!)
  const discMatRef = useRef<THREE.MeshBasicMaterial>(null!)
  const discOuterMatRef = useRef<THREE.MeshBasicMaterial>(null!)
  const spinRef = useRef<number>(idx * 1.91)
  const bladeRefs = [useRef<THREE.Mesh>(null!), useRef<THREE.Mesh>(null!), useRef<THREE.Mesh>(null!)]
  const bladeMatRefs = [
    useRef<THREE.MeshBasicMaterial>(null!),
    useRef<THREE.MeshBasicMaterial>(null!),
    useRef<THREE.MeshBasicMaterial>(null!),
  ]

  const { streakGeo, discGeo, softGeo, bladeGeo, streakTex, discTex } = useMemo(() => {
    const { streak, disc } = getSharedTextures()
    const sg = new THREE.PlaneGeometry(14, 1)
    sg.translate(0, 0.5, 0) // 根部在原点，延伸 +Y
    const soft = new THREE.PlaneGeometry(28, 1)
    soft.translate(0, 0.5, 0)
    const bg = new THREE.PlaneGeometry(4.8, 1)
    bg.translate(0, 0.5, 0)
    const dg = new THREE.CircleGeometry(1, 48)
    return { streakGeo: sg, softGeo: soft, bladeGeo: bg, discGeo: dg, streakTex: streak, discTex: disc }
  }, [])

  // 初始材质 - 用深蓝黑而非纯黑，混合后色相可辨，3A 更明显
  const streakMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: SHADOW_COLOR,
      map: streakTex ?? undefined,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
  }, [streakTex])

  const softMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: SHADOW_COLOR,
      map: streakTex ?? undefined,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
  }, [streakTex])

  const discMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: SHADOW_COLOR,
      map: discTex ?? undefined,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
  }, [discTex])

  const discOuterMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: SHADOW_COLOR,
      map: discTex ?? undefined,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
  }, [discTex])

  const bladeMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: SHADOW_COLOR,
      map: streakTex ?? undefined,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
  }, [streakTex])

  const bladeMats = useMemo(() => {
    return [0, 1, 2].map(
      () =>
        new THREE.MeshBasicMaterial({
          color: SHADOW_COLOR,
          map: streakTex ?? undefined,
          transparent: true,
          opacity: 0.52,
          depthWrite: false,
          depthTest: false,
          fog: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
    )
  }, [streakTex])

  useFrame((_, dt) => {
    const dayF = skyState.dayF
    const sun = skyState.sunDir
    const visible = dayF > 0.05
    if (outerRef.current) outerRef.current.visible = visible
    if (bladeRootRef.current) bladeRootRef.current.visible = visible
    if (!visible) return

    const sx = sun.x
    const sz = sun.z
    const sy = sun.y
    const groundLen = Math.hypot(sx, sz)
    if (groundLen < 1e-4 || sy < 0.02) return

    const angle = Math.atan2(sx, sz)
    if (outerRef.current) outerRef.current.rotation.y = angle

    const sinEl = Math.max(0, Math.min(1, sy))
    const len = 38 + 130 * Math.pow(1 - sinEl, 1.35)
    const clampedLen = Math.max(32, Math.min(175, len))
    const lowBoost = (1 - sinEl) * 0.35
    const op = dayF * (0.62 + lowBoost)
    const softOp = dayF * (0.28 + lowBoost * 0.65)
    const discOp = dayF * 0.78

    if (streakRef.current) streakRef.current.scale.set(1, clampedLen, 1)
    if (softRef.current) softRef.current.scale.set(1, clampedLen * 1.08, 1)
    if (streakMatRef.current) streakMatRef.current.opacity = op
    if (softMatRef.current) softMatRef.current.opacity = softOp
    if (discMatRef.current) discMatRef.current.opacity = discOp
    if (discOuterMatRef.current) discOuterMatRef.current.opacity = discOp * 0.42

    // —— 叶片投影（3 叶片）——
    const frame = getFarmFrame()
    const unit = frame?.units[idx]
    const yawDeg = unit?.yawDeg ?? 0
    const rpm = unit?.rpm ?? 0
    const yawRad = D2R(yawDeg)
    const cosYaw = Math.cos(yawRad)
    const sinYaw = Math.sin(yawRad)

    // 转子自转累积（与 HoloTurbine 同口径：rpm * PI/30 rad/s，负方向）
    if (rpm > 0.1) {
      spinRef.current -= dt * ((rpm * Math.PI) / 30)
    }

    // 轮毂投影到地面：t = HUB_Y / sy
    const tHub = HUB_Y / sy
    const hubShadowX = -sx * tHub
    const hubShadowZ = -sz * tHub
    // 叶片阴影透明度：随太阳高度与 dayF，晨昏更浓
    const bladeBaseOp = dayF * (0.52 + lowBoost * 0.5)

    for (let i = 0; i < 3; i++) {
      const bAngle = spinRef.current + (i * Math.PI * 2) / 3
      const sinA = Math.sin(bAngle)
      const cosA = Math.cos(bAngle)
      // 叶片局部：(x = -L sin, y = L cos)
      const xLocal = -BLADE_LEN * sinA
      const yLocal = BLADE_LEN * cosA
      // 倾角 5°：绕 X 旋转
      const yTilt = yLocal * COS_TILT
      const zTilt = yLocal * SIN_TILT
      // 偏航：绕 Y 旋转
      const xWorldOff = xLocal * cosYaw + zTilt * sinYaw
      const zWorldOff = -xLocal * sinYaw + zTilt * cosYaw
      const yWorldOff = yTilt

      const tipY = HUB_Y + yWorldOff
      if (tipY <= 0.5) {
        // 叶片指向地下，隐藏该叶片影
        const mr = bladeRefs[i].current
        if (mr) mr.visible = false
        continue
      }
      const tTip = tipY / sy
      const tipShadowX = xWorldOff - sx * tTip
      const tipShadowZ = zWorldOff - sz * tTip
      const dx = tipShadowX - hubShadowX
      const dz = tipShadowZ - hubShadowZ
      const bLen = Math.hypot(dx, dz)
      if (bLen < 2) {
        const mr = bladeRefs[i].current
        if (mr) mr.visible = false
        continue
      }
      const clampedBLen = Math.min(bLen, 140)
      const bAngleWorld = Math.atan2(dx, dz)

      const mesh = bladeRefs[i].current
      if (mesh) {
        mesh.visible = true
        // 位置：轮毂影子 + 微抬，避免 z-fighting，3 叶片错层 0.015m
        mesh.position.set(hubShadowX, 0.82 + i * 0.018, hubShadowZ)
        mesh.rotation.set(-Math.PI / 2, 0, 0)
        // 先绕 Y 旋转到阴影方向，再缩放长度
        // 由于几何已 translate(0,0.5,0) 且 X -90°，Y 缩放 = 沿本地 Z 延伸，Y 旋转可定向
        mesh.rotation.y = bAngleWorld
        // 为了让旋转生效，需要把 X 旋转与 Y 旋转组合：我们用 rotation.set 时 X=-90°, Y=bAngleWorld 会被覆盖？
        // three 的 Euler 默认 XYZ，先 X 后 Y，所以设置 X=-90°, Y=bAngleWorld, Z=0 即可
        mesh.rotation.set(-Math.PI / 2, bAngleWorld, 0)
        mesh.scale.set(1, clampedBLen, 1)
      }
      const mat = bladeMatRefs[i].current
      if (mat) {
        // 叶片朝向太阳时影子更淡（点积），侧向时更浓
        const facing = Math.abs(Math.cos(bAngle)) // 简化：叶片垂直时影子更实
        mat.opacity = bladeBaseOp * (0.55 + 0.55 * facing)
      }
    }
  })

  return (
    <group position={[x, y, z]}>
      <group ref={outerRef}>
        <mesh
          ref={discOuterRef}
          geometry={discGeo}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.42, 0]}
          scale={[34, 34, 1]}
          renderOrder={6}
        >
          <primitive object={discOuterMat} ref={discOuterMatRef} attach="material" />
        </mesh>
        <mesh
          ref={discRef}
          geometry={discGeo}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.55, 0]}
          scale={[18, 18, 1]}
          renderOrder={9}
        >
          <primitive object={discMat} ref={discMatRef} attach="material" />
        </mesh>
        <mesh
          ref={softRef}
          geometry={softGeo}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.65, 0]}
          renderOrder={7}
        >
          <primitive object={softMat} ref={softMatRef} attach="material" />
        </mesh>
        <mesh
          ref={streakRef}
          geometry={streakGeo}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.78, 0]}
          renderOrder={8}
        >
          <primitive object={streakMat} ref={streakMatRef} attach="material" />
        </mesh>
      </group>
      {/* 叶片投影根：不随 outerRef 旋转，世界坐标直接计算 */}
      <group ref={bladeRootRef}>
        {[0, 1, 2].map((i) => (
          <mesh
            key={`blade-${i}`}
            ref={bladeRefs[i]}
            geometry={bladeGeo}
            renderOrder={10 + i}
          >
            <primitive object={bladeMats[i]} ref={bladeMatRefs[i]} attach="material" />
          </mesh>
        ))}
        {/* 兼容旧引用，保留 bladeMat 单例以防未使用 */}
        <mesh geometry={bladeGeo} visible={false}>
          <primitive object={bladeMat} attach="material" />
        </mesh>
      </group>
    </group>
  )
}

export default function GroundShadows() {
  return (
    <group>
      {FARM.map((u, i) => (
        <GroundShadow key={`gs-${u.id}`} idx={i} x={u.x} z={u.z} y={terrainSurfaceY(u.x, u.z)} />
      ))}
    </group>
  )
}
