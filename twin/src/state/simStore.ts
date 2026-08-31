/* oxlint-disable react/globals -- startSimClock 是模块级外部时钟驱动，非组件内可变全局（docs/08 D2） */
import { create } from 'zustand'
import { FARM, SERVOS } from '../scene/terrainUtil.ts'
import { optimizeYaw, farmFrame, FARM_RATED_MW, N_UNITS, type FarmFrame } from '../data/farmSim.ts'
import { generateAnomalyPlan, applyAnomalyToFrame, type AnomalyPlan } from '../data/anomaly.ts'

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
  airflow: boolean
  setAirflow: (v: boolean) => void
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

  // 随机异常事件（每模拟日 1 次，完全随机；演示剧本）
  anomalyCycle: number
  anomalyPlan: AnomalyPlan | null
  anomalyActive: AnomalyPlan | null
  anomalyFired: boolean
  anomalyModal: { plan: AnomalyPlan; auto: boolean } | null
  ensureAnomalyPlan: (cycle: number) => void
  stepAnomaly: (prevH: number, nextH: number) => void
  repairAnomaly: (auto: boolean) => void
  closeAnomalyModal: () => void

  // WebGL 兜底（D6）
  fatal: string | null
  setFatal: (m: string | null) => void
}

const ZERO_YAW = new Array<number>(N_UNITS).fill(0)

