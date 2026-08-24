import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, terrainHeight } from './terrainUtil'
import { useSim } from '../state/simStore'
import { getTurbineGeos, getTurbineMats, TURBINE_SPEC as S } from './turbine/geometry'

// R3 超真实化：NREL 5MW 参考机组参数化整机（几何/材质见 turbine/geometry.ts）
// 替换原程序化全息"小木棍"（docs/06 调研决策）；地面保留低亮度锚点环作为集电起点标记
const D2R = THREE.MathUtils.degToRad

function RealTurbine({ u, geos, mats }: {
  u: (typeof FARM)[number]
  geos: ReturnType<typeof getTurbineGeos>
  mats: ReturnType<typeof getTurbineMats>
}) {
  const spin = useRef<THREE.Group>(null!)
  const yawGroup = useRef<THREE.Group>(null!)
  const y = terrainHeight(u.x, u.z)

  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.z += dt * u.speed * 1.15 // ≈11 rpm
    if (yawGroup.current) {
      const rowYawDeg = useSim.getState().yawRows[u.row]
      const target = Math.PI * 0.06 + D2R(rowYawDeg)
      yawGroup.current.rotation.y += (target - yawGroup.current.rotation.y) * Math.min(1, dt * 2.5)
    }
  })

  return (
    <group position={[u.x, y, u.z]}>
      {/* 地面：接触阴影 + 锚点光环（集电起点） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.55, 0]}>
        <circleGeometry args={[13, 32]} />
        <meshBasicMaterial color="#010810" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.9, 0]}>
        <ringGeometry args={[9.2, 10.2, 48]} />
        <meshBasicMaterial color={new THREE.Color(0.4, 1.1, 1.45)} transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>

      <group ref={yawGroup}>
        {/* 塔筒 + 法兰 + 检修门 */}
        <mesh geometry={geos.tower} material={mats.sheath} />
        <mesh geometry={geos.flange1} material={mats.dark} />
        <mesh geometry={geos.flange2} material={mats.dark} />
        <mesh geometry={geos.door} material={mats.dark} position={[0, 2.0, -2.92]} />

        {/* 机舱组（yaw 板 → 主体 → 尾罩 → 顶部件） */}
        <mesh geometry={geos.yawPlate} material={mats.dark} position={[0, S.towerTop + 0.5, S.nacelleZ * 0.4]} />
        <mesh geometry={geos.nacelle} material={mats.body} position={[0, S.hubY - 0.4, S.nacelleZ]} />
        <mesh geometry={geos.nacelleTail} material={mats.body} position={[0, S.hubY - 0.6, S.nacelleZ - 8.6]} />
        <mesh geometry={geos.door} material={mats.dark} position={[0, S.hubY - 0.5, S.nacelleZ - 10.6]} scale={[1.5, 1.1, 1]} />
        {/* 顶部：散热翅 + 避雷针/航空灯 + 风速风向仪 */}
        {[0, 1].map((i) => (
          <mesh key={i} geometry={geos.fin} material={mats.dark} position={[i ? 1.3 : -1.3, S.hubY + 2.15, S.nacelleZ - 1.5]} />
        ))}
        <mesh geometry={geos.anemo} material={mats.dark} position={[0, S.hubY + 3.1, S.nacelleZ - 0.2]} />
        <mesh geometry={geos.beacon} material={mats.beacon} position={[0, S.hubY + 3.9, S.nacelleZ - 0.2]} />
        <mesh geometry={geos.yawFin} material={mats.dark} position={[0, S.hubY + 1.4, S.nacelleZ - 9.2]} />

        {/* 转子组：上仰 5° 后往前伸，spin 组驱动旋转 */}
        <group position={[0, S.hubY, S.nacelleZ]} rotation={[-D2R(S.tiltDeg), 0, 0]}>
          <group ref={spin} position={[0, 0, 5.35]}>
            <mesh geometry={geos.hub} material={mats.body} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -1.4]} />
            {[0, 1, 2].map((i) => (
              <group key={i} rotation={[0, 0, (i * Math.PI * 2) / 3]}>
                <mesh geometry={geos.blade} material={mats.sheath} rotation={[D2R(S.coneDeg), 0, 0]} />
              </group>
            ))}
            <mesh geometry={geos.spinner} material={mats.sheath} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.4]} />
          </group>
        </group>
      </group>
    </group>
  )
}

export default function TurbineField() {
  const geos = useMemo(getTurbineGeos, [])
  const mats = useMemo(getTurbineMats, [])
  return (
    <group>
      {FARM.map((u) => <RealTurbine key={u.id} u={u} geos={geos} mats={mats} />)}
    </group>
  )
}
