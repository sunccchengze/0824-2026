/* oxlint-disable react/globals -- startSimClock 是模块级外部时钟驱动，非组件内可变全局（docs/08 D2） */
import { create } from 'zustand'
import { FARM, SERVOS } from '../scene/terrainUtil'
import { optimizeYaw, farmFrame, N_UNITS, type FarmFrame } from '../data/farmSim'

// ================================================================
// 全局仿真控制状态（zustand）
// ----------------------------------------------------------------
// 这里只放 *控制状态*（时间轴/偏航指令/目标功率/选择/告警确认/画质档）；
// 全部 *运行读数* 由 data/farmSim.farmFrame(t, yaw, target) 纯函数派生，
// HUD 与 3D 场景读同一帧 —— 这是评审 A5"数据全死、零联动"的根因修复。
// ================================================================

export type QualityTier = 'high' | 'medium' | 'low'

export interface SimState {
  // 时间轴（24h 循环；真实 50s = 模拟 24h，与原图 00:50 口径一致）
  tHours: number
  playing: boolean
  togglePlay: () => void
  seek: (h: number) => void

  // 9 机偏航指令（绝对机舱方位；0° = 朝北，与"北来风"对风）
  unitYaw: number[]
  setUnitYaw: (i: number, v: number) => void

  // 需求功率闭环（研究内容③：输入功率 → 输出各机偏航角/限功率）
  targetMW: number // 45 = 不限
  setTargetMW: (v: number) => void

  // 寻优结果回显（HUD 状态行）
  optimizeNote: string | null
  optimizeStamp: number
  runOptimize: () => void
  resetYaw: () => void

  // 单机选择（矩阵点击 ↔ 3D 高亮 ↔ 信息卡）
  selected: number | null
  setSelected: (i: number | null) => void

  // 已确认告警（key 列表）
  ackedAlarms: number[]
  ackAlarm: (k: number) => void

  // 画质档（自适应 + 手动覆盖）
  quality: QualityTier
  qualityAuto: boolean
  setQuality: (q: QualityTier, manual?: boolean) => void

  // 开场巡航：可跳过（评审 C5：34s 不可跳过是答辩事故）
  introDone: boolean
  skipIntro: () => void

  // WebGL 兜底（D6）
  fatal: string | null
  setFatal: (m: string | null) => void
}

const ZERO_YAW = new Array<number>(N_UNITS).fill(0)

export const useSim = create<SimState>((set, get) => ({
  tHours: 10,
  playing: true,
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  seek: (h) => set({ tHours: ((h % 24) + 24) % 24 }),

  unitYaw: [...ZERO_YAW],
  setUnitYaw: (i, v) =>
    set((s) => {
      const unitYaw = [...s.unitYaw]
      unitYaw[i] = Math.max(-40, Math.min(40, v))
      return { unitYaw }
    }),

  targetMW: 45,
  setTargetMW: (v) => set({ targetMW: Math.max(4, Math.min(45, v)) }),

  optimizeNote: null,
  optimizeStamp: 0,
  runOptimize: () => {
    const s = get()
    const r = optimizeYaw(s.tHours, s.unitYaw)
    const delta = r.totalMW - r.baseMW
    set({
      unitYaw: r.unitYaw,
      optimizeStamp: Date.now(),
      optimizeNote:
        delta > 0.005
          ? `寻优完成：全场 ${(r.totalMW * 1000).toFixed(0)} kW（较指令前 +${(delta * 1000).toFixed(0)} kW / +${r.gainPct.toFixed(1)}%）【演示·Jensen 代理】`
          : `当前偏航已处于代理模型极值附近，增益不足 ${(Math.max(0, delta) * 1000).toFixed(0)} kW【演示·Jensen 代理】`,
    })
  },
  resetYaw: () =>
    set({ unitYaw: [...ZERO_YAW], optimizeNote: '偏航指令已复位：全场对风 0°（基准工况）', optimizeStamp: Date.now() }),

  selected: null,
  setSelected: (i) => set({ selected: i }),

  ackedAlarms: [],
  ackAlarm: (k) =>
    set((s) => (s.ackedAlarms.includes(k) ? {} : { ackedAlarms: [...s.ackedAlarms, k] })),

  quality: 'high',
  qualityAuto: true,
  setQuality: (q, manual) => set(manual ? { quality: q, qualityAuto: false } : { quality: q }),

  introDone: false,
  skipIntro: () => set({ introDone: true }),

  fatal: null,
  setFatal: (m) => set({ fatal: m }),
}))

/** 偏航执行器 i ↔ 机组下标（唯一映射，评审 D7 的"双映射地雷"已拆除） */
export const SERVO_UNIT: number[] = [...SERVOS]

/** 仿真时钟驱动（真实 50s = 模拟 24h）。main.tsx 启动一次。 */
let clockStarted = false
export function startSimClock() {
  if (clockStarted) return
  clockStarted = true
  let last = performance.now()
  setInterval(() => {
    const now = performance.now()
    const dt = (now - last) / 1000
    last = now
    const s = useSim.getState()
    if (s.playing && !s.fatal) {
      useSim.setState({ tHours: (s.tHours + dt * (24 / 50)) % 24 })
    }
  }, 100)
}

// ---- 帧访问封装 ----
// HUD：按 store tick（100ms）取帧；键控缓存保证同一 tick 内多组件一帧。
let hudKey = ''
let hudFrame: FarmFrame | null = null
export function useFarmFrame(): FarmFrame {
  const tHours = useSim((s) => s.tHours)
  const unitYaw = useSim((s) => s.unitYaw)
  const targetMW = useSim((s) => s.targetMW)
  const key = `${tHours}|${unitYaw.join(',')}|${targetMW}`
  if (key !== hudKey || !hudFrame) {
    hudKey = key
    hudFrame = farmFrame(tHours, unitYaw, targetMW)
  }
  return hudFrame
}

/** 3D 用：每帧即时读数（useFrame 内直读，绕开 React setState） */
export function farmFrameNow(): FarmFrame {
  const s = useSim.getState()
  return farmFrame(s.tHours, s.unitYaw, s.targetMW)
}

/** 机组 id ↔ 下标 */
export const unitIndexById = new Map(FARM.map((f, i) => [f.id, i] as const))