export const useSim = create<SimState>((set, get) => ({
  // 默认进入时刻改为 t=6（日出后高清高功率段）：与《日间氛围_参考基线》
  // 06:12 帧一致，HUD 首屏即展示 ~14MW 高功率 + 低角度晨光最长光影梯度；
  // 避免默认 t=10 落在日内风速低谷（~5.6MW）让人误以为“功率被降低”。
  tHours: 6,
  playing: true,
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  seek: (h) => set({ tHours: ((h % 24) + 24) % 24 }),

  unitYaw: [...ZERO_YAW],
  // 量程与滑杆（±30）/寻优候选（±30）统一——旧值 ±40 是不可达的死余量，
  // 一旦有路径写入 >30 会出现“滑杆顶死 30 而 store 存 34.5”的显示/指令分歧
  setUnitYaw: (i, v) =>
    set((s) => {
      const unitYaw = [...s.unitYaw]
      unitYaw[i] = Math.max(-30, Math.min(30, v))
      return { unitYaw }
    }),

  targetMW: 45,
  setTargetMW: (v) => set({ targetMW: Math.max(4, Math.min(45, v)) }),

  optimizeNote: null,
  optimizeStamp: 0,
  runOptimize: () => {
    const s = get()
    const r = optimizeYaw(s.tHours, s.unitYaw)
    // 口径诚实化：optimizeYaw 的 baseMW/totalMW 都是「满发、不限功率」口径，
    // 且 baseMW 是「当前偏航」而非「零偏航基准」——因此增益表示的是
    // 由用户当前偏航 → 代理最优偏航的满发收益，不是「较指令前目标功率收益」，
    // 限功率时实际可用收益会被目标功率约束削平。
    const delta = r.totalMW - r.baseMW
    const capped = s.targetMW < FARM_RATED_MW
    const capNote = capped
      ? `（当前限至 ${s.targetMW.toFixed(1)} MW，实际收益受功率指令约束）`
      : '（不限功率/满发口径）'
    set({
      unitYaw: r.unitYaw,
      optimizeStamp: Date.now(),
      optimizeNote:
        delta > 0.005
          ? `寻优完成：满发口径全场 ${(r.totalMW * 1000).toFixed(0)} kW，由当前偏航 → 代理最优 +${(delta * 1000).toFixed(0)} kW / +${r.gainPct.toFixed(1)}%${capNote}【演示·Jensen 代理】`
          : `当前偏航已处于代理模型最优附近，满发口径增益 ${(Math.max(0, delta) * 1000).toFixed(0)} kW${capNote}【演示·Jensen 代理】`,
    })
  },
  resetYaw: () =>
    set({ unitYaw: [...ZERO_YAW], optimizeNote: '偏航指令已复位：全场对风 0°（基准工况）', optimizeStamp: Date.now() }),

  airflow: true,
  setAirflow: (v: boolean) => set({ airflow: v }),

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

  // —— 随机异常剧本 ——
  anomalyCycle: 0,
  anomalyPlan: generateAnomalyPlan(0, 6),
  anomalyActive: null,
  anomalyFired: false,
  anomalyModal: null,
  ensureAnomalyPlan: (cycle) =>
    set((s) => {
      if (s.anomalyPlan && s.anomalyPlan.cycle === cycle) return {}
      return { anomalyCycle: cycle, anomalyPlan: generateAnomalyPlan(cycle, s.tHours) }
    }),
  stepAnomaly: (prevH, nextH) =>
    set((s) => {
      // 只有“跨午夜的大回退”（prev≈23.x → next≈0.x）才算新一天；
      // 用户在时间轴上小幅/任意回拖不应被当成换日（否则会丢弃当天剧本）。
      const wrapped = nextH < prevH && prevH - nextH > 12
      if (wrapped) {
        const p = s.anomalyPlan
        // BUG-FIX：旧剧本触发时刻若仍在未来（跨午夜 wrap 到 0~6 点的情形），
        // 换日会把它整个丢弃 → 当天异常被跳过、首次异常可能拖到 24h+ 才出现
        // （违背 generateAnomalyPlan 的“从当前起 24h 内必现”契约）。
        // 未触发过且触发时刻仍在前方 → 沿用旧剧本；否则才生成新剧本。
        if (p && !s.anomalyActive && !s.anomalyFired && p.triggerH > nextH) return {}
        const cycle = s.anomalyCycle + 1
        return {
          anomalyCycle: cycle,
          anomalyPlan: generateAnomalyPlan(cycle, nextH),
          anomalyActive: null,
          anomalyFired: false,
          anomalyModal: s.anomalyModal,
        }
      }
      // 触发时间到点：激活一次（同日只触发一次，回拖不重新触发）
      const p = s.anomalyPlan
      if (!p || s.anomalyActive || s.anomalyFired) return {}
      const crossed = nextH > prevH && p.triggerH > prevH && p.triggerH <= nextH
      if (!crossed) return {}
      return { anomalyActive: p, anomalyFired: true }
    }),
  repairAnomaly: (auto) =>
    set((s) => {
      const p = s.anomalyActive
      if (!p) return {}
      return { anomalyActive: null, anomalyModal: { plan: p, auto } }
    }),
  closeAnomalyModal: () => set({ anomalyModal: null }),

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
    // 开场运镜期间（introDone=false）不推进仿真时间：
    // 否则开场 34~43s（≈大半天）里 HUD 会从默认高功率飞快滑到日内低谷，
    // 用户开场一结束就看到“功率下降”。开场结束后恢复播放（真实 50s=24h）。
    if (!s.introDone) return
    if (s.playing && !s.fatal) {
      const nextT = (s.tHours + dt * (24 / 50)) % 24
      useSim.setState({ tHours: nextT })
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
  const anomaly = useSim((s) => s.anomalyActive)
  const key = `${tHours}|${unitYaw.join(',')}|${targetMW}|${anomaly?.id ?? ''}`
  if (key !== hudKey || !hudFrame) {
    hudKey = key
    hudFrame = applyAnomalyToFrame(farmFrame(tHours, unitYaw, targetMW), anomaly)
  }
  return hudFrame
}

/** 3D 用：每帧即时读数（useFrame 内直读，绕开 React setState） */
export function farmFrameNow(): FarmFrame {
  const s = useSim.getState()
  return applyAnomalyToFrame(farmFrame(s.tHours, s.unitYaw, s.targetMW), s.anomalyActive)
}

/** 机组 id ↔ 下标 */
export const unitIndexById = new Map(FARM.map((f, i) => [f.id, i] as const))
