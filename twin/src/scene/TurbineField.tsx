import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, SERVOS, terrainHeight } from './terrainUtil'
import { useSim } from '../state/simStore'
import { getTurbineGeos, getTurbineMats, TURBINE_SPEC as S } from './turbine/geometry'
import HoloTurbine from './HoloTurbine'

// ================================================================
// 机组阵列：mode=holo 全息冰青（原图像素还原，默认）
//          mode=real NREL 5MW 参数化写实（R3 成果，一键切换）
// 5 路导颈舵机（simStore.servos）联动机组 yaw
// ================================================================
const D2R = THREE.MathUtils.degToRad

function RealTurbine({ u, geos, mats, yawDeg, servo }: {
  u: (typeof FARM)[number]
  geos: ReturnType<typeof getTurbineGeos>
  mats: ReturnType<typeof getTurbineMats>
  yawDeg: number
  servo: boolean
}) {
  const spin = useRef<THREE.Group>(null!)
  const yawGroup = useRef<THREE.Group>(null!)
  const y = terrainHeight(u.x, u.z)

  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.z += dt * u.speed * 1.15 // ≈11 rpm
    if (yawGroup.current) {
      const target = Math.PI * 0.06 + D2R(yawDeg)
      yawGroup.current.rotation.y += (target - yawGroup.current.rotation.y) * Math.min(1, dt * 2.5)
    }
  })

  return (
    <group position={[u.x, y, u.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.55, 0]}>
        <circleGeometry args={[13, 32]} />
        <meshBasicMaterial color="#010810" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.9, 0]}>
        <ringGeometry args={[9.2, 10.2, 48]} />
        <meshBasicMaterial color={new THREE.Color(0.4, 1.1, 1.45)} transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      {servo && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 2.0, 0]}>
          <ringGeometry args={[13.5, 14.6, 64]} />
          <meshBasicMaterial color={new THREE.Color(0.7, 1.8, 2.3)} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
        </mesh>
      )}

      <group ref={yawGroup}>
        <mesh geometry={geos.tower} material={mats.sheath} />
        <mesh geometry={geos.flange1} material={mats.dark} />
        <mesh geometry={geos.flange2} material={mats.dark} />
        <mesh geometry={geos.door} material={mats.dark} position={[0, 2.0, -2.92]} />

        <mesh geometry={geos.yawPlate} material={mats.dark} position={[0, S.towerTop + 0.5, S.nacelleZ * 0.4]} />
        <mesh geometry={geos.nacelle} material={mats.body} position={[0, S.hubY - 0.4, S.nacelleZ]} />
        <mesh geometry={geos.nacelleTail} material={mats.body} position={[0, S.hubY - 0.6, S.nacelleZ - 8.6]} />
        <mesh geometry={geos.door} material={mats.dark} position={[0, S.hubY - 0.5, S.nacelleZ - 10.6]} scale={[1.5, 1.1, 1]} />
        {[0, 1].map((i) => (
          <mesh key={i} geometry={geos.fin} material={mats.dark} position={[i ? 1.3 : -1.3, S.hubY + 2.15, S.nacelleZ - 1.5]} />
        ))}
        <mesh geometry={geos.anemo} material={mats.dark} position={[0, S.hubY + 3.1, S.nacelleZ - 0.2]} />
        <mesh geometry={geos.beacon} material={mats.beacon} position={[0, S.hubY + 3.9, S.nacelleZ - 0.2]} />
        <mesh geometry={geos.yawFin} material={mats.dark} position={[0, S.hubY + 1.4, S.nacelleZ - 9.2]} />

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
  const mode = useSim((s) => s.mode)
  const servos = useSim((s) => s.servos)
  const geos = useMemo(getTurbineGeos, [])
  const mats = useMemo(getTurbineMats, [])

  return (
    <group>
      {FARM.map((u, i) => {
        const servoIdx = SERVOS.indexOf(i)
        const yawDeg = servoIdx >= 0 ? servos[servoIdx] : 0
        return mode === 'holo' ? (
          <HoloTurbine
            key={u.id}
            x={u.x} z={u.z} y={terrainHeight(u.x, u.z)}
            yawDeg={yawDeg + 8}
            speed={u.speed}
            servo={servoIdx >= 0}
          />
        ) : (
          <RealTurbine key={u.id} u={u} geos={geos} mats={mats} yawDeg={yawDeg} servo={servoIdx >= 0} />
        )
      })}
    </group>
  )
}
