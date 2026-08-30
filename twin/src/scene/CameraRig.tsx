/* oxlint-disable react/immutability -- 帧循环内 mutate refs/camera 为 R3F 控制标准模式（docs/08 D2） */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM } from './terrainUtil'
import { useSim } from '../state/simStore'
import { buildIntroProfile, BOOST_TABLE } from './introProfile'

// ============================================================================
// 开场巡航 + 机位书签 + 跳过（C5 修复）
// ----------------------------------------------------------------------------
//  · 34s 运镜保留（对位原宣传片）。第 24 轮：速度剖面改为 introProfile.ts
//    表驱动（-SKILL- 仓库 GSAP Inertia 技能语义的原生移植）——
//    直线加速 / 弯道减速环绕、13 段变速（~2.6s 一次方向反转）、
//    倍率 0.42~1.75（幅度大）、bank 侧倾 ≤6.2°、fov 随速 47→51.5；
//  · 开场/自由飞交接与松手：InertiaPlugin 语义——track 速度 →
//    指数滑行（τ=0.3s）减速停止，不再硬切（coast）；
//  · WASD 自由飞：惯性速度向量（按压 0.22s 指数爬升 / 松手 0.9s 滑行）；
//  · 书签机位（Phase 4 最小集）：键 1/2/3 = 全景 / 近排 / 升压站；
//    平滑过渡 1.2s（缓入缓出），期间冻结巡航。
//  · ?cam=方位角,俯仰角,距离[,tx,ty,tz] 调试机位仅在 DEV 或 ?debug=1 生效
//    （D10 修复：生产路径不再暴露内部开关）。
// ============================================================================

const CAM_BOOKMARKS = [
  { pos: new THREE.Vector3(60, 430, 990), target: new THREE.Vector3(0, 22, -340) },
  { pos: new THREE.Vector3(FARM[6].x + 170, 150, FARM[6].z + 250), target: new THREE.Vector3(FARM[6].x, 74, FARM[6].z) },
  { pos: new THREE.Vector3(-340, 250, 760), target: new THREE.Vector3(300, 20, 300) },
] as const

const CAMERA_NODES = [
  new THREE.Vector3(-100, 1720, -640), // 正上空起始点
  new THREE.Vector3(-100, 720, -640), // 竖直俯冲
  new THREE.Vector3(-100, 300, -640), // 俯冲最低点
  new THREE.Vector3(-100, 300, -520), // 低位后退
  new THREE.Vector3(-100, 330, -200), // 微抬继续后退
  new THREE.Vector3(-100, 390, 250), // 抬头进入远景
  new THREE.Vector3(60, 480, 990), // 全景构图
  new THREE.Vector3(120, 470, 900), // 全景缓行
  new THREE.Vector3(FARM[2].x + 145, 210, FARM[2].z - 160), // 快速前推至 T03
  new THREE.Vector3(FARM[2].x + 160, 220, FARM[2].z - 110), // T03 处转头
  new THREE.Vector3(FARM[4].x + 100, 130, FARM[4].z + 105), // 沿对角线穿 T05
  new THREE.Vector3(FARM[6].x + 145, 86, FARM[6].z + 120), // 接近 T07
  new THREE.Vector3(FARM[6].x + 76, 56, FARM[6].z + 168), // T07 前低机位终点
]
const DIVE_TARGET = new THREE.Vector3(-100, 0, -690)
const LOOK_NODES = [
  DIVE_TARGET.clone(), DIVE_TARGET.clone(), DIVE_TARGET.clone(),
  new THREE.Vector3(-100, 15, -670),
  new THREE.Vector3(-100, 70, -650),
  new THREE.Vector3(-100, 110, -640),
  new THREE.Vector3(-100, 120, -640),
  new THREE.Vector3(-100, 120, -640),
  new THREE.Vector3(FARM[2].x, 96, FARM[2].z),
  new THREE.Vector3(FARM[4].x, 96, FARM[4].z),
  new THREE.Vector3(FARM[6].x, 98, FARM[6].z),
  new THREE.Vector3(FARM[6].x, 96, FARM[6].z),
  new THREE.Vector3(FARM[6].x, 92, FARM[6].z),
]

