import { useMemo } from 'react'
import * as THREE from 'three'
import { SUBSTATION, terrainHeight } from './terrainUtil'

const C_EDGE = new THREE.Color(0.32, 1.0, 1.55)
const C_CORE = new THREE.Color(0.5, 1.45, 1.9)

// W9 玻璃升压站：透明框架 + 内部母排辉光 + 基座光盘 + 周界光桩
export default function Substation() {
  const mats = useMemo(() => {
    const mk = (o: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, ...o })
    return {
      wire: mk({ color: C_EDGE, wireframe: true, opacity: 0.5 }),
      solid: mk({ color: C_EDGE, opacity: 0.12, side: THREE.DoubleSide }),
      core: mk({ color: C_CORE, opacity: 0.8 }),
      pad: mk({ color: C_EDGE, opacity: 0.5 }),
    }
  }, [])
  const y = terrainHeight(SUBSTATION.x, SUBSTATION.z)
  return (
    <group position={[SUBSTATION.x, y, SUBSTATION.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.8, 0]} material={mats.pad}>
        <ringGeometry args={[80, 92, 64]} />
      </mesh>
      <mesh position={[0, 27, 0]} material={mats.solid}><boxGeometry args={[130, 54, 84]} /></mesh>
      <mesh position={[0, 27, 0]} material={mats.wire}><boxGeometry args={[131, 55, 85]} /></mesh>
      {/* 内部母排三层辉光 */}
      {[14, 27, 40].map((h, i) => (
        <mesh key={i} position={[0, h, 0]} material={mats.core}><boxGeometry args={[104, 2.6, 12]} /></mesh>
      ))}
      {[-38, 0, 38].map((dx, i) => (
        <mesh key={i} position={[dx, 10, 24]} material={mats.solid}><cylinderGeometry args={[7, 7, 20, 10]} /></mesh>
      ))}
      {[-38, 0, 38].map((dx, i) => (
        <mesh key={i} position={[dx, 21, 24]} material={mats.core}><cylinderGeometry args={[1.2, 1.2, 3, 6]} /></mesh>
      ))}
      {/* 周界光桩 */}
      {[-70, -23, 23, 70].flatMap((dx) => [-46, 46].map((dz) => (
        <mesh key={`${dx}-${dz}`} position={[dx, 5, dz]} material={mats.core}><boxGeometry args={[1.4, 10, 1.4]} /></mesh>
      )))}
    </group>
  )
}
