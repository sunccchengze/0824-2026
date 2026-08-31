/* oxlint-disable react/immutability -- 帧循环内 mutate refs/camera 为 R3F 控制标准模式（docs/08 D2） */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CAM, FARM } from './terrainUtil'
import { useSim } from '../state/simStore'
import {
  CAMERA_PATH, LOOK_PATH, INTRO_END,
} from './introProfile'

// ============================================================================
// 开场巡航 + 机位书签 + 自由飞行（丝滑无抖动版）
// ----------------------------------------------------------------------------
//  · 34s + 9s 环绕全局单一时间基（ease 缓入缓出，C1 连续，无停顿、无摆动、无抖动）；
//  · 消除前 5 秒黑屏与 180 度翻转：高空俯冲注视点稳定朝向风场中轴，远离垂直奇异点；
//  · 巡航期间禁用 OrbitControls 抢镜；巡航/环绕结束后平滑交接；
//  · 保持视平线稳定，移除造成摇晃抖动的侧倾(bank)与速度阶跃；
//  · 书签机位：键 1/2/3 = 全景 / 近排 / 升压站；
//  · WASD 自由飞行支持。
// ============================================================================

const CAM_BOOKMARKS = [
  { pos: new THREE.Vector3(60, 430, 990), target: new THREE.Vector3(0, 22, -340) },
  { pos: new THREE.Vector3(FARM[6].x + 170, 150, FARM[6].z + 250), target: new THREE.Vector3(FARM[6].x, 74, FARM[6].z) },
  { pos: new THREE.Vector3(-340, 250, 760), target: new THREE.Vector3(300, 20, 300) },
] as const

const ORBIT_DUR = 9
const INTRO_TOTAL = INTRO_END + ORBIT_DUR
const PATH_FRAC = INTRO_END / INTRO_TOTAL
const ORBIT_A0 = Math.atan2(168, 76)
const ORBIT_A1 = THREE.MathUtils.degToRad(268)
const ORBIT_R0 = Math.hypot(76, 168)
const ORBIT_R1 = 196
const ORBIT_Y0 = 56
const ORBIT_Y1 = 66
const HUB = new THREE.Vector3(FARM[6].x, 0, FARM[6].z)

const ease = (t: number) => t * t * (3 - 2 * t)

const DEBUG_ALLOWED = (typeof import.meta !== 'undefined' && import.meta.env?.DEV === true)
  || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug'))

const DEBUG_CAM = (() => {
  if (!DEBUG_ALLOWED || typeof location === 'undefined') return null
  const q = new URLSearchParams(location.search).get('cam')
  if (!q) return null
  const v = q.split(',').map(Number)
  if (v.length < 3 || v.slice(0, 3).some((x) => !Number.isFinite(x))) return null
  return {
    az: v[0], el: v[1], dist: v[2],
    target: new THREE.Vector3(v[3] ?? 0, v[4] ?? 22, v[5] ?? -340),
  }
})()

const NO_INTRO = typeof location !== 'undefined'
  && (new URLSearchParams(location.search).has('intro0') || (DEBUG_ALLOWED && new URLSearchParams(location.search).get('intro') === '0'))

// QA / A/B 帧精确锚点：仅 DEBUG 允许 `?introT=<s>` 冻结开场时钟（软渲染可复现指定帧）。
const INTRO_T_JUMP = (() => {
  if (!DEBUG_ALLOWED || typeof location === 'undefined') return null
  const q = new URLSearchParams(location.search).get('introT')
  if (!q) return null
  const v = Number(q)
  return Number.isFinite(v) ? THREE.MathUtils.clamp(v, 0, INTRO_TOTAL) : null
})()

// —— “目标 + 指数平滑跟随”：不再每帧硬设 position/lookAt（掉帧/切换瞬间会“顿/跳”），
//    而是每帧只追目标。τ=0.09s：60fps 跟得紧无拖影，掉帧时把单帧大位移摊到后续帧。
//    核心价值：把“巡航→环绕”“环绕→coast”以及任何 / 斜率切换的残余视觉跳变彻底抹平。
const CAM_SMOOTH_TAU = 0.09
const _eUp = new THREE.Vector3(0, 1, 0)
const _eLook = new THREE.Matrix4()
const _eQuat = new THREE.Quaternion()
// 复用目标/自由飞行临时对象，避免热身路径每帧 new Vector3 触发 GC
const _tPos = new THREE.Vector3()
const _tLook = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()
const _mv = new THREE.Vector3()

