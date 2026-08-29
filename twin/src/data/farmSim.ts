// ================================================================
// AEOLUS 演示数据契约（Demo Data Contract）—— 全场唯一事实源
// ----------------------------------------------------------------
// 评审 A5/D2 的根因修复：此前 HUD 各组件各自硬编码数字（5 台 vs 9 台、
// 频率 48.20、雷达花瓣写死……互相穿帮）。本模块把 *全部* 运行读数收敛为
// 一个确定性纯函数：
//
//     farmFrame(tHours, unitYaw[9], targetPowerMW) → FarmFrame
//
// 同一 (t, yaw, target) 永远得到同一帧 → HUD / 3D / 告警 / 雷达 / 曲线
// 共享同一帧，天然一致；时间轴真正驱动数据；偏航滑杆真正驱动功率。
//
// 诚实边界（docs/02 §1 红线）：这是"浏览器端确定性演示数据"，物理内核
// 是公开 Jensen 代理模型（见 turbinePhysics.ts），不是 FLORIS/OpenFAST
// 求解结果，不是 SCADA 实测。HUD 所有读数统一挂【演示】角标。
// ================================================================

import { FARM } from '../scene/terrainUtil.ts'
import { mulberry32, smoothNoise } from './rng.ts'
import {
  powerCurveKw, rotorRpm, wakeDeficit, yawFactor, genTempC, gridFrequency,
} from './turbinePhysics.ts'

export const N_UNITS = FARM.length // 9
export const FARM_RATED_MW = 45 // 9 × 5 MW

// ---- 场景坐标系约定（全场唯一）----
// +x = 东，+z = 南（three.js Y-up 下取 -z 为北）
// 主导来风：从北吹向南（windFromDeg = 0° 表示"从正北来"）→ 粒子层北→南
// 上风向机组：机舱方位（yawDeg）= 机头朝向，对风 = yawDeg ≈ windFromDeg
export const BASE_WIND_FROM = 0