const CAMERA_PATH = new THREE.CatmullRomCurve3(CAMERA_NODES, false, 'centripetal', 0.38)
const LOOK_PATH = new THREE.CatmullRomCurve3(LOOK_NODES, false, 'centripetal', 0.38)
const INTRO_END = 34
// 第 16 轮：收尾环绕两点修正保留（方向 65.6°→268° 跨 180° 西侧绕行；
// 单一时间基保证一阶连续）。第 24 轮：角度轨迹改为 Hermite 三次
// （起点角速度 = 巡航出口速度/R0 匹配接管，中程自然加速，终点 0.10 rad/s
// 缓停进悬停）——环绕不再"从零起步"，与巡航出口无缝衔接。
const ORBIT_DUR = 9
const INTRO_TOTAL = INTRO_END + ORBIT_DUR
const ORBIT_A0 = Math.atan2(168, 76)              // 原终点方位（后侧）
const ORBIT_A1 = THREE.MathUtils.degToRad(268)    // 叶轮正前方（-92°+360，取递增方向绕行）
const ORBIT_R0 = Math.hypot(76, 168)
const ORBIT_R1 = 196
const ORBIT_Y0 = 56
const ORBIT_Y1 = 66

// —— 第 24 轮：速度剖面（模块级一次性构建，确定性）——
const PROFILE = buildIntroProfile(CAMERA_PATH, INTRO_END, 170, 40, 400, BOOST_TABLE)
// 收尾环绕角速度：出口匹配（巡航终点速度 × 切向对齐度 / R0），终点缓停
const ORBIT_DTAN = new THREE.Vector3(-Math.sin(ORBIT_A0), 0, Math.cos(ORBIT_A0))
const exitAlign = Math.max(0.25, ORBIT_DTAN.dot(PROFILE.exitTangent.clone().setY(0).normalize()))
const ORBIT_W0 = THREE.MathUtils.clamp((PROFILE.vExit * exitAlign) / ORBIT_R0, 0.10, 0.60)
const ORBIT_W1 = 0.10
const ORBIT_DANG = ORBIT_A1 - ORBIT_A0
function orbitAngle(e: number): number {
  const h10 = e * e * e - 2 * e * e + e
  const h01 = -2 * e * e * e + 3 * e * e
  const h11 = e * e * e - e * e
  return ORBIT_A0 + h10 * (ORBIT_W0 * ORBIT_DUR) + h01 * ORBIT_DANG + h11 * (ORBIT_W1 * ORBIT_DUR)
}
function orbitOmega(e: number): number {
  if (e <= 0.002) return ORBIT_W0
  if (e >= 0.998) return ORBIT_W1
  return (orbitAngle(e + 0.002) - orbitAngle(e - 0.002)) / (ORBIT_DUR * 0.004)
}
const HUB = new THREE.Vector3(FARM[6].x, 0, FARM[6].z)

const ease = (t: number) => t * t * (3 - 2 * t)
const smooth01 = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1)
  return t * t * (3 - 2 * t)
}

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

// —— 惯性参数（InertiaPlugin 语义：track → 指数滑行）——
const COAST_TAU = 0.3      // 交接滑行时间常数 (s)
const COAST_MAX_T = 1.5    // 最长滑行 (s)
const COAST_MAX_DRIFT = 120 // 最大漂移 (m)，防穿几何
const FLY_TAU_ON = 0.22    // WASD 按压爬升 (s)
const FLY_TAU_OFF = 0.9    // WASD 松手滑行 (s)

