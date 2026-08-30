/* oxlint-disable react/immutability -- 帧循环内 mutate 灯光/雾为 R3F 标准模式（docs/08 D2） */
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { dayNight } from '../data/farmSim'
import { useSim } from '../state/simStore'
import { skyState } from './lightState'

// ============================================================
// 昼夜光照装置（任务#6）
//  · 夜基（既有 5 灯）保留为 dayF=0 完全体；白天叠加太阳平行光 + 提亮
//    半球光，晨昏 16° 带内线性过渡；
//  · 阴影：太阳/月亮共用一盏阴影平行光（切换方向），地形接收；
//    q=low 关闭（PerfGovernor 联动）；
//  · 雾色与背景色按 dayF 微移（夜 #040911 → 昼冰灰蓝 #37536b），
//    克制原则：不引入新色相。
// ============================================================

const C_NIGHT_BG = new THREE.Color('#010305')
const C_DAY_BG = new THREE.Color('#1d3145')
const C_NIGHT_FOG = new THREE.Color('#040911')
const C_DAY_FOG = new THREE.Color('#37536b')
const TARGET = new THREE.Vector3(-100, 45, -640)

export default function LightRig() {
  const quality = useSim((s) => s.quality)
  const sunRef = useRef<THREE.DirectionalLight>(null!)
  const keyNight = useRef<THREE.DirectionalLight>(null!)
  const hemiRef = useRef<THREE.HemisphereLight>(null!)
  const { scene } = useThree()

  const shadowOn = quality !== 'low'
  const mapSize = quality === 'high' ? 2048 : 1024

  const shadowTarget = useMemo(() => {
    const o = new THREE.Object3D()
    o.position.copy(TARGET)
    return o
  }, [])
  const tmpColor = useMemo(() => new THREE.Color(), [])

  useFrame(() => {
    const t = useSim.getState().tHours
    const dn = dayNight(t)
    skyState.dayF = dn.dayF
    skyState.sunDir.set(...dn.sunDir)
    skyState.moonDir.set(...dn.moonDir)
    const night = 1 - dn.dayF

    if (sunRef.current) {
      const d = shadowOn ? (dn.dayF > 0.04 ? skyState.sunDir : skyState.moonDir) : skyState.sunDir
      const R = 2400
      sunRef.current.position.set(TARGET.x + d.x * R, TARGET.y + Math.max(180, d.y * R), TARGET.z + d.z * R)
      sunRef.current.intensity = dn.dayF > 0.04
        ? 0.55 + dn.dayF * 0.85 // 白天：日光（0.55-1.4）
        : 0.30 // 夜：月光常量（既有观感不变）
      tmpColor.setHex(0xd8e8ff).lerp(new THREE.Color(0xf4faff), dn.dayF)
      sunRef.current.color.copy(tmpColor)
    }
    if (keyNight.current) keyNight.current.intensity = 0.85 * (0.35 + 0.65 * night)
    if (hemiRef.current) {
      hemiRef.current.intensity = 0.42 + dn.dayF * 0.5
      hemiRef.current.color.setHex(0x123448).lerp(new THREE.Color(0x9cc4dc), dn.dayF * 0.7)
    }
    if (scene.fog && (scene.fog as THREE.FogExp2).isFogExp2) {
      (scene.fog as THREE.FogExp2).color.copy(C_NIGHT_FOG).lerp(C_DAY_FOG, dn.dayF * 0.5)
    }
    if (scene.background && (scene.background as THREE.Color).isColor) {
      (scene.background as THREE.Color).copy(C_NIGHT_BG).lerp(C_DAY_BG, dn.dayF * 0.6)
    }
  })

  return (
    <>
      <hemisphereLight ref={hemiRef} args={['#123448', '#010408', 0.42]} />
      {/* 夜基补光（与 v3 构图基准一致） */}
      <directionalLight position={[700, 900, -500]} intensity={0.32 * 0.4} color="#a8d9ff" />
      <directionalLight position={[-600, 500, 900]} intensity={0.16} color="#3f88b8" />
      <directionalLight ref={keyNight} position={[-750, 1250, -650]} intensity={0.85} color="#d6e6ff" />
      <directionalLight position={[500, 420, 1150]} intensity={0.26} color="#86b8dc" />
      {/* 太阳/月亮共用主灯：位置由帧循环驱动，全场唯一阴影源 */}
      <directionalLight
        ref={sunRef}
        intensity={0.30}
        castShadow={shadowOn}
        shadow-mapSize={[mapSize, mapSize]}
        shadow-camera-near={200}
        shadow-camera-far={6200}
        shadow-camera-left={-1900}
        shadow-camera-right={1900}
        shadow-camera-top={1900}
        shadow-camera-bottom={-1900}
        shadow-bias={-0.0006}
        shadow-normalBias={2.5}
      >
        <primitive object={shadowTarget} attach="target" />
      </directionalLight>
    </>
  )
}
