import { FARM, SERVOS } from '../scene/terrainUtil'

// ================================================================
// 演示仿真内核（确定性 · 可复现 · 浏览器端代理模型）
//
// 数据口径诚实声明（与 docs/03 诚信红线一致）：
//   这不是 FLORIS、不是 SCADA、不是 PINN。它是浏览器端的确定性代理：
//   · 功率曲线口径：NREL 5MW（切入 3 / 额定 11.4 / 切出 25 m/s，额定 5 MW）；
//   · 尾流：沿风向列向的 Jensen 风格速损叠加，偏航上游机组可偏转尾流
//     （下游速损减小），偏航自身功率代价 cos²(γ) —— 教科书级代理，
//     只用于演示“风向→尾流→偏航→功率”的因果链，不声称预报精度；
//   · 日内风速廓线：确定性多正弦合成（无随机数），同一时间轴重放结果一致；
//   · 电网频率/无功：围绕 50 Hz 的微小确定性波动（符合 GB 正常区间），
//     无功按 ~0.30 无功/有功比联动。
// 任何真实数据来源宣称都需要未来接入真值后再恢复（见 docs/08）。
// ================================================================

// ---------- 确定性基础 ----------

/** mulberry32 确定性随机源：全场景禁止 Math.random（可复现是演示诚信的一部分） */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- 物理口径常量（NREL 5MW） ----------
export const RATED_MW = 5
export const CUT_IN = 3.0
export const RATED_V = 11.4
export const CUT_OUT = 25.0
export const FARM_RATED_MW = RATED_MW * 9 // 45 MW 装机

/** 尾流速损基础系数（每一列内逐排传递） */
const WAKE_BASE = 0.075
/** 偏航对下游尾流的偏转收益上限（|γ|=28° 时收益 62%） */
const YAW_STEER_GAIN = 0.62
const YAW_STEER_REF = 28

/** 逐机确定性风资源微差（0.94 ~ 1.06，模块载入即固定） */
const WIND_JITTER: number[] = (() => {
  const r = rng(20260824)
  return FARM.map(() => 0.94 + r() * 0.12)
})()
/** 逐机转速微差（0.96 ~ 1.04） */
const RPM_JITTER: number[] = (() => {
  const r = rng(20260825)
  return FARM.map(() => 0.96 + r() * 0.08)
})()

// ---------- 风况与功率 ----------

/** 日内基准风速廓线（m/s）：夜间偏高、午后回落晚峰再起 —— 确定性合成 */
export function baseWind(tH: number): number {
  const w =
    8.0 +
    2.2 * Math.sin(((tH - 4) / 24) * Math.PI * 2) +
    1.4 * Math.sin(((tH - 11) / 24) * Math.PI * 4 + 1.2)
  return Math.min(12.8, Math.max(4.5, w))
}

/** NREL 5MW 稳态功率曲线（MW），额定段平滑封顶 */
export function powerCurve(v: number): number {
  if (v < CUT_IN || v >= CUT_OUT) return 0
  if (v >= RATED_V) return RATED_MW
  return RATED_MW * Math.pow((v - CUT_IN) / (RATED_V - CUT_IN), 2.2)
}

/** 转子角速度（rad/s）：6.9 → 12.1 rpm 随风速映射（NREL 5MW 转速域） */
function rotorRadS(v: number, idx: number): number {
  if (v < CUT_IN) return 0.45 * RPM_JITTER[idx]
  const t = Math.min(1, Math.max(0, (v - CUT_IN) / (RATED_V - CUT_IN)))
  const rpm = 6.9 + (12.1 - 6.9) * t
  return ((rpm * 2 * Math.PI) / 60) * RPM_JITTER[idx]
}

// ---------- 九机链式求解（尾流沿列传递；主导风向 南→北，近排=r2 为上游） ----------

export type TurbineStatus = 'run' | 'idle' | 'storm'