export default function CameraRig() {
  const controlsRef = useRef<any>(null)
  const { camera } = useThree()
  const introStart = useRef<number | null>(null)
  // 开场独立时钟：帧间增量累加（而非绝对 elapsedTime）。
  // 首帧 PMREM/shader 编译会让 elapsed 一次性跳几秒，若直接当 el 用，
  // 相机在开场前几秒会“瞬移数秒”造成超大卡顿——这里单帧钳到 1/30s，
  // 渲染停顿被吸收为“原地微停”，运动保持连续丝滑。
  const introClock = useRef(0)
  const bookmark = useRef<{ from: THREE.Vector3; fromT: THREE.Vector3; to: THREE.Vector3; toT: THREE.Vector3; t0: number } | null>(null)

  // —— 第 24 轮：惯性状态 ——
  // 巡航中 track 的速度（位置/注视点），供 coast 与 WASD 交接
  const vTrack = useRef(new THREE.Vector3())
  const vTgtTrack = useRef(new THREE.Vector3())
  const prevPos = useRef(new THREE.Vector3())
  const prevTgt = useRef(new THREE.Vector3())
  const coast = useRef<{ p0: THREE.Vector3; t0: THREE.Vector3; v: THREE.Vector3; vt: THREE.Vector3; t0clk: number } | null>(null)
  const flyV = useRef(new THREE.Vector3())

  // WASD 飞行输入（任务#6）：按住即进入自由飞行；intro 中按飞行键=跳过+起飞
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
      const ctl0 = (state.controls as any) || controlsRef.current
      if (ctl0) { ctl0.target.copy(target); ctl0.update() }
      const p0 = camera as THREE.PerspectiveCamera
      p0.fov = 47
      p0.updateProjectionMatrix()
      if (!useSim.getState().introDone) useSim.getState().skipIntro()
      return
    }

    // 书签过渡
    const bm = bookmark.current
    if (bm) {
      const k = Math.min(1, (performance.now() - bm.t0) / 1200)
      const s = ease(k)
      camera.position.lerpVectors(bm.from, bm.to, s)
      const tg = bm.fromT.clone().lerp(bm.toT, s)
      camera.lookAt(tg)
      const ctl = controlsRef.current
      if (ctl) { ctl.target.copy(tg); ctl.update() }
      if (k >= 1) bookmark.current = null
      return
    }

    const s = useSim.getState()
    // 开场期间关闭 OrbitControls 的帧循环 update：它每帧重跑 lookAt(target)，
    // 会抹掉巡航的 bank 侧倾，且在 damping 下产生持续的“沉降”抖动。
    // 开场结束后再启用，交给用户拖拽/缩放。
    const ctlAny = controlsRef.current
    if (ctlAny && ctlAny.enabled !== s.introDone) ctlAny.enabled = s.introDone
    if (NO_INTRO && !s.introDone) {
      s.skipIntro()
      return
    }

    // —— 第 24 轮：惯性滑行（coast）——开场/跳过 到 自由轨道的交接
    // InertiaPlugin 语义：track 到的速度按 exp(-t/τ) 衰减积分，无缝减速停止
    const co = coast.current
    if (co) {
      // 按任意飞行键 = 立即接管（取消滑行）
      if (keys.current.size > 0) {
        coast.current = null
        useSim.getState().skipIntro()
        flyV.current.copy(co.v) // 把滑行速度直接交给 WASD 惯性
        return
      }
      const tc = state.clock.elapsedTime - co.t0clk
      const k = 1 - Math.exp(-tc / COAST_TAU)
      const off = COAST_TAU * k
      const drift = co.v.length() * off
      const p = new THREE.Vector3(
        co.p0.x + co.v.x * off,
        Math.max(14, co.p0.y + co.v.y * off),
        co.p0.z + co.v.z * off,
      )
      const tg = new THREE.Vector3(
        co.t0.x + co.vt.x * off,
        co.t0.y + co.vt.y * off,
        co.t0.z + co.vt.z * off,
      )
      camera.position.copy(p)
      camera.lookAt(tg)
      const ctc = controlsRef.current
      if (ctc) { ctc.target.copy(tg); ctc.update() }
      const vNow = co.v.length() * Math.exp(-tc / COAST_TAU)
      if (tc >= COAST_MAX_T || vNow < 5 || drift >= COAST_MAX_DRIFT) {
        coast.current = null
        useSim.getState().skipIntro()
      }
      return
    }

    if (s.introDone) {
      // ---- 自由飞行（第 24 轮：惯性速度）：W/S 沿视线，A/D 横移，Space/C 升降，Shift=加速 ----
      const k = keys.current
      const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0)
      const strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0)
      const lift = (k.has('Space') ? 1 : 0) - (k.has('KeyC') ? 1 : 0)
      const ctl = controlsRef.current
      if (fwd || strafe || lift) {
        const maxV = (k.has('ShiftLeft') || k.has('ShiftRight') ? 620 : 240)
        const dir = new THREE.Vector3()
        camera.getWorldDirection(dir)
        const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize()
        const des = new THREE.Vector3()
        des.addScaledVector(dir, fwd)
        des.addScaledVector(right, strafe)
        des.y += lift * 0.8
        des.normalize().multiplyScalar(maxV)
        // 按压：指数爬升（τ=0.22s）——不再瞬达
        flyV.current.lerp(des, 1 - Math.exp(-Math.min(delta, 0.1) / FLY_TAU_ON))
      } else if (flyV.current.lengthSq() > 1) {
        // 松手：指数滑行（τ=0.9s）——InertiaPlugin inertia:"auto" 的落地
        flyV.current.multiplyScalar(Math.exp(-Math.min(delta, 0.1) / FLY_TAU_OFF))
        if (flyV.current.lengthSq() < 2.25) flyV.current.set(0, 0, 0)
      }
      const fly = flyV.current
      if (fly.lengthSq() > 0) {
        const dt = Math.min(delta, 0.1)
        const mv = fly.clone().multiplyScalar(dt)
        const ny = camera.position.y + mv.y
        if (ny > 14 && ny < 4600) {
          camera.position.add(mv)
          if (ctl) { ctl.target.add(mv); ctl.update() }
        } else {
          mv.y = 0
          camera.position.add(mv)
          if (ctl) { ctl.target.add(mv); ctl.update() }
        }
      }
      return
    }

    const t0 = state.clock.elapsedTime
    if (introStart.current === null) {
      introStart.current = t0
      introClock.current = 0
    }
    // 帧间增量累加，单帧钳 0.1s：首帧/PMREM/Shader 编译的“多秒级”停顿
    // 会被吸收（不会让相机瞬移数秒），同时 30–60fps 正常帧率下完全按真实
    // 时长推进，开场不会变慢。渲染停顿被表现为“原地微停”，运动保持连续。
    const dtSafe = Math.min(Math.max(delta, 0.001), 0.1)
    introClock.current += dtSafe
    const el = introClock.current

    // —— track：本帧速度（供 coast 交接），带 0.5 平滑去帧时抖动 ——
    const dtc = Math.min(Math.max(delta, 0.001), 0.05)
    const vNow = camera.position.clone().sub(prevPos.current).divideScalar(dtc)
    vTrack.current.lerp(vNow, 0.5)
    const vTgtNow = (controlsRef.current?.target ?? HUB).clone().sub(prevTgt.current).divideScalar(dtc)
    vTgtTrack.current.lerp(vTgtNow, 0.5)

    if (el < INTRO_END) {
      // —— 巡航段：表驱动速度（直线加速 / 弯道减速 / 13 段 boost）——
      const st = PROFILE.lookup(el)
      const p = CAMERA_PATH.getPointAt(st.frac)
      const tg = LOOK_PATH.getPointAt(st.frac)
      camera.position.copy(p)
      camera.lookAt(tg)
      // 转弯侧倾（≤6.2°，克制）：右转(signedK>0)→右倾→rotateZ 取负
      camera.rotateZ(-st.bank)
      const ctl = controlsRef.current
      // 开场期间不加 ctl.update()：OrbitControls 会重跑 lookAt(target) 抹平
      // 侧倾 bank，且 disabled 时不允许其接管相机。只同步目标点，供结束后接管。
      if (ctl) ctl.target.copy(tg)
      const perspective = camera as THREE.PerspectiveCamera
      // 速度感 fov + 开场 3s 广角俯冲（54→）
      perspective.fov = st.fov + 6 * (1 - smooth01(Math.min(1, el / 3)))
      perspective.updateProjectionMatrix()
    } else {
      // —— 收尾环绕：Hermite 角轨迹，出口速度匹配接管 ——
      const e = Math.min(1, (el - INTRO_END) / ORBIT_DUR)
      const ang = orbitAngle(e)
      const om = orbitOmega(e)
      const rad = THREE.MathUtils.lerp(ORBIT_R0, ORBIT_R1, smooth01(e))
      const hubY = THREE.MathUtils.lerp(92, 96, e)
      camera.position.set(
        HUB.x + Math.cos(ang) * rad,
        THREE.MathUtils.lerp(ORBIT_Y0, ORBIT_Y1, e),
        HUB.z + Math.sin(ang) * rad,
      )
      const hub = new THREE.Vector3(HUB.x, hubY, HUB.z)
      camera.lookAt(hub)
      // 环绕侧倾：a_lat = ω²R 同映射；起始 0.8s 与巡航末端 roll 交叉淡化
      const aLat = om * om * rad
      let bankOrbit = 0.108 * Math.sqrt(THREE.MathUtils.clamp((aLat - 1.5) / 50, 0, 1))
      const pathExitBank = -PROFILE.lookup(INTRO_END).bank
      bankOrbit = THREE.MathUtils.lerp(pathExitBank, bankOrbit, smooth01(Math.min(1, e / 0.09)))
      camera.rotateZ(bankOrbit)
      const ctlO = controlsRef.current
      // 同上：开场期间不加 update()，仅同步目标点（保留 bank 侧倾）
      if (ctlO) ctlO.target.copy(hub)
      const pO = camera as THREE.PerspectiveCamera
      const span = Math.max(PROFILE.vMax - PROFILE.vMin, 1e-3)
      pO.fov = 47 + 4.5 * smooth01((om * rad - PROFILE.vMin) / span)
      pO.updateProjectionMatrix()
      if (el >= INTRO_TOTAL) {
        // 收尾完成 → 惯性滑行进自由轨道（近悬停，漂移 <10m）
        coast.current = {
          p0: camera.position.clone(),
          t0: hub.clone(),
          v: vTrack.current.clone(),
          vt: vTgtTrack.current.clone(),
          t0clk: t0,
        }
      }
    }

    prevPos.current.copy(camera.position)
    const tgNow = controlsRef.current ? controlsRef.current.target : HUB
    prevTgt.current.copy(tgNow)
  })

  return null
}