export default function CameraRig() {
  const controlsRef = useRef<any>(null)
  const { camera } = useThree()
  const introStart = useRef<number | null>(null)
  const bookmark = useRef<{ from: THREE.Vector3; fromT: THREE.Vector3; to: THREE.Vector3; toT: THREE.Vector3; t0: number } | null>(null)

  // 平滑跟随状态：首帧用目标自身初始化，避免起步跳变
  const smPos = useRef(new THREE.Vector3())
  const smLook = useRef(new THREE.Vector3())
  const smFov = useRef(47)
  const smInit = useRef(false)

  // WASD 自由飞行输入
  const keys = useRef<Set<string>>(new Set())
  useEffect(() => {
    const FLY = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'Space'])
    const down = (e: KeyboardEvent) => {
      if (e.repeat || !(FLY.has(e.code) || e.code === 'ShiftLeft' || e.code === 'ShiftRight')) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
      keys.current.add(e.code)
      if (FLY.has(e.code)) {
        if (!useSim.getState().introDone && !DEBUG_CAM) useSim.getState().skipIntro()
        if (e.code === 'Space' && useSim.getState().introDone) e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => { keys.current.delete(e.code) }
    const blur = () => keys.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // 全局快捷键：Esc 跳过 / 1-3 书签
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useSim.getState()
      if (e.key === 'Escape' || e.key === ' ' || e.key.toLowerCase() === 'y') {
        if (!s.introDone) s.skipIntro()
      }
      const n = Number(e.key)
      if (n >= 1 && n <= CAM_BOOKMARKS.length) {
        const b = CAM_BOOKMARKS[n - 1]
        const p = camera.position.clone()
        const ctl = controlsRef.current
        bookmark.current = {
          from: p, fromT: ctl ? ctl.target.clone() : new THREE.Vector3(0, 22, -340),
          to: b.pos.clone(), toT: b.target.clone(), t0: performance.now(),
        }
        useSim.getState().skipIntro()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera])

  useFrame((state, delta) => {
    if (!controlsRef.current) controlsRef.current = (state.controls as any) || null
    const ctl = controlsRef.current

    if (DEBUG_CAM) {
      if (ctl) ctl.enabled = true
      const a = THREE.MathUtils.degToRad(DEBUG_CAM.az)
      const e = THREE.MathUtils.degToRad(DEBUG_CAM.el)
      const { dist, target } = DEBUG_CAM
      camera.position.set(
        target.x + dist * Math.cos(e) * Math.sin(a),
        target.y + dist * Math.sin(e),
        target.z + dist * Math.cos(e) * Math.cos(a),
      )
      camera.lookAt(target)
      if (ctl) { ctl.target.copy(target); ctl.update() }
      const p0 = camera as THREE.PerspectiveCamera
      p0.fov = 47
      p0.updateProjectionMatrix()
      if (!useSim.getState().introDone) useSim.getState().skipIntro()
      return
    }

    // 书签机位平滑过渡
    const bm = bookmark.current
    if (bm) {
      if (ctl) ctl.enabled = false
      const k = Math.min(1, (performance.now() - bm.t0) / 1200)
      const s = ease(k)
      camera.position.lerpVectors(bm.from, bm.to, s)
      const tg = bm.fromT.clone().lerp(bm.toT, s)
      camera.lookAt(tg)
      if (k >= 1) {
        bookmark.current = null
        if (ctl) {
          ctl.enabled = true
          ctl.target.copy(bm.toT)
          ctl.update()
        }
      }
      return
    }

    const s = useSim.getState()
    if (NO_INTRO && !s.introDone) {
      s.skipIntro()
      if (ctl) {
        ctl.enabled = true
        ctl.target.copy(CAM.target)
        ctl.update()
      }
      return
    }

    if (s.introDone) {
      // 开场中途跳过（Esc / 点击 / 键1-3 / WASD）时，introDone 立即为 true，
      // 但 OrbitControls 在巡航期间一直 disabled，内部球坐标是陈旧值。
      // 若不先把 controls.target/update() 同步到当前平滑注视点，用户第一次拖动
      // 会先“回弹/跳一下”（round25 曾修、借来的分支已丢掉此逻辑）。
      if (ctl && !ctl.enabled) {
        ctl.target.copy(smLook.current)
        ctl.update()
      }
      if (ctl) ctl.enabled = true
      // WASD 自由飞行
      const k = keys.current
      const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0)
      const strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0)
      const lift = (k.has('Space') ? 1 : 0) - (k.has('KeyC') ? 1 : 0)
      if (fwd || strafe || lift) {
        const v = (k.has('ShiftLeft') || k.has('ShiftRight') ? 620 : 240) * Math.min(0.05, delta)
        camera.getWorldDirection(_dir)
        _right.crossVectors(_dir, camera.up).normalize()
        _mv.set(0, 0, 0)
        _mv.addScaledVector(_dir, fwd * v)
        _mv.addScaledVector(_right, strafe * v)
        _mv.y += lift * v * 0.8
        const ny = camera.position.y + _mv.y
        if (ny < 14 || ny > 4600) _mv.y = 0
        camera.position.add(_mv)
        if (ctl) { ctl.target.add(_mv); ctl.update() }
      }
      return
    }

    // 巡航期间独占控制相机，禁用 OrbitControls 干扰与夹角约束
    if (ctl) ctl.enabled = false

    // 开场独立时钟：帧间增量累加（而非绝对 elapsedTime）。首帧/编译停顿若用
    // 绝对时钟会一次跳数秒造成前几秒“黑屏/闪跳”；这里单帧钳 0.1s，停顿被涂抹，
    // 正常帧率完全按真实时长推进。
    if (introStart.current === null) {
      introStart.current = 0
    }
    let el: number
    if (INTRO_T_JUMP !== null) {
      el = INTRO_T_JUMP
    } else {
      el = introStart.current
      const dtSafe = delta > 0.5 ? 0.1 : Math.max(delta, 0.001)
      introStart.current += dtSafe
    }
    // 单一全局时间基：整个运镜一阶连续，首尾自然缓入缓出，全程丝滑无顿挫
    const u = ease(Math.min(1, el / INTRO_TOTAL))

    // —— 计算本帧目标机位/朝向/侧倾/fov（先算，再平滑应用）——
    // 复用 _tPos/_tLook（CAMERA_PATH.getPoint 会覆写目标向量，不新建对象）
    let tPos = _tPos
    let tLook = _tLook
    let tFov: number
    if (u >= PATH_FRAC) {
      // —— 收尾环绕：从后侧经西侧绕到叶轮正面 ——
      const e = (u - PATH_FRAC) / (1 - PATH_FRAC)
      const ang = THREE.MathUtils.lerp(ORBIT_A0, ORBIT_A1, e)
      const rad = THREE.MathUtils.lerp(ORBIT_R0, ORBIT_R1, e)
      const hubY = THREE.MathUtils.lerp(92, 96, e)
      tPos.set(HUB.x + Math.cos(ang) * rad, THREE.MathUtils.lerp(ORBIT_Y0, ORBIT_Y1, e), HUB.z + Math.sin(ang) * rad)
      tLook.set(HUB.x, hubY, HUB.z)
      tFov = 47
    } else {
      const progress = u / PATH_FRAC
      CAMERA_PATH.getPoint(progress, tPos)
      LOOK_PATH.getPoint(progress, tLook)
      tFov = THREE.MathUtils.lerp(52, 47, progress)
    }

    // —— 平滑应用：位置/朝向/fov 指数跟随目标 ——
    const alpha = 1 - Math.exp(-Math.min(Math.max(delta, 0.001), 0.25) / CAM_SMOOTH_TAU)
    if (!smInit.current) {
      smPos.current.copy(tPos)
      smLook.current.copy(tLook)
      smFov.current = tFov
      smInit.current = true
    } else {
      smPos.current.lerp(tPos, alpha)
      smLook.current.lerp(tLook, alpha)
      smFov.current += (tFov - smFov.current) * alpha
    }
    camera.position.copy(smPos.current)
    _eLook.lookAt(smPos.current, smLook.current, _eUp)
    _eQuat.setFromRotationMatrix(_eLook)
    camera.quaternion.slerp(_eQuat, alpha)
    const perspective = camera as THREE.PerspectiveCamera
    perspective.fov = smFov.current
    perspective.updateProjectionMatrix()
    const ctlS = controlsRef.current
    if (ctlS) ctlS.target.copy(smLook.current)

    if (el >= INTRO_TOTAL && !useSim.getState().introDone) {
      useSim.getState().skipIntro()
      if (ctl) {
        ctl.enabled = true
        ctl.target.copy(smLook.current)
        // 让 OrbitControls 内部球坐标与当前相机/焦点一致后再启用，避免交接“回弹/跳变”
        ctl.update()
      }
    }
  })

  return null
}
