import { useMemo } from 'react'
import * as THREE from 'three'
import { Grid } from '@react-three/drei'
import { terrainHeight } from './terrainUtil'

// W4 辽阔暗色地形 + 左侧海岸下潜（W5）；高度场与 terrainUtil 同源
export default function WorldTerrain() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(4600, 4600, 150, 150)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)))
    g.computeVertexNormals()
    return g
  }, [])

  return (
    <group>
      <mesh geometry={geo} receiveShadow>
        <meshStandardMaterial color="#040d16" roughness={0.95} metalness={0.05} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.6, 0]}>
        <planeGeometry args={[4800, 4800]} />
        <meshStandardMaterial color="#06202f" roughness={0.34} metalness={0.68} />
      </mesh>
      <Grid
        position={[0, 0.5, 0]}
        args={[4600, 4600]}
        cellSize={60}
        cellColor="#0b2c40"
        cellThickness={0.5}
        sectionSize={300}
        sectionColor="#134e6b"
        sectionThickness={0.85}
        fadeDistance={2100}
        fadeStrength={2.4}
        infiniteGrid
      />
    </group>
  )
}
