import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CAM, FARM } from './terrainUtil'
import { useSim } from '../state/simStore'

// ============================================================================
// 无人机航拍开场（可跳过 / 可回放 —— C5 修复）
//
// 1 → 正上空俯瞰整个阵列
// 2 → 保持视线向下，竖直俯冲
// 3 → 镜头上抬并向后倒退，拉到全景
// 4 → 快速前推到 9 号风机
// 5 → 在 9 号处转头，对准 1-5-9 对角线
// 6 → 沿对角线穿过 5 号，飞向 1 号并停住
//
// 交互：
//   · 运镜期间点击画面 / 滚轮 / 任意键 → 1.2s 平滑收束到主机位（不再硬等 34s）；
//   · HUD 时间轴右侧“回放开场”按钮 → 重新巡航一遍；
//   · ?cam= 调试机位仅开发环境生效（D10，生产路径无调试开关）。
// ============================================================================

const ONE = FARM[6]
const FIVE = FARM[4]
const NINE = FARM[2]

const CAMERA_NODES = [
  new THREE.Vector3(-100, 1720, -640), // 正上空起始点
  new THREE.Vector3(-100, 720, -640), // 竖直俯冲
  new THREE.Vector3(-100, 300, -640), // 俯冲最低点
  new THREE.Vector3(-100, 300, -520), // 保持低位，先开始向后退
  new THREE.Vector3(-100, 330, -200), // 微抬并继续倒退
  new THREE.Vector3(-100, 390, 250), // 平顺抬头进入远景
  new THREE.Vector3(60, 480, 990), // 全景构图
  new THREE.Vector3(120, 470, 900), // 全景缓行，不停顿但放慢
  new THREE.Vector3(NINE.x + 145, 210, NINE.z - 160), // 快速前推至 9 号
  new THREE.Vector3(NINE.x + 160, 220, NINE.z - 110), // 9 号处转头
  new THREE.Vector3(FIVE.x + 100, 130, FIVE.z + 105), // 沿 9→5→1 对角线飞行
  new THREE.Vector3(ONE.x + 145, 86, ONE.z + 120), // 接近 1 号
  new THREE.Vector3(ONE.x + 76, 56, ONE.z + 168), // 1 号前低机位终点
]

const DIVE_TARGET = new THREE.Vector3(-100, 0, -690)
const LOOK_NODES = [
  DIVE_TARGET.clone(),
  DIVE_TARGET.clone(),
  DIVE_TARGET.clone(),
  new THREE.Vector3(-100, 15, -670),
  new THREE.Vector3(-100, 70, -650),
  new THREE.Vector3(-100, 110, -640),
  new THREE.Vector3(-100, 120, -640),
  new THREE.Vector3(-100, 120, -640),
  new THREE.Vector3(NINE.x, 96, NINE.z),
  new THREE.Vector3(FIVE.x, 96, FIVE.z),
  new THREE.Vector3(ONE.x, 98, ONE.z),
  new THREE.Vector3(ONE.x, 96, ONE.z),
  new THREE.Vector3(ONE.x, 92, ONE.z),
]

const CAMERA_PATH = new THREE.CatmullRomCurve3(CAMERA_NODES, false, 'centripetal', 0.38)
const LOOK_PATH = new THREE.CatmullRomCurve3(LOOK_NODES, false, 'centripetal', 0.38)
const INTRO_END = 34
const ease = (t: number) => t * t * (3 - 2 * t)

const CAM_POS = new THREE.Vector3(...CAM.pos)
const CAM_TARGET = new THREE.Vector3(...CAM.target)

// 调试机位（仅开发环境；生产构建不读 ?cam）：
//   ?cam=方位角,俯仰角,距离[,目标x,目标y,目标z]
const DEBUG_CAM = (() => {
  if (!import.meta.env.DEV || typeof location === 'undefined') return null
  const q = new URLSearchParams(location.search).get('cam')
  if (!q) return null
  const v = q.split(',').map(Number)
  if (v.length < 3 || v.slice(0, 3).some((x) => !Number.isFinite(x))) return null
  return {
    az: v[0], el: v[1], dist: v[2],
    target: new THREE.Vector3(v[3] ?? 0, v[4] ?? 22, v[5] ?? -340),
  }
})()

