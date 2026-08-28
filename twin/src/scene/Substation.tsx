import { useMemo } from 'react'
import * as THREE from 'three'
import { SUBSTATION, terrainHeight } from './terrainUtil'

const C_EDGE = new THREE.Color(0.5, 1.35, 1.72)
const C_CORE = new THREE.Color(0.95, 1.85, 2.2)

// W9 玻璃升压站：暗芯剪影 + 细分玻璃框架 + 四层母排辉光 + 平台光盘 + 周界光轨（基准图最亮主体）
export default function Substation() {
  const mats = useMemo(() => {
    const mkAdd = (o: THREE.MeshBasicMaterialParameters) =>
      new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, ...o })
    return {
      dark: new THREE.MeshBasicMaterial({ color: '#040c15', transparent: true, opacity: 0.9 }),
      lattice: mkAdd({ color: C_EDGE, wireframe: true, opacity: 0.6 }),
      glass: mkAdd({ color: C_EDGE, opacity: 0.09, side: THREE.DoubleSide }),
      core: mkAdd({ color: C_CORE, opacity: 0.92 }),
      pad: mkAdd({ color: C_EDGE, opacity: 0.55, side: THREE.DoubleSide }),
      padSoft: mkAdd({ color: C_EDGE, opacity: 0.14, side: THREE.DoubleSide }),
      rail: mkAdd({ color: C_CORE, opacity: 0.7 }),
    }
  }, [])
  const y = terrainHeight(SUBSTATION.x, SUBSTATION.z)
  const W = 112, H = 30, D = 52
  return (
    <group position={[SUBSTATION.x, y, SUBSTATION.z]}>
      {/* 平台：暗底盘 + 同心光环 */}
      <mesh position={[0, 1.5, 0]} material={mats.dark}><boxGeometry args={[W + 44, 3, D + 44]} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 3.2, 0]} material={mats.padSoft}>
        <circleGeometry args={[102, 56]} />
      </mesh>
      {[76, 94].map((r, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 3.3, 0]} material={mats.pad}>
          <ringGeometry args={[r, r + 1.6, 64]} />
        </mesh>
      ))}
      {/* 主体：暗芯剪影 → 玻璃面 → 细分框架 */}
      <mesh position={[0, H / 2 + 3, 0]} material={mats.dark} renderOrder={1}>
        <boxGeometry args={[W, H, D]} />
      </mesh>
      <mesh position={[0, H / 2 + 3, 0]} material={mats.glass} renderOrder={2}>
        <boxGeometry args={[W, H, D]} />
      </mesh>
      <mesh position={[0, H / 2 + 3, 0]} material={mats.lattice} renderOrder={3}>
        <boxGeometry args={[W, H, D, 8, 5, 6]} />
      </mesh>
      {/* 四层母排辉光 */}
      {[8, 15, 22].map((h, i) => (
        <mesh key={i} position={[0, h + 3, (i % 2 ? -1 : 1) * 10]} material={mats.core} renderOrder={4}>
          <boxGeometry args={[W * 0.76, 2.4, 11]} />
        </mesh>
      ))}
      {/* 三台主变 + 顶帽 */}
      {[-38, 0, 38].map((dx, i) => (
        <group key={i} position={[dx, 3, D / 2 + 13]}>
          <mesh position={[0, 9, 0]} material={mats.dark}><cylinderGeometry args={[6.6, 6.6, 18, 10]} /></mesh>
          <mesh position={[0, 9, 0]} material={mats.lattice}><cylinderGeometry args={[6.7, 6.7, 18.1, 10, 2]} /></mesh>
          <mesh position={[0, 19.4, 0]} material={mats.core}><sphereGeometry args={[1.5, 10, 10]} /></mesh>
        </group>
      ))}
      {/* 屋顶双避雷针 */}
      {[-40, 40].map((dx, i) => (
        <group key={i} position={[dx, H + 3, 0]}>
          <mesh position={[0, 9, 0]} material={mats.rail}><cylinderGeometry args={[0.5, 0.5, 18, 6]} /></mesh>
          <mesh position={[0, 18.8, 0]} material={mats.core}><sphereGeometry args={[0.8, 8, 8]} /></mesh>
        </group>
      ))}
      {/* 周界光桩 */}
      {[-W / 2 - 16, -W / 4, 0, W / 4, W / 2 + 16].flatMap((dx) => [-D / 2 - 10, D / 2 + 10].map((dz) => (
        <mesh key={`${dx}-${dz}`} position={[dx, 8, dz]} material={mats.rail}>
          <boxGeometry args={[1.3, 11, 1.3]} />
        </mesh>
      )))}
    </group>
  )
}
