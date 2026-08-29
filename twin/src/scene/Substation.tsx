import { useMemo } from 'react'
import * as THREE from 'three'
import { SUBSTATION, terrainHeight } from './terrainUtil'

// ============================================================================
// 升压站（v3：比例与要素修正 —— docs/07 A8）
// ----------------------------------------------------------------------------
//  · 主体不再用"76m 高实心巨盒"：220kV 站构架真实高度约 20-30m；
//    现取 30m（H=30），并补齐可视化可辨的电气要素：
//    门型构架×2 + V 型绝缘子串（示意）、主变×3（带套管束）、
//    控楼、围墙光桩、母线桥——全部保持玻璃/晶格全息语言，不引入写实皮肤。
//  · 几何为【示意】：表达"功率在此升压外送"的空间关系，不宣称符合任何
//    具体站的施工总平面。
// ============================================================================

const C_EDGE = new THREE.Color(0.5, 1.35, 1.72)
const C_CORE = new THREE.Color(0.95, 1.85, 2.2)

export default function Substation() {
  const mats = useMemo(() => {
    const mkAdd = (o: THREE.MeshBasicMaterialParameters) =>
      new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, ...o })
    return {
      dark: new THREE.MeshBasicMaterial({ color: '#040c15', transparent: true, opacity: 0.9 }),
      lattice: mkAdd({ color: C_EDGE, wireframe: true, opacity: 0.5 }),
      glass: mkAdd({ color: C_EDGE, opacity: 0.08, side: THREE.DoubleSide }),
      core: mkAdd({ color: C_CORE, opacity: 0.9 }),
      pad: mkAdd({ color: C_EDGE, opacity: 0.4, side: THREE.DoubleSide }),
      padSoft: mkAdd({ color: C_EDGE, opacity: 0.1, side: THREE.DoubleSide }),
      rail: mkAdd({ color: C_CORE, opacity: 0.55 }),
      bush: mkAdd({ color: C_EDGE, opacity: 0.7 }),
    }
  }, [])
  const y = terrainHeight(SUBSTATION.x, SUBSTATION.z)
  const W = 112, H = 30, D = 52

  return (
    <group position={[SUBSTATION.x, y, SUBSTATION.z]}>
      {/* 平台与同心光环（比旧版收敛） */}
      <mesh position={[0, 1.2, 0]} material={mats.dark}><boxGeometry args={[W + 40, 2.4, D + 40]} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 2.6, 0]} material={mats.padSoft}>
        <circleGeometry args={[92, 56]} />
      </mesh>
      {[66, 82].map((r, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 2.7, 0]} material={mats.pad}>
          <ringGeometry args={[r, r + 1.4, 64]} />
        </mesh>
      ))}

      {/* 主控楼 + 设备间（暗芯剪影 + 玻璃面） */}
      <mesh position={[-W / 2 + 14, 5.5, -D / 2 + 8]} material={mats.dark}><boxGeometry args={[26, 11, 14]} /></mesh>
      <mesh position={[-W / 2 + 14, 5.5, -D / 2 + 8]} material={mats.lattice}><boxGeometry args={[26.2, 11.2, 14.2, 3, 2, 2]} /></mesh>

      {/* 主变 ×3 + 套管束（不再是"圆柱顶球"） */}
      {[-34, -4, 26].map((dx, i) => (
        <group key={i} position={[dx, 2.6, D / 2 - 14]}>
          <mesh position={[0, 6.5, 0]} material={mats.dark}><cylinderGeometry args={[5.8, 5.8, 13, 10]} /></mesh>
          <mesh position={[0, 6.5, 0]} material={mats.lattice}><cylinderGeometry args={[5.9, 5.9, 13.1, 10, 2]} /></mesh>
          {/* 三相高压套管 */}
          {[-2.6, 0, 2.6].map((bx, k) => (
            <mesh key={k} position={[bx, 15.6, -1.2]} material={mats.bush}>
              <cylinderGeometry args={[0.28, 0.5, 5.4, 6]} />
            </mesh>
          ))}
        </group>
      ))}

      {/* 门型构架 ×2（220kV 出线架，横梁标高 = 站构架高 H） */}
      {[-14, 26].map((gx, i) => (
        <group key={i} position={[gx, 2.6, -6]}>
          {[-16, 16].map((px, k) => (
            <mesh key={k} position={[px, H / 2, 0]} material={mats.rail}>
              <boxGeometry args={[1.2, H, 1.2]} />
            </mesh>
          ))}
          <mesh position={[0, H, 0]} material={mats.rail}><boxGeometry args={[33.6, 1.1, 1.1]} /></mesh>
          {/* V 型绝缘子串（示意，6 串） */}
          {[-10, 0, 10].map((bx, k) => (
            <group key={k}>
              <mesh position={[bx, H - 3.4, 0]} rotation={[0, 0, 0.6]} material={mats.bush}><cylinderGeometry args={[0.22, 0.22, 6.8, 5]} /></mesh>
              <mesh position={[bx, H - 3.4, 0]} rotation={[0, 0, -0.6]} material={mats.bush}><cylinderGeometry args={[0.22, 0.22, 6.8, 5]} /></mesh>
            </group>
          ))}
        </group>
      ))}

      {/* 母线桥（主变 → 构架横梁） */}
      <mesh position={[6, H + 0.9, -1]} material={mats.core}><boxGeometry args={[76, 0.7, 0.7]} /></mesh>

      {/* 周界光桩（围墙语义） */}
      {[-W / 2 - 12, -W / 4, 0, W / 4, W / 2 + 12].flatMap((dx) => [-D / 2 - 8, D / 2 + 8].map((dz) => (
        <mesh key={`${dx}-${dz}`} position={[dx, 5, dz]} material={mats.rail}>
          <boxGeometry args={[1, 7.4, 1]} />
        </mesh>
      )))}
    </group>
  )
}
