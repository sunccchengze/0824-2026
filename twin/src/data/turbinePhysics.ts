// ================================================================
// AEOLUS 物理层 —— 2026-08-28 起以【真实数据】定标（不再用自编曲线）
// ----------------------------------------------------------------
// 数据来源（全部为公开学术数据，路径可在 docs/08 §A7 溯源）：
//  · 功率 / 推力系数表：FLORIS 官方 turbine_library/nrel_5MW.yaml
//    （即本项目老网页 wind-farm-viz 所用 FLORIS 的机组定义本体；
//      其上游出处为 NREL/turbine-models 修正表，见 yaml 头注）。
//  · 倾斜损失：同一 yaml 内 ref_tilt=5°、cosine_loss_exponent_yaw/tilt=1.88
//    ——老网页 data.js 中 p1(6)=731 kW 即"表值×cos^1.88(5°)"的结果
//    （737.6×0.99264=732.2，±0.2% 为 FLORIS 版本差），本模块精确复刻该口径。
//  · 转速：同 yaml TSR=8（额定 12.1 rpm；6.9 rpm 低风速平台为 Jonkman 定义值）。
//  · 尾流：Jensen+偏折三参数对 FLORIS 阵列三指标标定（见 WAKE_* 常量）。
// 演示口径不变：浏览器端为【代理】（代理物理+确定性），FLORIS 全解算在离线端。
// ================================================================

import { smoothNoise } from './rng.ts'

// ---- NREL 5MW 参考机组常量（Jonkman 2009, NREL/TP-500-38060）----
export const P_RATED_KW = 5000
export const U_CUT_IN = 3.0
export const U_RATED = 11.4
export const U_CUT_OUT = 25.0
export const ROTOR_D = 125.88 // yaml rotor_diameter（含预锥）
export const HUB_H = 90.0
export const OMEGA_RATED_RPM = 12.1
export const OMEGA_MIN_RPM = 6.9
export const TSR_NOMINAL = 8.0

/** 倾斜余弦损失（FLORIS ref_tilt=5° → 表值×0.99264，与老网页 data.js 一致） */
export const YAW_P = 1.88
const TILT_RAD = (5 * Math.PI) / 180
export const TILT_F = Math.cos(TILT_RAD) ** YAW_P

/**
 * FLORIS nrel_5MW.yaml 功率表（kW，已按上表顺序取整到 0.01）与推力系数表。
 * 线性插值；表外：v<3 → 0，v>25.05 → 0。
 * 完整 54 点中仅保留有信息量区段（0.1 m/s 分辨率覆盖 7–12 m/s 额定爬坡段）。
 */
