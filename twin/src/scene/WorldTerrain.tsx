import { useMemo } from 'react'
import * as THREE from 'three'
import { Grid } from '@react-three/drei'

// 确定性 2D 值噪声（双八度）
function makeNoise(seed = 7) {
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 17.43) * 43758.5453
    return s - Math.floor(s)
  }
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const n2 = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = x - xi, yf = y - yi
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
    const u = smooth(xf), v = smooth(yf)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  return (x: number, y: number) => n2(x, y) * 0.68 + n2(x * 2.13 + 5.2, y * 2.13 + 1.3) * 0.32
}

// W4 暗色起伏地形 + 左侧海岸线下潜（W5）
export default function WorldTerrain() {
  const geo = useMemo(() => {
    const noise = makeNoise()
    const g = new THREE.PlaneGeometry(3400, 3400, 170, 170)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      let h = noise(x * 0.0016, z * 0.0016) * 46 - 12
      h += noise(x * 0.006, z * 0.006) * 7
      const coast = THREE.MathUtils.smoothstep(-(x), 420, 820) // x≈-500 处下潜入海
      h -= coast * 22
      pos.setY(i, h)
    }
    g.computeVertexNormals()
    return g
  }, [])

  return (
    <group>
      <mesh geometry={geo} receiveShadow>
        <meshStandardMaterial color="#050f18" roughness={0.94} metalness={0.06} />
      </mesh>
      {/* 暗色微光水面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.4, 0]}>
        <planeGeometry args={[3600, 3600]} />
        <meshStandardMaterial color="#062232" roughness={0.32} metalness={0.7} />
      </mesh>
      {/* 淡青网格渐隐（基准图地表细网） */}
      <Grid
        position={[0, 0.4, 0]}
        args={[3400, 3400]}
        cellSize={56}
        cellColor="#0e3348"
        cellThickness={0.55}
        sectionSize={280}
        sectionColor="#175c7a"
        sectionThickness={0.9}
        fadeDistance={1500}
        fadeStrength={2.2}
        infiniteGrid
      />
    </group>
  )
}
