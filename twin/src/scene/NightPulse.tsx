/* oxlint-disable react/immutability -- R3F frame loop mutate */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, SUBSTATION, terrainSurfaceY } from './terrainUtil'
import { skyState } from './lightState'

// ============================================================================
// 夜间地面微光脉动（B2 夜晚生机）
//  · 每台风机基座 + 升压站周围，放置一个 Additive 的柔边圆盘，
//    仅夜间可见，随时间呼吸，模拟设备运行/地面积蓄能量/远处灯火；
//  · 克制：颜色冰青单色相，不引入新色相，亮度低，范围小；
//  · 与 GroundShadows 互补：影子是白天压暗，脉动是夜晚提亮；
// ============================================================================

function makePulseTexture(): THREE.CanvasTexture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(120,220,255,0.85)')
  g.addColorStop(0.22, 'rgba(80,180,220,0.35)')
  g.addColorStop(0.5, 'rgba(40,120,180,0.12)')
  g.addColorStop(0.8, 'rgba(20,60,100,0.02)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.NoColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  return tex
}

let sharedPulse: THREE.CanvasTexture | null = null
function getPulseTex() {
  if (typeof document === 'undefined') return null as unknown as THREE.CanvasTexture
  if (!sharedPulse) sharedPulse = makePulseTexture()
  return sharedPulse
}

function Pulse({ x, z, y, phase, scaleBase }: { x: number; z: number; y: number; phase: number; scaleBase: number }) {
  const meshRef = useRef<THREE.Mesh>(null!)
  const matRef = useRef<THREE.MeshBasicMaterial>(null!)

  const { geo, tex } = useMemo(() => {
    const g = new THREE.CircleGeometry(1, 32)
    return { geo: g, tex: getPulseTex() }
  }, [])

  const mat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      map: tex ?? undefined,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
  }, [tex])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const dayF = skyState.dayF
    const night = 1 - dayF
    if (night < 0.05) {
      if (meshRef.current) meshRef.current.visible = false
      return
    }
    if (meshRef.current) meshRef.current.visible = true
    const breathe = 0.5 + 0.5 * Math.sin(t * 0.8 + phase)
    const slow = 0.5 + 0.5 * Math.sin(t * 0.22 + phase * 1.3)
    const s = scaleBase * (0.85 + 0.35 * breathe) * (0.9 + 0.2 * slow)
    if (meshRef.current) meshRef.current.scale.setScalar(s)
    if (matRef.current) {
      matRef.current.opacity = night * (0.18 + 0.32 * breathe) * (0.7 + 0.3 * slow)
    }
  })

  return (
    <mesh
      ref={meshRef}
      geometry={geo}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[x, y + 0.65, z]}
      renderOrder={11}
    >
      <primitive object={mat} ref={matRef} attach="material" />
    </mesh>
  )
}

export default function NightPulse() {
  return (
    <group>
      {FARM.map((u, i) => (
        <Pulse key={`np-${u.id}`} x={u.x} z={u.z} y={terrainSurfaceY(u.x, u.z)} phase={i * 1.7} scaleBase={18 + (i % 3) * 3} />
      ))}
      {/* 升压站额外两处光斑 */}
      <Pulse x={SUBSTATION.x} z={SUBSTATION.z} y={terrainSurfaceY(SUBSTATION.x, SUBSTATION.z)} phase={9.4} scaleBase={28} />
      <Pulse x={SUBSTATION.x - 22} z={SUBSTATION.z + 18} y={terrainSurfaceY(SUBSTATION.x - 22, SUBSTATION.z + 18)} phase={10.1} scaleBase={16} />
    </group>
  )
}
