// ================================================================
// AEOLUS 演示物理层（DEMO surrogate）—— 诚实口径见文件尾注释
// ----------------------------------------------------------------
// · 功率曲线 / 推力系数：NREL 5MW 参考机组的公开量级近似（三次幂爬升段 +
//   额定平台），用于演示，非 FLORIS/OpenFAST 求解输出。
// · 尾流：经典 Jensen（PV）模型 + 偏航尾流偏折线性近似——公式在 Burton
//   《Wind Energy Handbook》等公开教材可查；这里作为"看得见的代理"。
// · 偏航功率损失：P·cos^1.88(θ)（文献常用经验指数）。
// 一切读数在 HUD 标【演示·Jensen 代理】，不得宣称实测/FLORIS（docs/02 红线）。
// ================================================================

import { smoothNoise } from './rng.ts'

// ---- NREL 5MW 参考机组常量（Jonkman 2009, NREL/TP-500-38060）----
export const P_RATED_KW = 5000
export const U_CUT_IN = 3.0
export const U_RATED = 11.4
export const U_CUT_OUT = 25.0
export const ROTOR_D = 126.0 // m
export const HUB_H = 90.0 // m
export const OMEGA_MIN_RPM = 6.9 // 区域常数转速（铭牌量级）
export const OMEGA_RATED_RPM = 12.1

const P_REF = U_RATED ** 3 - U_CUT_IN ** 3

/** 单机功率 (kW)：三次幂近似爬升段 + 额定平台。示意口径。 */
export function powerCurveKw(u: number): number {
  if (u < U_CUT_IN || u > U_CUT_OUT) return 0
  if (u >= U_RATED) return P_RATED_KW
  return P_RATED_KW * Math.max(0, (u ** 3 - U_CUT_IN ** 3) / P_REF)
}

/** 推力系数 Ct 近似：额定以下 ≈0.77，额定以上随 1/u 衰减（BEM 量级示意） */
export function thrustCt(u: number): number {
  if (u < U_CUT_IN || u > U_CUT_OUT) return 0
  if (u <= U_RATED) return 0.77
  return Math.max(0.12, 0.77 * (U_RATED / u) ** 1.4)
}

/** 风轮转速 (rpm)：额定前随风速线性爬升（B8 修复：转速必须是风的函数） */
export function rotorRpm(u: number): number {
  if (u < U_CUT_IN || u > U_CUT_OUT) return 0
  const t = Math.min(1, Math.max(0, (u - U_CUT_IN) / (U_RATED - U_CUT_IN)))
  return OMEGA_MIN_RPM + t * (OMEGA_RATED_RPM - OMEGA_MIN_RPM)
}

/** 偏航对风损失指数（经验值） */
export const YAW_P = 1.88
export function yawFactor(deg: number): number {
  const r = (deg * Math.PI) / 180
  return Math.cos(r) ** YAW_P
}

/**
 * Jensen 尾流：来流风机 j 对下游风机 i 的速度亏损。
 * δ(x) = (1 - sqrt(1-Ct)) · (D/(D+2kx))²，x 为沿风向投影距离（>0 才生效）。
 * 偏航尾流偏折（线性近似）：wake 中心横向漂移 ≈ 2·a·x·tan(γ)，
 * a = (1 - sqrt(1-Ct))/2 —— 这就是"尾流在让路"的可见来源。
 */
export const JENSEN_K = 0.06 // 陆地中性大气典型衰减系数（Burton 表量级）

export function wakeDeficit(
  uUp: number,
  dx: number, // i - j 的 x 分量（场坐标：东为 +x）
  dy: number, // i - j 的 y 分量（场坐标：南为 +z，这里用 y 代指）
  windFromDeg: number, // 来风方位：0 = 从北吹来（向北→南为正 y 方向）
  yawUpDeg: number, // 上游机的偏航角（对风偏差），驱动尾流横向偏折
): number {
  const th = (windFromDeg * Math.PI) / 180
  // 单位向量：风的去向（从北吹来 → 指向南）
  const fx = Math.sin(th) // 东分量
  const fy = Math.cos(th) // "南"分量（本场景 z 即此轴）
  const x = dx * fx + dy * fy // 沿风向：>0 表示 i 在 j 的下游
  if (x <= ROTOR_D * 0.35) return 0 // 太近/在上风向：不建模近尾流
  const ct = thrustCt(uUp)
  const a = (1 - Math.sqrt(Math.max(0, 1 - ct))) / 2
  const sigmaHalf = ROTOR_D / 2 + JENSEN_K * x
  const core = (ROTOR_D / (ROTOR_D + 2 * JENSEN_K * x)) ** 2
  const deficit = 2 * a * core // = (1-sqrt(1-Ct))·(...)²
  // 横向： rotor 中心与 wake 中心的距离（含偏航偏折）
  const px = dx * fy - dy * fx // 垂直于风向的横向坐标
  const deflection = 2 * a * x * Math.tan((yawUpDeg * Math.PI) / 180) * 1.15
  const r = Math.abs(px - deflection)
  //  rotor 圆盘与高斯 wake 剖面的简化重叠：中心距 > 1.5σ 后快速衰减
  const overlap = Math.exp(-0.5 * (r / sigmaHalf) ** 2)
  return Math.min(0.85, deficit * overlap)
}

/** 等效风速（考虑尾流亏损后的来流） */
export function effWind(u: number, deficit: number): number {
  return u * (1 - deficit)
}

/**
 * 发电机/齿轮箱温度代理 (°C)：负载率 + 日间环境温度 + 确定性扰动。
 * 阈值 95°C 触发告警（演示告警引擎的输入，非实测热模型）。
 */
export function genTempC(loadFrac: number, tHours: number, unitIdx: number): number {
  const ambient = 16 + 9 * Math.sin(((tHours - 9) / 24) * Math.PI * 2)
  const loadHeat = 52 * loadFrac
  const turb = 1.6 * smoothNoise(tHours * 0.9 + unitIdx * 3.7, 11)
  return ambient + loadHeat + turb
}

/** 电网频率代理 (Hz)：源荷失衡的一阶摆动 + 慢漂移，限幅 ±0.2 */
export function gridFrequency(totalMW: number, targetMW: number, tHours: number): number {
  const imb = (totalMW - targetMW) / 45 // [-1,1]
  const slow = 0.045 * Math.sin((tHours / 6.3) * Math.PI * 2 + 1.1)
  const f = 50 + imb * 0.06 + slow
  return Math.min(50.15, Math.max(49.85, f))
}
