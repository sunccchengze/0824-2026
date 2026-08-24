import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, terrainHeight } from './terrainUtil'

// 纤细冰青（克制 HDR，只给描边吃解析度；不再炸白）
const C_BODY = new THREE.Color(0.16, 0.62, 1.0)
const C_EDGE = new THREE.Color(0.3, 0.95, 1.5)

function useHoloMats() {
  return useMemo(() => {
    const mk = (opts: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, ...opts })
    return {
      solid: mk({ color: C_BODY, opacity: 0.15, side: THREE.DoubleSide }),
      wire: mk({ color: C_EDGE, wireframe: true, opacity: 0.34 }),
      core: mk({ color: C_EDGE, opacity: 0.6 }),
      pillar: mk({ color: new THREE.Color(0.2, 0.72, 1.12), opacity: 0.09, side: THREE.DoubleSide }),
    }
  }, [])
}

function HoloTurbine({ x, z, speed, yaw, mats }: { x: number; z: number; speed: number; yaw: number; mats: ReturnType<typeof useHoloMats> }) {
  const rotor = useRef<THREE.Group>(null!)
  const y = terrainHeight(x, z)
  useFrame((_, dt) => { if (rotor.current) rotor.current.rotation.z += dt * speed })
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.7, 0]} material={mats.core}>
        <ringGeometry args={[9, 12.6, 56]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.6, 0]} material={mats.solid}>
        <ringGeometry args={[13.6, 15.2, 56]} />
      </mesh>
      <mesh position={[0, 52, 0]} material={mats.pillar}>
        <cylinderGeometry args={[1.7, 1.7, 104, 10, 1, true]} />
      </mesh>
      <mesh position={[0, 49, 0]} material={mats.solid}><cylinderGeometry args={[1.15, 2.5, 98, 8]} /></mesh>
      <mesh position={[0, 49, 0]} material={mats.wire}><cylinderGeometry args={[1.2, 2.56, 98, 8]} /></mesh>
      <mesh position={[0, 99, 1.6]} material={mats.solid}><boxGeometry args={[5.2, 3.6, 10]} /></mesh>
      <mesh position={[0, 99, 1.6]} material={mats.wire}><boxGeometry args={[5.28, 3.68, 10.08]} /></mesh>
      <mesh position={[0, 99, 1.6]} material={mats.core}><sphereGeometry args={[1.05, 10, 10]} /></mesh>
      <group ref={rotor} position={[0, 99, 7.0]}>
        {[0, 1, 2].map((i) => (
          <group key={i} rotation={[0, 0, (i * Math.PI * 2) / 3]}>
            <mesh position={[0, 22, 0]} material={mats.solid}><boxGeometry args={[1.05, 45, 0.42]} /></mesh>
            <mesh position={[0, 22, 0]} material={mats.wire}><boxGeometry args={[1.1, 45.2, 0.47]} /></mesh>
          </group>
        ))}
        <mesh material={mats.core}><sphereGeometry args={[1.5, 12, 12]} /></mesh>
      </group>
    </group>
  )
}

export default function TurbineField() {
  const mats = useHoloMats()
  return (
    <group>
      {FARM.map((u, i) => <HoloTurbine key={i} x={u.x} z={u.z} speed={u.speed} yaw={u.yaw} mats={mats} />)}
    </group>
  )
}
