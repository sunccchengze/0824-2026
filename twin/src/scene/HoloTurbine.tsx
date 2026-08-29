import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { TURBINE_SPEC as S } from './turbine/geometry'
import { getHoloKit, getHoloMats } from './turbine/holoParts'

// ============================================================================
// 全息纯白线稿风机（合并装配版）
//   · 静止件/转子件各一套合并几何（holoParts），9 台共享，draw calls 大降；
//   · 核心轮廓 1px 不透明纯白；光晕 = Line2 屏幕空间等宽双 pass（无重影）；
//   · 全部材质 toneMapped:false / fog:false / depthTest:true：
//     亮度视角无关，但远景会被山体正确遮挡（C1 修复——不再是透山全息）；
//   · 基座能量环视角无关常亮；机组有活动告警时外环切告警红（设计令唯一非青）。
// ============================================================================

const D2R = THREE.MathUtils.degToRad

export default function HoloTurbine({ x, z, y, yawDeg, rpmRadS, alarmed }: {
  x: number; z: number; y: number; yawDeg: number; rpmRadS: number; alarmed: boolean
}) {
  const root = useRef<THREE.Group>(null!)
  const spin = useRef<THREE.Group>(null!)

  const kit = getHoloKit()
  const mats = getHoloMats()

  // Line2 光晕实例（几何/材质全场共享，仅实例独立）
  const glows = useMemo(() => ({
    sA: new Line2(kit.staticGlowA as LineGeometry, mats.glowA),
    sB: new Line2(kit.staticGlowB as LineGeometry, mats.glowB),
    rA: new Line2(kit.rotorGlowA as LineGeometry, mats.glowA),
    rB: new Line2(kit.rotorGlowB as LineGeometry, mats.glowB),
  }), [kit, mats])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    mats.shell.uniforms.uTime.value = t
    // B10 修复：航空信标呼吸闪烁（此前常灭）
    mats.beacon.opacity = 0.45 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2.4))
    if (spin.current) spin.current.rotation.z += dt * rpmRadS
    if (root.current) {
      const target = D2R(yawDeg)
      root.current.rotation.y += (target - root.current.rotation.y) * Math.min(1, dt * 3)
    }
  })

  const ringMat = alarmed ? mats.ringAlert : mats.ring

  return (
    <group position={[x, y, z]}>
      {/* 底层暗吸光盘：收敛半径 16→11、不透明度 0.82→0.66（C2 去“井盖感”） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.55, 0]} material={mats.disc} renderOrder={0}>
        <circleGeometry args={[11, 48]} />
      </mesh>

      {/* 基座能量环 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.95, 0]} material={mats.ring} renderOrder={6}>
        <ringGeometry args={[8.8, 9.9, 64]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.1, 0]} material={ringMat} renderOrder={7}>
        <ringGeometry args={[3.8, 4.2, 48]} />
      </mesh>

      <group ref={root}>
        {/* 静止件：能量壳 + 肋线 + Line2 光晕双 pass + 核心轮廓 */}
        <mesh geometry={kit.staticShell} material={mats.shell} scale={0.997} renderOrder={1} />
        <lineSegments geometry={kit.staticRibs} material={mats.rib} renderOrder={2} />
        <primitive object={glows.sB} renderOrder={3} />
        <primitive object={glows.sA} renderOrder={4} />
        <lineSegments geometry={kit.staticCore} material={mats.core} renderOrder={5} />

        {/* 航空信标（闪烁材质） */}
        <mesh geometry={kit.beacon} material={mats.beacon} position={[0, S.hubY + 3.9, S.nacelleZ - 0.2]} renderOrder={6} />

        {/* 转子：旋转系内合并（叶片×3 + 轮毂 + 导流罩） */}
        <group position={[0, S.hubY, S.nacelleZ]} rotation={[-D2R(S.tiltDeg), 0, 0]}>
          <group ref={spin} position={[0, 0, 5.35]}>
            <mesh geometry={kit.rotorShell} material={mats.shell} scale={0.997} renderOrder={1} />
            <lineSegments geometry={kit.rotorRibs} material={mats.rib} renderOrder={2} />
            <primitive object={glows.rB} renderOrder={3} />
            <primitive object={glows.rA} renderOrder={4} />
            <lineSegments geometry={kit.rotorCore} material={mats.core} renderOrder={5} />
          </group>
        </group>
      </group>
    </group>
  )
}