export interface TurbineSnap {
  id: string
  idx: number
  wind: number
  powerMW: number
  rpmRadS: number
  yawDeg: number
  status: TurbineStatus
}

interface ChainResult {
  units: TurbineSnap[]
  totalMW: number
  noWakeMW: number
}

/** 传入 9 台偏航角（deg），返回全场快照（仅供内部/求解器用） */
function evalChain(tH: number, yaws: number[]): ChainResult {
  const vBase = baseWind(tH)
  const units: TurbineSnap[] = new Array(9)
  let totalMW = 0
  let noWakeMW = 0
  for (let c = 0; c < 3; c++) {
    // 上游 → 下游：近排(row2) → 中排(row1) → 远排(row0)
    let vFactor = 1
    for (const r of [2, 1, 0]) {
      const i = r * 3 + c
      const yaw = Math.max(-35, Math.min(35, yaws[i] || 0))
      const vFree = vBase * WIND_JITTER[i]
      const vEff = vFree * vFactor
      const p0 = powerCurve(vEff)
      const yawRad = (yaw * Math.PI) / 180
      const p = p0 * Math.cos(yawRad) * Math.cos(yawRad)
      noWakeMW += powerCurve(vFree)
      totalMW += p
      const status: TurbineStatus = vEff >= CUT_OUT - 1 ? 'storm' : vEff < CUT_IN + 0.4 ? 'idle' : 'run'
      units[i] = { id: FARM[i].id, idx: i, wind: vEff, powerMW: p, rpmRadS: rotorRadS(vEff, i), yawDeg: yaw, status }
      // 留给下游的速损：功强越大尾流越强；上游偏航把尾流甩偏，下游收益
      const d =
        WAKE_BASE *
        (0.35 + 0.65 * Math.min(1, p0 / RATED_MW)) *
        (1 - YAW_STEER_GAIN * Math.min(1, Math.abs(yaw) / YAW_STEER_REF))
      vFactor *= 1 - d
    }
  }
  return { units, totalMW, noWakeMW }
}

/** 尾流导流示范构型：上游排 +20°，中排 +10°，下游排 0°（按行） */
function showcaseYaws(): number[] {
  return FARM.map((u) => (u.row === 2 ? 20 : u.row === 1 ? 10 : 0))
}

// ---------- 偏航自优（演示代理求解：目标功率 → 各机偏航角） ----------

/**
 * 输入需求功率 targetMW，输出 9 机偏航角：
 *   1) 目标高于零偏航自由出力 → 在“尾流导流构型”方向上二分插值（增发电量演示）；
 *   2) 目标低于自由出力 → 全场统一偏航卸载（acos 解析初值 + 二分精修，
 *      对应申请书“全场限电精准分配”口径）。
 * 全程确定性无迭代震荡（单调二分，20 次收敛）。
 */
export function solveAutoYaws(targetMW: number, tH: number): number[] {
  const zero = new Array(9).fill(0)
  const showcase = showcaseYaws()
  const free = evalChain(tH, zero).totalMW
  const show = evalChain(tH, showcase).totalMW

  if (show > free + 1e-6 && targetMW > free && targetMW < show) {
    // 介于 自由出力 与 导流最大出力 之间：沿 0→showcase 方向二分 λ
    let lo = 0, hi = 1
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2
      const tot = evalChain(tH, showcase.map((y) => y * mid)).totalMW
      if (tot < targetMW) lo = mid; else hi = mid
      if (hi - lo < 1e-4) break
    }
    const lam = (lo + hi) / 2
    return showcase.map((y) => y * lam)
  }
  if (targetMW >= Math.max(free, show)) return showcase
  if (targetMW <= 0) return new Array(9).fill(35)

  // 目标 < 自由出力：全场统一卸载角 γ，total(γ) 单调递减 → 二分
  let lo = 0, hi = 35
  for (let k = 0; k < 20; k++) {
    const mid = (lo + hi) / 2
    const tot = evalChain(tH, new Array(9).fill(mid)).totalMW
    if (tot > targetMW) lo = mid; else hi = mid
    if (hi - lo < 1e-4) break
  }
  const g = (lo + hi) / 2
  return new Array(9).fill(Math.round(g * 10) / 10)
}