/** 雷达 8 方位顺序（与 HUD 花瓣索引一致） */
export const ROSE_ORDER = ['NW', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W'] as const

export type UnitStatus = 'run' | 'curtail' | 'alarm' | 'idle'

export interface UnitFrame {
  id: string
  x: number
  z: number
  row: number
  uFree: number
  uEff: number
  yawDeg: number
  yawErrDeg: number
  rpm: number
  powerKw: number
  tempC: number
  wakeLossPct: number
  status: UnitStatus
}

export interface AlarmEvent {
  key: number
  level: 'warn' | 'crit'
  rule: string
  zh: string
  en: string
  tid: string | null
  part: string
  tStartH: number
  minutesAgo: number
}

export interface FarmFrame {
  tHours: number
  windSpeed: number
  windFromDeg: number
  units: UnitFrame[]
  totalMW: number
  availMW: number
  derateFrac: number
  freqHz: number
  qMVar: number
  runningCount: number
  wakeLossPct: number
  yawPrecPct: number
  targetPct: number
  // 以下为重帧成员：随 30 模拟分钟分桶缓存
  energyTodayMWh: number
  energyYearEstMWh: number
  cfPct: number
  daySeries: number[]
  fcSeries: number[]
  rose: number[]
  alarms: AlarmEvent[]
}

// ---- 时变风况（确定性）----
export function windAt(tHours: number): { u: number; fromDeg: number } {
  // 昼夜风廓线 + 平滑扰动（seed 固定，跨帧一致；夜间风大是低空风切变常见现象）
  const diurnal = 7.9 + 2.1 * Math.cos(((tHours - 3) / 24) * Math.PI * 2)
  const slow = 1.8 * (smoothNoise(tHours * 0.55, 5) - 0.5)
  const fast = 0.64 * (smoothNoise(tHours * 2.7, 9) - 0.5)
  const u = Math.min(13.2, Math.max(5.4, diurnal + slow + fast))
  const fromDeg = BASE_WIND_FROM + 4 * (smoothNoise(tHours * 0.4, 3) - 0.5) - 1.5
  return { u, fromDeg }
}

/** 单机自由流风（含空间微差异） */
export function freeWindAt(tHours: number, x: number, z: number): number {
  const { u } = windAt(tHours)
  return Math.max(0, u + 0.44 * (smoothNoise(x * 0.004 + z * 0.003 + tHours * 0.9, 17) - 0.5))
}

interface CoreOpts {
  tHours: number
  unitYaw: number[]
  targetMW: number
}

interface FarmCore {
  units: UnitFrame[]
  totalMW: number
  availMW: number
  derateFrac: number
  wakeLossPct: number
  yawPrecPct: number
}

function evalCore(o: CoreOpts): FarmCore {
  const { tHours, unitYaw, targetMW } = o
  const { fromDeg } = windAt(tHours)
  const units: UnitFrame[] = FARM.map((f, i) => {
    const uFree = freeWindAt(tHours, f.x, f.z)
    return {
      id: f.id, x: f.x, z: f.z, row: f.row,
      uFree, uEff: uFree,
      yawDeg: unitYaw[i] ?? 0,
      yawErrDeg: (unitYaw[i] ?? 0) - fromDeg,
      rpm: 0, powerKw: 0, tempC: 0, wakeLossPct: 0, status: 'run',
    }
  })
  // 尾流：两两求 Jensen 亏损，多源 RSS 叠加（工程惯例，见 turbinePhysics）
  for (let i = 0; i < units.length; i++) {
    const di = units[i]
    let ssq = 0
    for (let j = 0; j < units.length; j++) {
      if (i === j) continue
      const dj = units[j]
      const def = wakeDeficit(dj.uFree, di.x - dj.x, di.z - dj.z, fromDeg, dj.yawErrDeg)
      ssq += def * def
    }
    const total = Math.min(0.8, Math.sqrt(ssq))
    di.uEff = di.uFree * (1 - total)
  }
  let wakeSumSq = 0
  for (let i = 0; i < units.length; i++) {
    const di = units[i]
    const before = powerCurveKw(di.uFree)
    di.rpm = rotorRpm(di.uEff)
    di.powerKw = powerCurveKw(di.uEff) * yawFactor(di.yawErrDeg)
    if (di.rpm <= 0) di.status = 'idle'
    di.wakeLossPct = before > 0 ? (100 * (1 - powerCurveKw(di.uEff) / before)) : 0
    void wakeSumSq
  }
  let withWakeMW = 0
  let noWakeMW = 0
  for (const di of units) {
    withWakeMW += powerCurveKw(di.uEff) * yawFactor(di.yawErrDeg)
    noWakeMW += powerCurveKw(di.uFree)
  }
  const availMW = withWakeMW / 1000
  const t = targetMW > 0 && targetMW < FARM_RATED_MW ? targetMW : FARM_RATED_MW
  const derateFrac = Math.min(1, t / Math.max(availMW, 0.001))
  if (derateFrac < 0.999) for (const di of units) di.powerKw *= derateFrac
  const totalMW = availMW * derateFrac
  const wakeLossPct = noWakeMW > 0 ? Math.max(0, 100 * (1 - withWakeMW / noWakeMW)) : 0
  let errSum = 0
  for (const di of units) errSum += Math.min(30, Math.abs(di.yawErrDeg))
  const yawPrecPct = 100 * (1 - errSum / units.length / 30)
  return { units, totalMW, availMW, derateFrac, wakeLossPct, yawPrecPct }
}

// ---- 两级记忆化：轻帧（0.25 模拟分钟）+ 重帧（30 模拟分钟分桶）----
const coreCache = new Map<string, FarmCore>()
const heavyCache = new Map<string, HeavyFrame>()
const CACHE_MAX = 64

interface HeavyFrame {
  energyTodayMWh: number
  energyYearEstMWh: number
  cfPct: number
  daySeries: number[]
  fcSeries: number[]
  rose: number[]
  alarms: AlarmEvent[]
}

const yawSig = (y: number[]) => y.map((v) => Math.round(v * 2) / 2).join(',')
function evictOldest<K>(m: Map<K, unknown>, max: number) {
  while (m.size > max) {
    const k = m.keys().next().value
    if (k === undefined) break
    m.delete(k)
  }
}

function coreAt(tq: number, unitYaw: number[], targetMW: number): FarmCore {
  const key = `${tq}|${yawSig(unitYaw)}|${Math.round(targetMW * 10) / 10}`
  const hit = coreCache.get(key)
  if (hit) return hit
  const c = evalCore({ tHours: tq, unitYaw, targetMW })
  coreCache.set(key, c)
  evictOldest(coreCache, CACHE_MAX)
  return c
}

// ---- 告警引擎：对过去 6h 网格做确定性阈值扫描（可回放、无随机）----
const SCAN_N = 40 // 40 格 × 9 模拟分钟 = 6h
const SCAN_MIN = 9

function buildHeavy(tq: number, unitYaw: number[], targetMW: number): HeavyFrame {
  // 全天 48 点（半小时网格）功率剖面 —— 当前偏航/目标设定下的"这一天"
  const daySeries: number[] = []
  for (let s = 0; s < 48; s++) daySeries.push(coreAt((s / 48) * 24, unitYaw, targetMW).totalMW)
  let daySum = 0
  for (const v of daySeries) daySum += v
  const energyTodayMWh = daySum * 0.5
  const avgMW = daySum / 48
  const energyYearEstMWh = avgMW * 8760
  const cfPct = (avgMW / FARM_RATED_MW) * 100

  // 预测 = Persistence + 2h 平移（演示口径，明说不是模型预报）
  const fcSeries = daySeries.map((_, s) => daySeries[(s + 4) % 48])

  // 告警扫描（确定性，同输入同事件；时间戳取自网格 → 可复现）
  const best = new Map<string, AlarmEvent>()
  const push = (e: AlarmEvent) => {
    const k2 = `${e.rule}|${e.tid ?? '-'}`
    const prev = best.get(k2)
    if (!prev || e.minutesAgo < prev.minutesAgo) best.set(k2, e)
  }
  const now = coreAt(tq, unitYaw, targetMW)
  for (let g = 0; g <= SCAN_N; g++) {
    const t = (tq - (g * SCAN_MIN) / 60 + 24) % 24
    const c = coreAt(t, unitYaw, targetMW)
    for (let i = 0; i < c.units.length; i++) {
      const di = c.units[i]
      const temp = genTempC(di.powerKw / 5000, t, i)
      const mk = (level: 'warn' | 'crit', rule: string, zh: string, en: string, part: string) =>
        push({
          key: (hashKey(rule) * 31 + Math.round(t * 60) + i * 7 + Math.round(Math.abs(di.yawErrDeg)) ) >>> 0,
          level, rule, zh, en, tid: di.id, part, tStartH: t, minutesAgo: g * SCAN_MIN,
        })
      if (temp > 96) mk('crit', 'TEMP', '发电机绕组超温', 'Generator Winding Overtemp', '发电机')
      else if (temp > 93) mk('warn', 'TEMP', '发电机温度偏高', 'Generator Temp High', '发电机')
      if (Math.abs(di.yawErrDeg) > 24) mk('warn', 'YAWERR', '偏航对风偏差超限', 'Yaw Misalignment', '偏航系统')
    }
    if (Math.abs(gridFrequency(c.totalMW, targetMW, t) - 50) > 0.12)
      push({ key: hashKey('FREQ') + Math.round(t * 60), level: 'crit', rule: 'FREQ', zh: '并网点频率越限', en: 'Grid Frequency Deviation', tid: null, part: '并网点', tStartH: t, minutesAgo: g * SCAN_MIN })
    if (c.derateFrac < 0.85)
      push({ key: hashKey('DERATE') + Math.round(t * 60), level: 'warn', rule: 'DERATE', zh: `全场限功率运行（指令 ${Math.round(targetMW)} MW）`, en: 'Farm Output Curtailed', tid: null, part: '功率控制', tStartH: t, minutesAgo: g * SCAN_MIN })
  }
  // 当前活跃事件优先展示
  let activeCritNow = false
  for (let i = 0; i < now.units.length; i++) {
    const di = now.units[i]
    void di
    if (genTempC(di.powerKw / 5000, tq, i) > 96) activeCritNow = true
  }
  const list = [...best.values()].map((e) => (activeCritNow && e.level === 'crit' ? { ...e, level: 'crit' as const } : e))
  list.sort((a, b) => a.minutesAgo - b.minutesAgo || a.key - b.key)
  const alarms = list.slice(0, 6)

  // 风频玫瑰：主峰在北（与"北→南"来风叙事一致），单位=出现频率 %
  const base = [5.2, 13.8, 6.1, 2.4, 1.8, 3.6, 4.4, 7.0]
  const rnd = mulberry32(1000 + Math.floor(tq))
  const rose = base.map((b) => Math.max(0.6, Math.round((b + (rnd() - 0.5) * 1.6) * 10) / 10))
  return { energyTodayMWh, energyYearEstMWh, cfPct, daySeries, fcSeries, rose, alarms }
}

function hashKey(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 131 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** 主入口：HUD 与 3D 共用同一帧（同键同帧，天然一致） */
export function farmFrame(tHours: number, unitYaw: number[], targetMW: number): FarmFrame {
  const tq = Math.round(tHours * 240) / 240 // 0.25 模拟分钟量化
  const core = coreAt(tq, unitYaw, targetMW)
  for (let i = 0; i < core.units.length; i++) {
    const di = core.units[i]
    di.tempC = genTempC(di.powerKw / 5000, tq, i)
    if (di.tempC > 96) di.status = 'alarm'
    else if (core.derateFrac < 0.999 && di.status === 'run') di.status = 'curtail'
  }
  const bucket = Math.floor(tHours * 2) / 2 // 30 模拟分钟
  const hkey = `${bucket}|${yawSig(unitYaw)}|${Math.round(targetMW * 10) / 10}`
  let heavy = heavyCache.get(hkey)
  if (!heavy) {
    heavy = buildHeavy(bucket, unitYaw, targetMW)
    heavyCache.set(hkey, heavy)
    evictOldest(heavyCache, 32)
  }
  const running = core.units.filter((di) => di.status !== 'idle').length
  return {
    tHours: tq,
    windSpeed: windAt(tq).u,
    windFromDeg: windAt(tq).fromDeg,
    units: core.units,
    totalMW: core.totalMW,
    availMW: core.availMW,
    derateFrac: core.derateFrac,
    freqHz: gridFrequency(core.totalMW, targetMW, tq),
    qMVar: 0.141 * core.totalMW, // pf≈0.99 → Q=P·tan(acos 0.99)
    runningCount: running,
    wakeLossPct: core.wakeLossPct,
    yawPrecPct: core.yawPrecPct,
    targetPct: targetMW > 0 ? Math.min(133, (core.totalMW / Math.min(targetMW, FARM_RATED_MW)) * 100) : 100,
    ...heavy,
  }
}

// ---- 偏航寻优（闭环叙事核心：目标功率/风况 → 各机偏航角指令）----
// 贪心逐排 + 单机细化（与阵列贪心 [30,20,0] 同族思想；数值是代理模型自己的）
export interface OptimizeResult {
  unitYaw: number[]
  totalMW: number
  baseMW: number
  gainPct: number
  rowOffsets: number[]
}

export function optimizeYaw(tHours: number, seedYaw: number[]): OptimizeResult {
  const tq = Math.round(tHours * 240) / 240
  const yaw = [...seedYaw]
  const rowOf = (i: number) => FARM[i].row
  const measure = (y: number[]) => evalCore({ tHours: tq, unitYaw: y, targetMW: FARM_RATED_MW }).totalMW
  const base = measure(yaw)
  const CAND = [-30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30]
  for (let r = 0; r < 3; r++) {
    let best = -Infinity
    let bestOff = 0
    for (const off of CAND) {
      for (let i = 0; i < N_UNITS; i++) if (rowOf(i) === r) yaw[i] = off
      const v = measure(yaw)
      if (v > best + 1e-9) { best = v; bestOff = off }
    }
    for (let i = 0; i < N_UNITS; i++) if (rowOf(i) === r) yaw[i] = bestOff
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N_UNITS; i++) {
      const cur = yaw[i]
      let best = measure(yaw)
      let bestV = cur
      for (const d of [-6, -4.5, -3, -1.5, 1.5, 3, 4.5, 6]) {
        yaw[i] = Math.max(-35, Math.min(35, cur + d))
        const v = measure(yaw)
        if (v > best + 1e-9) { best = v; bestV = yaw[i] }
      }
      yaw[i] = bestV
    }
  }
  const fin = measure(yaw)
  return {
    unitYaw: yaw.map((v) => Math.round(v * 2) / 2),
    totalMW: fin,
    baseMW: base,
    gainPct: base > 0.01 ? ((fin - base) / base) * 100 : 0,
    rowOffsets: [0, 1, 2].map((r) => yaw[FARM.findIndex((f) => f.row === r)]),
  }
}

/** 机组铭牌（单机信息卡用） */
export const UNIT_NAMEPLATE = {
  model: 'AEOLUS-5MW（NREL 5MW 参考机组几何）',
  ratedKw: 5000,
  rotorD: 126,
  hubH: 90,
  cutIn: 3.0,
  rated: 11.4,
  cutOut: 25.0,
}