const V_T = [2.9, 3.0, 4.0, 5.0, 6.0, 7.0, 7.2, 7.4, 7.6, 7.8, 8.0, 9.0, 10.0, 10.2, 10.4, 10.6, 10.8, 11.0, 11.2, 11.4, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
const P_T = [0.0, 40.52, 177.67, 403.9, 737.59, 1187.18, 1292.52, 1403.26, 1519.64, 1642.11, 1771.17, 2518.55, 3448.38, 3657.95, 3765.12, 4096.58, 4326.15, 4562.5, 4806.16, 5000.0, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 0.0]
const CT_T = [0.0, 1.13203, 0.99947, 0.9177, 0.86085, 0.81537, 0.80794, 0.801, 0.79453, 0.78856, 0.78713, 0.78584, 0.78381, 0.78333, 0.77729, 0.76969, 0.76235, 0.75524, 0.74843, 0.71781, 0.39931, 0.31052, 0.24863, 0.20354, 0.16962, 0.14348, 0.12294, 0.10652, 0.09303, 0.08165, 0.0722, 0.06439, 0.0]

function interp(tab: number[], v: number): number {
  if (v <= V_T[0]) return 0
  if (v >= V_T[V_T.length - 1]) return tab[tab.length - 1]
  let i = 0
  while (i < V_T.length - 2 && V_T[i + 1] < v) i++
  const t = (v - V_T[i]) / (V_T[i + 1] - V_T[i])
  return tab[i] + (tab[i + 1] - tab[i]) * t
}

/** 单机并网功率 (kW)：FLORIS 表 ×5° 倾斜损失。3 m/s 切入、25.05 切出。 */
export function powerCurveKw(u: number): number {
  if (u < U_CUT_IN || u > U_CUT_OUT) return 0
  return interp(P_T, u) * TILT_F
}

/** 推力系数 Ct：FLORIS 表原值（额定段 0.79 → 高风速迅速卸载，尾流真实衰减的来源） */
export function thrustCt(u: number): number {
  if (u < U_CUT_IN || u > U_CUT_OUT) return 0
  return interp(CT_T, u)
}

/**
 * 风轮转速 (rpm)：B8+ 功率实时耦合版（用户任务#2）。
 * · 额定以下：λ=TSR=8 恒速尖速比律 ω=60·TSR·u/(π·D)，钳位 [6.9,12.1]（Jonkman 控制律）；
 * · 额定以上或限功率：rpm 随实发/额定功率比缓慢下调（12.1×ratio^0.35）——
 *   演示"功率指令→桨距→转速"因果链，让旋翼快慢实时反映输出功率（口径：示意近似）。
 */
export function rotorRpm(u: number, powerKw = NaN): number {
  if (u < U_CUT_IN || u > U_CUT_OUT) return 0
  const tsrRpm = (60 * TSR_NOMINAL * u) / (Math.PI * ROTOR_D)
  let rpm = Math.min(OMEGA_RATED_RPM, Math.max(OMEGA_MIN_RPM, tsrRpm))
  if (Number.isFinite(powerKw) && powerKw < P_RATED_KW * 0.995 && (u >= U_RATED - 1.4 || powerKw < powerCurveKw(u) * 0.985)) {
    const ratio = Math.max(0.12, Math.min(1, Math.max(0, powerKw) / P_RATED_KW))
    rpm *= ratio ** 0.35
  }
  return rpm
}

/** 偏航对风损失因子：cos^1.88 —— FLORIS cosine_loss_exponent_yaw 官方默认值 */
export function yawFactor(deg: number): number {
  const r = (deg * Math.PI) / 180
  return Math.cos(r) ** YAW_P
}

/**
 * Jensen(Park) 尾流：δ(x) = (1 − sqrt(1−Ct))·(D/(D+2kx))²，
 * 偏折走 wakeDeflection（P0 饱和模型，纯 FLORIS 拟合、不被标定缩放）。
 *
 * 第 18 轮（P0）重标定，两处口径修正：
 *  (1) 靶值改用与偏折曲线【同源】的 FLORIS 4.6.6 GCH 实算
 *      （旧靶 unified+30°=9299.05 来自老版本，实测 4.6.6 为 9060.03，差 −2.57%；
 *       拿旧靶配新几何 = 用 A 版几何凑 B 版功率）；
 *  (2) WAKE_DEFLECT 由"偏折强度"改为【尾流展宽系数】σ=D·WAKE_DEFLECT/2+kx。
 *      原式把整个转子半径当高斯 σ，尾流过宽，真实 63.9m 的偏折永远 escape 不出去。
 *
 * 标定结果（k=0.021, σ系数=0.48, steerMax=0.85）：
 *   none        8112.8 kW vs 8108.08（+0.06%）
 *   unified+30° 8206.7 kW vs 9060.03（−9.42%）
 *   独立寻优增益 24.06%  vs 24.04%（+0.02pt）
 * 复合误差 3.81%。
 *
 * 诚实说明 —— 为什么不是更小的数：
 * P0 前的 2.07% 是对【旧靶】的拟合；本轮曾试出 2.60% 的解，但那是靠把偏折几何
 * 整体放大 1.9 倍换来的（5.02D 处 121.5m vs 真实 63.9m），属于用错误几何凑功率，
 * 已弃用。锁定真实几何后对 σ 系数做一维扫描，极小值稳定在 0.48 附近
 * （0.45→3.88%、0.48→3.88%、0.52→3.93%、0.58→4.09%），
 * 且 unified 项始终卡在 −9.4% 无法再降 —— 这是 Jensen 顶帽廓线配真实饱和偏折的
 * 【模型能力上限】，非标定不足。取舍：保 none（无偏航基准，最常显示的工况）
 * 与 gain（"下发偏航寻优"按钮的对外承诺值），让 unified 项承担误差。
 * 彻底解决需 P1 的高斯/GCH 廓线，见 round17 可行性文档。
 */export let WAKE_K = 0.021
/** 尾流展宽系数：高斯 σ = ROTOR_D·WAKE_DEFLECT/2 + k·x（标定量；名称沿用以免波及调用方） */
export let WAKE_DEFLECT = 0.48

// ---- P0（第 18 轮）：尾流横偏饱和模型 ----
// 旧式 δ = 2a·x·tan(yaw)·0.70 随 x 线性无限发散；真实尾流远场会饱和。
// 对 FLORIS 4.6.6 GCH 实测场（6 偏航 × 11 站位 = 66 点，NREL 5MW，8 m/s，
// TI=6%，逐高度扣除入流剪切后取亏损质心）最小二乘拟合：
//     δ(yaw, x) = C·sin(yaw)·L·(1 − exp(−x/L)),  L = L0/(1 + Lk·sin²yaw)
// 拟合集最大误差 5.09 m / 平均 1.76 m；
// 留出集（yaw 7.5/12.5/17.5/22.5/27.5° × 1.75/3.5/4.5/9/11D，未参与拟合）
// 最大误差 4.35 m —— 旧线性式在同一留出集上最大误差 128.3 m。
// 复现：docs/research/scripts/floris_probe.py + p0fit3.py（见 round18 文档）。
export const DEFL_C = 0.3325
export const DEFL_L0 = 2706.27
export const DEFL_LK = 14.7039

/**
 * 尾流中心横向偏移（m）。正 yaw → 尾流偏向 −px 方向（与旧式符号一致）。
 * 全项目唯一的偏折真值：wakeDeficit / AirflowField / HUD 雷达走廊都必须调它。
 */
export function wakeDeflection(yawDeg: number, x: number): number {
  const s = Math.sin((yawDeg * Math.PI) / 180)
  const L = DEFL_L0 / (1 + DEFL_LK * s * s)
  return DEFL_C * s * L * (1 - Math.exp(-Math.max(0, x) / L))
}
/** 偏航转向收益上限（0-1）：上游偏航所能消除的尾流亏损占比封顶
 * （Gauss 长尾不随偏折完全消失；只作用于有偏航的上游，正常尾流形状不受影响） */
export let WAKE_STEER_MAX = 0.85
/** 校准/QA 专用（scripts/calibrateWake.mts）：运行期勿调 */
export function __setWakeTuning(k: number, deflect: number, steerMax: number): void {
  WAKE_K = k
  WAKE_DEFLECT = deflect
  WAKE_STEER_MAX = steerMax
  WAKE_REV++
}
/** 标定参数版本号：任何 __setWakeTuning 都使 farmSim 的结果缓存失效 */
export let WAKE_REV = 0

export function wakeDeficit(
  uUp: number,
  dx: number, // i − j 东向分量
  dy: number, // i − j 南向分量（+z）
  windFromDeg: number, // 来风方位（0=北来）
  yawUpDeg: number, // 上游机偏航角 → 尾流横向偏折
): number {
  const th = (windFromDeg * Math.PI) / 180
  const fx = Math.sin(th) // 风的去向东分量
  const fy = Math.cos(th) // 风的去向南分量
  const x = dx * fx + dy * fy
  if (x <= ROTOR_D * 0.35) return 0
  const ct = Math.min(0.9, thrustCt(uUp))
  const a = (1 - Math.sqrt(Math.max(0, 1 - ct))) / 2
  // WAKE_DEFLECT 改作【尾流展宽系数】：原式把整个转子半径当高斯 σ，尾流过宽，
  // 真实 63.9m 的偏折永远escape不出去（见 round18 文档 §3）。σ 收窄才是正确旋钮。
  const sigmaHalf = ROTOR_D * WAKE_DEFLECT * 0.5 + WAKE_K * x
  const core = (ROTOR_D / (ROTOR_D + 2 * WAKE_K * x)) ** 2
  const deficit = 2 * a * core
  const px = dx * fy - dy * fx
  const deflection = wakeDeflection(yawUpDeg, x) // P0：饱和模型取代线性外推
  const r = Math.abs(px - deflection)
  let overlap = Math.exp(-0.5 * (r / sigmaHalf) ** 2)
  if (yawUpDeg !== 0) overlap = Math.max(overlap, 1 - WAKE_STEER_MAX)
  return Math.min(0.85, deficit * overlap)
}

/** 等效风速（叠加尾流亏损后的来流） */
export function effWind(u: number, deficit: number): number {
  return u * (1 - deficit)
}

/** 发电机温度代理 (°C)：负载率+环境温度+确定性扰动（演示口径，非热模型） */
export function genTempC(loadFrac: number, tHours: number, unitIdx: number): number {
  const ambient = 16 + 9 * Math.sin(((tHours - 9) / 24) * Math.PI * 2)
  const loadHeat = 52 * loadFrac
  const turb = 1.6 * smoothNoise(tHours * 0.9 + unitIdx * 3.7, 11)
  return ambient + loadHeat + turb
}

/** 电网频率代理 (Hz)：源荷失衡一阶摆动 + 慢漂移 */
export function gridFrequency(totalMW: number, targetMW: number, tHours: number): number {
  const imb = (totalMW - targetMW) / 45
  const slow = 0.045 * Math.sin((tHours / 6.3) * Math.PI * 2 + 1.1)
  const f = 50 + imb * 0.06 + slow
  return Math.min(50.15, Math.max(49.85, f))
}