// ---------- 全场快照（HUD / 场景共用） ----------

export interface FarmSnap {
  tH: number
  windBase: number
  totalMW: number
  freeMW: number
  targetMW: number
  auto: boolean
  trackErrMW: number
  freqHz: number
  qMVar: number
  cpMean: number
  wakeLossPct: number
  capFactorPct: number
  online: number
  units: TurbineSnap[]
  yaws: number[]
}

export function simulate(servos: number[], auto: boolean, targetMW: number, tH: number): FarmSnap {
  const manual = FARM.map((_, i) => {
    const k = SERVOS.indexOf(i)
    return k >= 0 ? servos[k] : 0
  })
  const yaws = auto ? solveAutoYaws(targetMW, tH) : manual
  const { units, totalMW: rawTotal, noWakeMW } = evalChain(tH, yaws)
  let totalMW = rawTotal
  // 手动模式下目标功率滑杆 = AGC 限发指令：超过即等比缩减各机出力
  // （auto 模式则由偏航解算器直接跟踪，见 solveAutoYaws）
  if (!auto && targetMW < totalMW) {
    const k = totalMW > 1e-6 ? targetMW / totalMW : 1
    for (const u of units) u.powerMW *= k
    totalMW = targetMW
  }
  const free = evalChain(tH, new Array(9).fill(0)).totalMW

  const online = units.filter((u) => u.status === 'run').length
  // 平均风能利用系数 Cp（运行机位）
  let cpSum = 0, cpN = 0
  for (const u of units) {
    if (u.status === 'run' && u.powerMW > 0.05) {
      const air = 0.5 * 1.225 * Math.PI * 63 * 63 * u.wind ** 3
      cpSum += Math.min(0.5, (u.powerMW * 1e6) / air)
      cpN++
    }
  }
  return {
    tH,
    windBase: baseWind(tH),
    totalMW,
    freeMW: free,
    targetMW,
    auto,
    trackErrMW: auto ? totalMW - targetMW : 0,
    freqHz: 50 + 0.024 * Math.sin(tH * 8.1 + 1) + 0.012 * Math.sin(tH * 21.7),
    qMVar: totalMW * 0.3 + 0.6 * Math.sin(tH * 5.3),
    cpMean: cpN ? cpSum / cpN : 0,
    wakeLossPct: noWakeMW > 0.1 ? (1 - totalMW / noWakeMW) * 100 : 0,
    capFactorPct: (totalMW / FARM_RATED_MW) * 100,
    online,
    units,
    yaws,
  }
}

// ---------- 日内曲线（Actual=当前偏航策略 / Baseline=零偏航基准） ----------

export function dailyCurve(servos: number[], auto: boolean, targetMW: number): { actual: number[]; baseline: number[] } {
  const actual: number[] = []
  const baseline: number[] = []
  const zero = new Array(9).fill(0)
  for (let k = 0; k < 48; k++) {
    const tH = (k / 48) * 24
    const yaws = auto ? solveAutoYaws(targetMW, tH) : FARM.map((_, i) => {
      const s = SERVOS.indexOf(i)
      return s >= 0 ? servos[s] : 0
    })
    const tot = evalChain(tH, yaws).totalMW
    // 手动模式同样受 AGC 限发指令约束（与 simulate 一致）
    actual.push(auto ? tot : Math.min(tot, targetMW))
    baseline.push(evalChain(tH, zero).totalMW)
  }
  return { actual, baseline }
}

