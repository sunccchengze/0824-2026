import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// HDR 冰青自发光材质（Bloom 由其拾取 → 选择性辉光）
const C_BODY = new THREE.Color(0.26, 1.06, 1.62)
const C_EDGE = new THREE.Color(0.5, 1.75, 2.25)

function useHoloMats() {
  return useMemo(() => {
    const solid = new THREE.MeshBasicMaterial({ color: C_BODY, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
    const wire = new THREE.MeshBasicMaterial({ color: C_EDGE, wireframe: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    const core = new THREE.MeshBasicMaterial({ color: C_EDGE, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    const pillar = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.1, 1.7), transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
    return { solid, wire, core, pillar }
  }, [])
}

function HoloTurbine({ position, speed, yaw = 0, mats }: { position: [number, number, number]; speed: number; yaw?: number; mats: ReturnType<typeof useHoloMats> }) {
  const rotor = useRef<THREE.Group>(null!)
  useFrame((_, dt) => { if (rotor.current) rotor.current.rotation.z += dt * speed })
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {/* 基座光盘 + 光柱（W7） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.6, 0]} material={mats.core}>
        <ringGeometry args={[6.5, 10.5, 48]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.55, 0]} material={mats.solid}>
        <ringGeometry args={[11.5, 13, 48]} />
      </mesh>
      <mesh position={[0, 55, 0]} material={mats.pillar}>
        <cylinderGeometry args={[2.4, 2.4, 110, 12, 1, true]} />
      </mesh>
      {/* 塔筒（ taper ） */}
      <mesh position={[0, 45, 0]} material={mats.solid}><cylinderGeometry args={[1.7, 3.4, 90, 10]} /></mesh>
      <mesh position={[0, 45, 0]} material={mats.wire}><cylinderGeometry args={[1.72, 3.42, 90, 10]} /></mesh>
      {/* 机舱 */}
      <mesh position={[0, 91, 1.6]} material={mats.solid}><boxGeometry args={[6.6, 4.6, 11]} /></mesh>
      <mesh position={[0, 91, 1.6]} material={mats.wire}><boxGeometry args={[6.68, 4.68, 11.08]} /></mesh>
      {/* 转子 */}
      <group ref={rotor} position={[0, 91, 7.6]}>
        {[0, 1, 2].map((i) => (
          <group key={i} rotation={[0, 0, (i * Math.PI * 2) / 3]}>
            <mesh position={[0, 23, 0]} material={mats.solid}><boxGeometry args={[1.5, 46, 0.5]} /></mesh>
            <mesh position={[0, 23, 0]} material={mats.wire}><boxGeometry args={[1.56, 46.1, 0.56]} /></mesh>
          </group>
        ))}
        <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.core}><cylinderGeometry args={[2.2, 2.2, 2.4, 14]} /></mesh>
      </group>
    </group>
  )
}

// W6 全息风机 × 9（3×3 阵列，Phase 2 换 GLB 写实皮肤）
export default function TurbineField() {
  const mats = useHoloMats()
  const units = useMemo(() => {
    const arr: { p: [number, number, number]; s: number; yaw: number }[] = []
    let k = 0
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        arr.push({
          p: [(c - 1) * 300 + (r % 2) * 24 - 40, 0, (r - 1) * 320 - 30],
          s: 1.05 + ((k * 37) % 5) * 0.09, // 转速 Phase 5 接风速真值
          yaw: Math.PI + ((k * 53) % 7 - 3) * 0.012,
        })
        k++
      }
    return arr
  }, [])
  return (
    <group>
      {units.map((u, i) => <HoloTurbine key={i} position={u.p} speed={u.s} yaw={u.yaw} mats={mats} />)}
    </group>
  )
}
