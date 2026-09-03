/* oxlint-disable react/immutability -- R3F 帧循环内 mutate 为标准模式 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, terrainSurfaceY } from './terrainUtil'
import { skyState } from './lightState'
import { getRotorTips } from './rotorShadowBus'

// ============================================================================
// 确定性接地投影（第 31 轮重构：叶片投影与真实叶片严格同步）
//  · 背景：第 29/30 轮的叶片影用手写简化三角函数，与 HoloTurbine 真实变换链
//    （coneDeg/spinOffset/-tilt/yaw=π-yawDeg/spinRef 自 0 累积）不一致且相位不同步，
//    用户判「风机阴影形态不正确，叶片投影有问题」。
//  · 本轮方案：HoloTurbine 每帧用 three 真实矩阵把 3 个叶尖世界坐标写入 rotorShadowBus；
//    本组件读取后做【物理正确的地面投影】：
//       shadow = P - t·sunDir，t = (P.y - groundY)/sunDir.y（太阳在 y>0 时）
//       → 影子沿太阳水平反方向延伸（真实光照几何），长度随太阳高度自然变化。
//  · 组件构成（每台风机）：
//    1) 接地暗盘（contact disc）：始终锚定塔基，给接地感，正午也有；
//    2) 塔影带（tower streak）：沿 -sun.xz 方向的软渐变影带，长度随太阳高度；
//    3) 叶片投影 ×3：基于总线叶尖世界坐标 → 贴地面投影，形态/方向/长度与真实叶片一致。
//  · 白天可见、夜晚淡出；都关闭深度测试/深度写入 + 抬高 y 避免 z-fighting。
// ============================================================================

const SHADOW_COLOR = new THREE.Color('#08101e')
const DEBUG_SHADOW = typeof location !== 'undefined' && new URLSearchParams(location.search).has('shadowdebug')
if (DEBUG_SHADOW) SHADOW_COLOR.set('#ff4444') // 调试：亮红验证叶片影网格位置

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
    const lengthAlpha = Math.pow(1 - v, 1.35)
    const wFactor = 1 - v * 0.55
    for (let x = 0; x < W; x++) {
      const u = (x / (W - 1) - 0.5) * 2
      const absU = Math.abs(u)
      let a = 0
      if (absU <= wFactor) {
        const wn = absU / wFactor
        a = Math.pow(1 - wn, 2.2) * lengthAlpha
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

let sharedStreak: THREE.CanvasTexture | null = null
let sharedDisc: THREE.CanvasTexture | null = null
function getSharedTextures() {
  if (typeof document === 'undefined') return { streak: null as unknown as THREE.CanvasTexture, disc: null as unknown as THREE.CanvasTexture }
  if (!sharedStreak) sharedStreak = makeStreakTexture()
  if (!sharedDisc) sharedDisc = makeDiscTexture()
  return { streak: sharedStreak, disc: sharedDisc }
}

/** 地面世界点：把世界坐标 P 沿 -sun 投影到 y=g 平面（物理正确）。 */
function projectToGround(P: THREE.Vector3, sun: THREE.Vector3, g: number, out: THREE.Vector3): THREE.Vector3 {
  const t = (P.y - g) / sun.y // sun.y>0 时为正
  return out.set(P.x - t * sun.x, g, P.z - t * sun.z)
}