/** 24h 全场发电量积分（MWh，由 actual 曲线梯形积分） */
export function integrateDay(curve: number[], uptoTH = 24): number {
  let e = 0
  for (let k = 0; k < 48; k++) {
    const t0 = (k / 48) * 24
    const t1 = ((k + 1) / 48) * 24
    if (t0 >= uptoTH) break
    const c0 = curve[k]
    const c1 = curve[(k + 1) % 48]
    const span = Math.min(t1, uptoTH) - t0
    e += ((c0 + c1) / 2) * Math.max(0, span)
  }
  return e
}

// ---------- 告警规则引擎（阈值/关联机组/确定性时标） ----------

export interface AlarmItem {
  id: number
  level: 'warn' | 'info'
  zh: string
  en: string
  tid: string | null
  minutes: number
}

const hashMin = (i: number, tH: number, salt: number) => {
  const r = rng(Math.floor(tH * 2) * 1000 + i * 131 + salt)
  return 2 + Math.floor(r() * 46)
}

export function makeAlarms(snap: FarmSnap, servos: number[]): AlarmItem[] {
  const out: AlarmItem[] = []
  let id = 1
  for (const u of snap.units) {
    const yaw = Math.abs(u.yawDeg)
    if (!snap.auto && yaw > 24) {
      out.push({
        id: id++, level: 'warn',
        zh: `偏航偏差过大 ${u.id}`,
        en: `Yaw Misalignment >24° / ${u.id}`,
        tid: u.id, minutes: hashMin(u.idx, snap.tH, 11),
      })
    }
    if (u.status === 'storm') {
      out.push({
        id: id++, level: 'warn',
        zh: `大风切出预警 ${u.id}`,
        en: `High Wind Cut-out / ${u.id}`,
        tid: u.id, minutes: hashMin(u.idx, snap.tH, 23),
      })
    }
    if (u.status === 'idle') {
      out.push({
        id: id++, level: 'info',
        zh: `低风速待机 ${u.id}`,
        en: `Low Wind Standby / ${u.id}`,
        tid: u.id, minutes: hashMin(u.idx, snap.tH, 37),
      })
    }
  }
  if (snap.auto && snap.trackErrMW < -1.5 && snap.targetMW > 1) {
    out.push({
      id: id++, level: 'info',
      zh: '功率跟踪受限', en: 'Target Above Available Power',
      tid: null, minutes: hashMin(0, snap.tH, 51),
    })
  }
  if (!snap.auto && snap.wakeLossPct > 9 && servos.every((v) => Math.abs(v) < 5)) {
    out.push({
      id: id++, level: 'info',
      zh: '尾流损失偏高 建议自优', en: 'Wake Loss High / Consider Auto',
      tid: null, minutes: hashMin(0, snap.tH, 67),
    })
  }
  // 常态运行通知池：健康工况下用确定性运维信息补齐流水（真实告警永远优先）
  const notices: [string, string][] = [
    ['巡检计划已下发 T03', 'Inspection Scheduled / T03'],
    ['数据链心跳正常', 'Telemetry Heartbeat OK'],
    ['代理模型在线 推理 <1ms', 'Surrogate Online <1ms'],
    ['功率指令已确认', 'Setpoint Acknowledged'],
    ['偏航系统自检通过', 'Yaw System Self-test OK'],
  ]
  if (out.length < 5) {
    const r = rng(Math.floor(snap.tH * 2) * 777 + 5)
    const pool = [...notices]
    while (out.length < 5 && pool.length) {
      const k = Math.floor(r() * pool.length)
      const [zh, en] = pool.splice(k, 1)[0]
      out.push({ id: 100 + out.length, level: 'info', zh, en, tid: null, minutes: hashMin(out.length, snap.tH, 91) })
    }
  }
  // 排序：告警在前，容量 5 条
  out.sort((a, b) => (a.level === b.level ? a.id - b.id : a.level === 'warn' ? -1 : 1))
  return out.slice(0, 5).map((a, i) => ({ ...a, id: i + 1 }))
}
