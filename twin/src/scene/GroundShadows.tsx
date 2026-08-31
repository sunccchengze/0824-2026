/* oxlint-disable react/immutability -- R3F 帧循环内 mutate 为标准模式 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, terrainSurfaceY } from './terrainUtil'
import { skyState } from './lightState'

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
      d[idx] = 0
      d[idx + 1] = 0
      d[idx + 2] = 0
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
  // 中心最暗，向外快速衰减，边缘完全透明
  g.addColorStop(0, 'rgba(0,0,0,0.95)')
  g.addColorStop(0.28, 'rgba(0,0,0,0.55)')
  g.addColorStop(0.55, 'rgba(0,0,0,0.18)')
  g.addColorStop(0.82, 'rgba(0,0,0,0.04)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.NoColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  return tex
}

// 共享纹理（模块级单例，client only）
let sharedStreak: THREE.CanvasTexture | null = null
let sharedDisc: THREE.CanvasTexture | null = null
function getSharedTextures() {
  if (typeof document === 'undefined') return { streak: null as unknown as THREE.CanvasTexture, disc: null as unknown as THREE.CanvasTexture }
  if (!sharedStreak) sharedStreak = makeStreakTexture()
  if (!sharedDisc) sharedDisc = makeDiscTexture()
  return { streak: sharedStreak, disc: sharedDisc }
}

function GroundShadow({ x, z, y }: { x: number; z: number; y: number }) {
  const outerRef = useRef<THREE.Group>(null!)
  const streakRef = useRef<THREE.Mesh>(null!)
  const streakMatRef = useRef<THREE.MeshBasicMaterial>(null!)
  const discMatRef = useRef<THREE.MeshBasicMaterial>(null!)

  const { streakGeo, discGeo, streakTex, discTex } = useMemo(() => {
    const { streak, disc } = getSharedTextures()
    const sg = new THREE.PlaneGeometry(16, 1)
    sg.translate(0, 0.5, 0) // 根部在原点，延伸 +Y
    const dg = new THREE.CircleGeometry(1, 48)
    return { streakGeo: sg, discGeo: dg, streakTex: streak, discTex: disc }
  }, [])

  // 初始材质
  const streakMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
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

  const discMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
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

  useFrame(() => {
    const dayF = skyState.dayF
    const sun = skyState.sunDir
    // 夜晚淡出：dayF<0.05 完全隐藏，避免黑夜里出现黑块
    const visible = dayF > 0.05
    if (outerRef.current) outerRef.current.visible = visible
    if (!visible) return

    // 太阳地面投影
    const sx = sun.x
    const sz = sun.z
    const sy = sun.y
    const groundLen = Math.hypot(sx, sz)
    if (groundLen < 1e-4) return

    // 方向角：atan2(sx, sz) 推导见文件头注释
    const angle = Math.atan2(sx, sz)

    if (outerRef.current) outerRef.current.rotation.y = angle

    // 太阳高度
    const sinEl = Math.max(0, Math.min(1, sy))
    // 长度：38 + 130*(1 - sinEl)^1.35，晨昏 ~168m，正午 ~38m
    const len = 38 + 130 * Math.pow(1 - sinEl, 1.35)
    const clampedLen = Math.max(32, Math.min(175, len))

    // 透明度：正午也有，晨昏更浓
    const lowBoost = (1 - sinEl) * 0.32
    const op = dayF * (0.42 + lowBoost) // 正午 0.42，晨昏 ~0.74，乘 dayF
    const discOp = dayF * 0.55

    if (streakRef.current) {
      streakRef.current.scale.set(1, clampedLen, 1)
    }
    if (streakMatRef.current) {
      streakMatRef.current.opacity = op
    }
    if (discMatRef.current) {
      discMatRef.current.opacity = discOp
    }
  })

  return (
    <group ref={outerRef} position={[x, y, z]}>
      {/* 接地圆盘：塔基锚点，正午也可见 */}
      <mesh
        geometry={discGeo}
        material={discMat}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.55, 0]}
        scale={[14, 14, 1]}
        renderOrder={9}
      >
        <primitive object={discMat} ref={discMatRef} attach="material" />
      </mesh>
      {/* 定向影带 */}
      <group>
        <mesh
          ref={streakRef}
          geometry={streakGeo}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.75, 0]}
          renderOrder={8}
        >
          <primitive object={streakMat} ref={streakMatRef} attach="material" />
        </mesh>
      </group>
    </group>
  )
}

export default function GroundShadows() {
  return (
    <group>
      {FARM.map((u) => (
        <GroundShadow key={`gs-${u.id}`} x={u.x} z={u.z} y={terrainSurfaceY(u.x, u.z)} />
      ))}
    </group>
  )
}