interface OrbitLike { target: THREE.Vector3; update: () => void }
type Phase = 'intro' | 'blendout' | 'free'

export default function CameraRig() {
  const controlsRef = useRef<OrbitLike | null>(null)
  const { camera, gl } = useThree()
  const phase = useRef<Phase>(DEBUG_CAM ? 'free' : 'intro')
  const startAt = useRef(0)
  const nowRef = useRef(0)
  const blend = useRef<{ t0: number; fromPos: THREE.Vector3; fromTgt: THREE.Vector3 } | null>(null)
  const setIntroActive = useSim((s) => s.setIntroActive)

  // 跳过（点击/滚轮/按键）与回放（HUD 按钮）
  useEffect(() => {
    if (DEBUG_CAM) {
      setIntroActive(false)
      return
    }
    const el = gl.domElement
    const skip = () => {
      if (phase.current !== 'intro') return
      const tgt = controlsRef.current?.target.clone() ?? CAM_TARGET.clone()
      blend.current = { t0: nowRef.current, fromPos: camera.position.clone(), fromTgt: tgt }
      phase.current = 'blendout'
    }
    const replay = () => {
      startAt.current = nowRef.current
      phase.current = 'intro'
      blend.current = null
      setIntroActive(true)
    }
    el.addEventListener('pointerdown', skip)
    el.addEventListener('wheel', skip, { passive: true })
    window.addEventListener('keydown', skip)
    window.addEventListener('aeolus:replay', replay)
    return () => {
      el.removeEventListener('pointerdown', skip)
      el.removeEventListener('wheel', skip)
      window.removeEventListener('keydown', skip)
      window.removeEventListener('aeolus:replay', replay)
    }
  }, [camera, gl, setIntroActive])

  useFrame((state) => {
    nowRef.current = state.clock.elapsedTime

    // 调试机位：直接锁定相机，跳过开场
    if (DEBUG_CAM) {
      const a = THREE.MathUtils.degToRad(DEBUG_CAM.az)
      const e = THREE.MathUtils.degToRad(DEBUG_CAM.el)
      const { dist, target } = DEBUG_CAM
      camera.position.set(
        target.x + dist * Math.cos(e) * Math.sin(a),
        target.y + dist * Math.sin(e),
        target.z + dist * Math.cos(e) * Math.cos(a),
      )
      camera.lookAt(target)
      const ctl0 = (state.controls as OrbitLike | null) || controlsRef.current
      if (ctl0) { ctl0.target.copy(target); ctl0.update() }
      const p0 = camera as THREE.PerspectiveCamera
      if (p0.fov !== 47) { p0.fov = 47; p0.updateProjectionMatrix() }
      return
    }

    if (!controlsRef.current) {
      controlsRef.current = (state.controls as OrbitLike | null) || null
    }

    const now = state.clock.elapsedTime

    if (phase.current === 'intro') {
      const t0 = now - startAt.current
      if (t0 > INTRO_END) {
        phase.current = 'free'
        setIntroActive(false)
        return
      }
      const progress = ease(Math.min(1, Math.max(0, t0 / INTRO_END)))
      const p = CAMERA_PATH.getPoint(progress)
      const tg = LOOK_PATH.getPoint(progress)
      camera.position.copy(p)
      camera.lookAt(tg)
      const ctl = controlsRef.current
      if (ctl) { ctl.target.copy(tg); ctl.update() }
      const perspective = camera as THREE.PerspectiveCamera
      perspective.fov = THREE.MathUtils.lerp(54, 47, progress)
      perspective.updateProjectionMatrix()
      return
    }

    if (phase.current === 'blendout' && blend.current) {
      const k = ease(Math.min(1, (now - blend.current.t0) / 1.2))
      camera.position.lerpVectors(blend.current.fromPos, CAM_POS, k)
      const tg = blend.current.fromTgt.clone().lerp(CAM_TARGET, k)
      camera.lookAt(tg)
      const ctl = controlsRef.current
      if (ctl) { ctl.target.copy(tg); ctl.update() }
      const perspective = camera as THREE.PerspectiveCamera
      perspective.fov = THREE.MathUtils.lerp(perspective.fov, CAM.fov, k)
      perspective.updateProjectionMatrix()
      if (k >= 1) {
        phase.current = 'free'
        blend.current = null
        setIntroActive(false)
      }
    }
  })

  return null
}
