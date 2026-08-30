/* oxlint-disable react/immutability -- 帧循环内 mutate 灯光/雾为 R3F 标准模式（docs/08 D2） */
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { dayNight } from '../data/farmSim'
import { useSim } from '../state/simStore'
import { skyState } from './lightState'

// ============================================================
// 昼夜光照装置（任务#2/#3/#10 修订版）
//  · 卡顿根因：仿真时钟 setInterval(100ms) 量化推进，灯光此前按量化值
//    重算 → 太阳一跳一跳。改本组件自带连续钟（与 store 同速 24h/50s，
//    拖轴/暂停时同步），天体位置每帧平滑；
//  · 日出错位根因：夜光位置曾 max(180, y) 硬抬到地平上，18-19 点附近
//    出现"假日出"。现夜=月亮方向（moonDir 构造性高于地平线），
//    晨昏带用 dayF 对太阳/月亮方向与强度做连续混合——金色时刻的
//    长影由真实的低角度产生，不再靠 clamp；
//  · 强度（"以假乱真"诉求）：白天主光 0.34→1.94 连续，半球光压低拉对比，
//    阴影贴图 high 档 4096、相机收紧到 ±1500（纹素密度 ~0.73m），
//    exposure 联动 App=1.14；
//  · 雾/背景随昼夜单色相微移（克制原则：不引入新色相）。
// ============================================================

const C_NIGHT_BG = new THREE.Color('#010305')
const C_DAY_BG = new THREE.Color('#28455e')
const C_NIGHT_FOG = new THREE.Color('#040911')
const C_DAY_FOG = new THREE.Color('#47688a')
const TARGET = new THREE.Vector3(-100, 45, -640)

const wrap24 = (t: number) => ((t % 24) + 24) % 24

export default function LightRig() {
  const quality = useSim((s) => s.quality)
  const sunRef = useRef<THREE.DirectionalLight>(null!)
  const keyNight = useRef<THREE.DirectionalLight>(null!)
  const hemiRef = useRef<THREE.HemisphereLight>(null!)
  const { scene } = useThree()

  const shadowOn = quality !== 'low'
  const mapSize = quality === 'high' ? 4096 : 2048

  const shadowTarget = useMemo(() => {
    const o = new THREE.Object3D()
    o.position.copy(TARGET)
    return o
  }, [])
  const tmp = useMemo(() => ({
    dir: new THREE.Vector3(),
    col: new THREE.Color(),
    simT: -1,
  }), [])

  useFrame((_state, delta) => {
    const s = useSim.getState()
    // —— 连续仿真钟：与 startSimClock 同速率；暂停/跳变时吸附 store 值 ——
    if (tmp.simT < 0) tmp.simT = s.tHours
    // 循环距离（wrap 感知）：24:00→0:00 自然换日 gap≈0.048，不再误判为
    // "跳变 23.95h"而吸附——那正是午夜画面卡一下的放大器
    let g = wrap24(s.tHours) - wrap24(tmp.simT)
    if (g > 12) g -= 24
    if (g < -12) g += 24
    if (!s.playing || Math.abs(g) > 0.6) tmp.simT = s.tHours
    else tmp.simT = wrap24(tmp.simT + Math.min(0.1, delta) * (24 / 50))

    const dn = dayNight(tmp.simT)
    // smoothstep 缓入晨昏，日出/日落有 2-3 秒（真实时间）的渐变而非突变
    const fd = dn.dayF * dn.dayF * (3 - 2 * dn.dayF)
    const mf = dn.moonF * dn.moonF * (3 - 2 * dn.moonF)
    skyState.dayF = fd
    skyState.sunDir.set(...dn.sunDir)
    skyState.moonDir.set(...dn.moonDir)
    const night = 1 - fd

    if (sunRef.current) {
      // 方向：太阳权重 fd、月亮权重 mf 连续交叉——日落瞬间合光仍偏西（余晖），
      // 入夜渐交棒月亮；两臂在晨昏交界同点（对日点），无方位跳变
      tmp.dir.set(
        dn.sunDir[0] * fd + dn.moonDir[0] * mf,
        Math.max(0.045, dn.sunDir[1] * fd + dn.moonDir[1] * mf),
        dn.sunDir[2] * fd + dn.moonDir[2] * mf,
      ).normalize()
      const R = 2600
      sunRef.current.position.set(TARGET.x + tmp.dir.x * R, TARGET.y + tmp.dir.y * R, TARGET.z + tmp.dir.z * R)
      sunRef.current.intensity = 0.34 + 1.6 * fd
      tmp.col.setHex(0xcfe4ff).lerp(new THREE.Color(0xf6fbff), fd)
      sunRef.current.color.copy(tmp.col)
    }
    if (keyNight.current) keyNight.current.intensity = 0.62 * (0.3 + 0.7 * night)
    if (hemiRef.current) {
      // 白天压半球光 → 阴影对比更"真实"（不糊成一片）
      hemiRef.current.intensity = 0.42 + 0.24 * fd
      hemiRef.current.color.setHex(0x123448).lerp(new THREE.Color(0x8fb6d0), fd * 0.75)
    }
    if (scene.fog && (scene.fog as THREE.FogExp2).isFogExp2) {
      (scene.fog as THREE.FogExp2).color.copy(C_NIGHT_FOG).lerp(C_DAY_FOG, fd * 0.62)
    }
    if (scene.background && (scene.background as THREE.Color).isColor) {
      (scene.background as THREE.Color).copy(C_NIGHT_BG).lerp(C_DAY_BG, fd * 0.72)
    }
  })

  return (
    <>
      <hemisphereLight ref={hemiRef} args={['#123448', '#010408', 0.42]} />
      {/* 夜基补光（v3 构图基准，白天按 fd 让位） */}
      <directionalLight position={[700, 900, -500]} intensity={0.13} color="#a8d9ff" />
      <directionalLight position={[-600, 500, 900]} intensity={0.16} color="#3f88b8" />
      <directionalLight ref={keyNight} position={[-750, 1250, -650]} intensity={0.85} color="#d6e6ff" />
      <directionalLight position={[500, 420, 1150]} intensity={0.26} color="#86b8dc" />
      {/* 主灯：太阳/月亮连续混合，全场唯一阴影源 */}
      <directionalLight
        ref={sunRef}
        intensity={0.34}
        castShadow={shadowOn}
        shadow-mapSize={[mapSize, mapSize]}
        shadow-camera-near={140}
        shadow-camera-far={6400}
        shadow-camera-left={-1500}
        shadow-camera-right={1500}
        shadow-camera-top={1500}
        shadow-camera-bottom={-1500}
        shadow-bias={-0.00035}
        shadow-normalBias={1.4}
      >
        <primitive object={shadowTarget} attach="target" />
      </directionalLight>
    </>
  )
}