function GroundShadow({ x, z, y, idx }: { x: number; z: number; y: number; idx: number }) {
  const discRef = useRef<THREE.Mesh>(null!)
  const discMatRef = useRef<THREE.MeshBasicMaterial>(null!)
  const towerRef = useRef<THREE.Mesh>(null!)
  const towerMatRef = useRef<THREE.MeshBasicMaterial>(null!)
  const bladeRefs = [useRef<THREE.Mesh>(null!), useRef<THREE.Mesh>(null!), useRef<THREE.Mesh>(null!)]
  const bladeMatRefs = [
    useRef<THREE.MeshBasicMaterial>(null!),
    useRef<THREE.MeshBasicMaterial>(null!),
    useRef<THREE.MeshBasicMaterial>(null!),
  ]

  const { discGeo, towerGeo, bladeGeo, streakTex, discTex } = useMemo(() => {
    const { streak, disc } = getSharedTextures()
    const dg = new THREE.CircleGeometry(1, 48)
    // 塔影带：单位平面，沿本地 +Y 从根部(0)延伸。
    const tg = new THREE.PlaneGeometry(16, 1)
    tg.translate(0, 0.5, 0)
    // 叶片影：更窄的条带（叶片本身薄）沿本地 +Y。
    const bg = new THREE.PlaneGeometry(5, 1)
    bg.translate(0, 0.5, 0)
    return { discGeo: dg, towerGeo: tg, bladeGeo: bg, streakTex: streak, discTex: disc }
  }, [])

  const _sun = useMemo(() => new THREE.Vector3(), [])
  const _hubProj = useMemo(() => new THREE.Vector3(), [])
  const _tipProj = useMemo(() => new THREE.Vector3(), [])
  const _dir = useMemo(() => new THREE.Vector3(), [])
  const _right = useMemo(() => new THREE.Vector3(), [])
  const _up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const _basis = useMemo(() => new THREE.Matrix4(), [])

  // 把「铺平在地面、长轴指向 dir、法向朝上」的朝向写入 mesh（无欧拉歧义）。
  // 几何已 translate(0,+0.5,0)，故本地 +Y 为长轴。world = right/long/normal basis。
  const orientFlat = (mesh: THREE.Mesh, dirX: number, dirZ: number) => {
    const len = Math.hypot(dirX, dirZ)
    if (len < 1e-4) { _dir.set(0, 0, 1); _right.set(1, 0, 0) } else { _dir.set(dirX / len, 0, dirZ / len); _right.crossVectors(_up, _dir) }
    // 长轴(本地+Y) → _dir；法向(本地+Z) → 上；右(本地+X) → _right
    _basis.makeBasis(_right, _dir, _up)
    mesh.quaternion.setFromRotationMatrix(_basis)
  }

  useFrame(() => {
    const dayF = skyState.dayF
    const sun = skyState.sunDir
    const visible = dayF > 0.05
    if (!visible) return
    if (discRef.current) discRef.current.visible = true
    if (towerRef.current) towerRef.current.visible = true
    bladeRefs.forEach((b) => { if (b.current) b.current.visible = true })

    _sun.copy(sun)
    const sy = _sun.y
    if (sy < 0.02) return
    const sinEl = Math.max(0, Math.min(1, sy))
    const lowBoost = (1 - sinEl) * 0.4
    const dayOp = dayF * (0.62 + lowBoost)

    // —— 接地暗盘 ——
    if (discMatRef.current) discMatRef.current.opacity = dayF * 0.8
    // —— 塔影带：沿 -sun.xz 方向，长度随太阳高度 ——
    const len = Math.max(30, Math.min(180, 40 + 150 * Math.pow(1 - sinEl, 1.3)))
    const sxz = Math.hypot(_sun.x, _sun.z)
    if (sxz > 1e-4) {
      const g = terrainSurfaceY(x, z)
      // 塔顶(世界)投影到地面
      const towerTopWorld = _hubProj.set(x, y + 90, z)
      projectToGround(towerTopWorld, _sun, g, _tipProj)
      const dx = _tipProj.x - x, dz = _tipProj.z - z
      const shadowLen = Math.hypot(dx, dz)
      const clampLen = Math.min(shadowLen * 0.7, len)
      if (towerRef.current) {
        towerRef.current.visible = true
        towerRef.current.position.set(0, 0.7, 0)
        orientFlat(towerRef.current, dx, dz)
        towerRef.current.scale.set(1, Math.max(20, clampLen), 1)
      }
      if (towerMatRef.current) towerMatRef.current.opacity = dayOp * 0.5
    }

    // —— 叶片投影 ×3：读取总线真实世界坐标 → 贴地投影 ——
    const tipSet = getRotorTips(idx)
    if (tipSet) {
      const g = terrainSurfaceY(x, z)
      const hub = tipSet.hub
      projectToGround(hub, _sun, g, _hubProj)
      for (let i = 0; i < 3; i++) {
        projectToGround(tipSet.tips[i], _sun, g, _tipProj)
        _dir.set(_tipProj.x - _hubProj.x, 0, _tipProj.z - _hubProj.z)
        const bLen = Math.hypot(_dir.x, _dir.z)
        const mesh = bladeRefs[i].current
        if (mesh) {
          if (bLen < 2) { mesh.visible = false; continue }
          mesh.visible = true
          // 位置：以 hub 投影为根部，用组内局部坐标（组已定位在 (x,y,z)）
          mesh.position.set(_hubProj.x - x, 0.6 + i * 0.01, _hubProj.z - z)
          orientFlat(mesh, _dir.x, _dir.z)
          mesh.scale.set(1, Math.min(bLen, 150), 1)
        }
        const mat = bladeMatRefs[i].current
        if (mat) mat.opacity = dayOp * 0.6
      }
    }
  })

  return (
    <group position={[x, y, z]}>
      <mesh
        ref={discRef}
        geometry={discGeo}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.5, 0]}
        scale={[18, 18, 1]}
        renderOrder={6}
        frustumCulled={false}
      >
        <meshBasicMaterial
          ref={discMatRef}
          color={SHADOW_COLOR}
          map={discTex ?? undefined}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          fog={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        ref={towerRef}
        geometry={towerGeo}
        position={[0, 0.7, 0]}
        renderOrder={8}
        frustumCulled={false}
      >
        <meshBasicMaterial
          ref={towerMatRef}
          color={SHADOW_COLOR}
          map={streakTex ?? undefined}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          fog={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh
          key={`blade-${i}`}
          ref={bladeRefs[i]}
          geometry={bladeGeo}
          renderOrder={9 + i}
          frustumCulled={false}
        >
          <meshBasicMaterial
            ref={bladeMatRefs[i]}
            color={SHADOW_COLOR}
            map={streakTex ?? undefined}
            transparent
            opacity={0}
            depthWrite={false}
            depthTest={false}
            fog={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  )
}

export default function GroundShadows() {
  // 调试开关：?noshadow 关闭接地投影（用于排除法定位暗斑来源）
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('noshadow')) return null
  return (
    <group>
      {FARM.map((u, i) => (
        <GroundShadow key={`gs-${u.id}`} idx={i} x={u.x} z={u.z} y={terrainSurfaceY(u.x, u.z)} />
      ))}
    </group>
  )
}
