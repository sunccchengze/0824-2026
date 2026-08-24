import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, terrainHeight } from './terrainUtil'
import { useSim } from '../state/simStore'

// R2 纤细冰白全息：白芯青缘，足踏光盘（基准图 W7）
const C_BODY = new THREE.Color(0.62, 1.12, 1.42)
const C_EDGE = new THREE.Color(0.88, 1.5, 1.78)
const C_CORE = new THREE.Color(1.25, 1.75, 2.0)

function useHoloMats() {
  return useMemo(() => {
    const mk = (opts: THREE.MeshBasicMaterialParameters) =>
      new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, ...opts })
    return {
      solid: mk({ color: C_BODY, opacity: 0.19, side: THREE.DoubleSide }),
      wire: mk({ color: C_EDGE, wireframe: true, opacity: 0.38 }),
      core: mk({ color: C_CORE, opacity: 0.58 }),
      pool: mk({ color: new THREE.Color(0.5, 1.3, 1.66), opacity: 0.42, side: THREE.DoubleSide }),
      poolSoft: mk({ color: new THREE.Color(0.35, 1.0, 1.35), opacity: 0.13, side: THREE.DoubleSide }),
    }
  }, [])
}

function HoloTurbine({ u, mats }: { u: (typeof FARM)[number]; mats: ReturnType<typeof useHoloMats> }) {
  const rotor = useRef<THREE.Group>(null!)
  const yawGroup = useRef<THREE.Group>(null!)
  const y = terrainHeight(u.x, u.z)
  useFrame((s, dt) => {
    if (rotor.current) rotor.current.rotation.z += dt * u.speed * 1.35
    if (yawGroup.current) {
      // 来流 NNW → 基准朝向 + 行偏航量（滑块联动【模拟】）
      const rowYawDeg = useSim.getState().yawRows[u.row]
      const target = Math.PI * 0.06 + THREE.MathUtils.degToRad(rowYawDeg)
      yawGroup.current.rotation.y += (target - yawGroup.current.rotation.y) * Math.min(1, dt * 2.5)
    }
    void s
  })
  return (
    <group position={[u.x, y, u.z]}>
      {/* 足底光盘 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.9, 0]} material={mats.pool}>
        <circleGeometry args={[11.5, 40]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.8, 0]} material={mats.poolSoft}>
        <circleGeometry args={[19, 40]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.0, 0]} material={mats.core}>
        <ringGeometry args={[11.6, 12.8, 48]} />
      </mesh>
      <group ref={yawGroup}>
        {/* 塔筒：细锥 + 线框 */}
        <mesh position={[0, 49, 0]} material={mats.solid}><cylinderGeometry args={[0.9, 1.9, 98, 8]} /></mesh>
        <mesh position={[0, 49, 0]} material={mats.wire}><cylinderGeometry args={[0.95, 1.95, 98, 8]} /></mesh>
        {/* 机舱 + 轮毂 */}
        <mesh position={[0, 99, 2.2]} material={mats.solid}><boxGeometry args={[4.4, 3.4, 9]} /></mesh>
        <mesh position={[0, 99, 2.2]} material={mats.wire}><boxGeometry args={[4.5, 3.5, 9.1]} /></mesh>
        <group ref={rotor} position={[0, 99, 7.4]}>
          {[0, 1, 2].map((i) => (
            <group key={i} rotation={[0, 0, (i * Math.PI * 2) / 3]}>
              {/* 叶根段 */}
              <mesh position={[0, 11, 0]} material={mats.solid}><boxGeometry args={[1.7, 22, 0.5]} /></mesh>
              <mesh position={[0, 11, 0]} material={mats.wire}><boxGeometry args={[1.78, 22.1, 0.56]} /></mesh>
              {/* 叶尖段（窄） */}
              <mesh position={[0, 33, 0]} material={mats.solid}><boxGeometry args={[0.9, 24, 0.4]} /></mesh>
              <mesh position={[0, 33, 0]} material={mats.wire}><boxGeometry args={[0.98, 24.1, 0.46]} /></mesh>
              {/* 叶面亮芯 */}
              <mesh position={[0, 22.5, 0]} material={mats.core}><boxGeometry args={[0.26, 44, 0.26]} /></mesh>
            </group>
          ))}
          <mesh material={mats.core}><sphereGeometry args={[1.5, 12, 12]} /></mesh>
        </group>
      </group>
    </group>
  )
}

export default function TurbineField() {
  const mats = useHoloMats()
  return (
    <group>
      {FARM.map((u) => <HoloTurbine key={u.id} u={u} mats={mats} />)}
    </group>
  )
}
