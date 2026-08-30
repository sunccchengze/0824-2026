/* ================================================================
 * florisData.ts — 钦定数据契约（真实 FLORIS 实算，非演示生成）
 * ----------------------------------------------------------------
 * 数据源：sunccchengze/wind_farm_viz @ arena/01a012f1-wind-farm-viz
 *   · site/assets/data.js（window.WIND_DATA）：FLORIS 定标表——
 *     双机 6/8/10/12 m/s × 偏航 ±30° 的单机/总功率与增益；
 *     9 机 3×3 阵列统一偏航扫描与四种策略寻优结果。
 *   · site/assets/data_3d_real.js（window.WIND_3D_REAL）：
 *     FLORIS 三维速度场网格（上风向双机 @632m，偏航 ±0/15/30°，
 *     x[-200,900]m × y[-300,300]m × z[20..180]m，U∞=8 m/s）。
 * 2026-08-28 原样抽取，未改任何数字。
 * 红线：真实值只用于定标/对照；HUD 引用处必须带【FLORIS 离线实算】角标，
 * 不得与浏览器代理模型的演示数字混写（docs/02 §1、docs/08 §A7）。
 * ================================================================ */

/** FLORIS 内嵌 NREL 5MW 功率曲线锚点（yaw=0 自由流）：风速 → kW */
export const FLORIS_POWER_CURVE = [
  { v: 6, kw: 731.0 },
  { v: 8, kw: 1753.95 },
  { v: 10, kw: 3417.8 },
  { v: 12, kw: 5000.0 },
] as const

/** 双机 8 m/s：上游偏航 → 两机功率（kW）（WIND_DATA.single，间距 632m=5D） */
export const FLORIS_PAIR_8MS = {
  yaw: [-30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30],
  p1: [1339.86, 1458.96, 1561.32, 1643.59, 1704.2, 1741.51, 1753.95, 1741.51, 1704.2, 1643.59, 1561.32, 1458.96, 1339.86],
  p2: [1010.0, 891.85, 756.53, 643.12, 539.06, 461.9, 436.44, 472.31, 555.49, 660.71, 778.04, 909.44, 1023.43],
} as const

/** 9 机 3×3 阵列统一偏航扫描（WIND_DATA.array）；totalKw[6] = 钦定基准 8095.15 */
export const FLORIS_ARRAY = {
  yawUpstream: [-30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30],
  totalKw: [9102.39, 9061.13, 8875.4, 8646.65, 8371.05, 8180.29, 8095.15, 8176.75, 8360.66, 8635.81, 8864.35, 9052.78, 9101.18],
  gainPct: [12.443, 11.933, 9.638, 6.813, 3.409, 1.052, 0.0, 1.008, 3.28, 6.681, 9.502, 11.829, 12.427],
} as const

/** 四种控制策略的场级结果（WIND_DATA.array_opt）——docs/03 钦定表逐项对应 */
export const FLORIS_STRATEGIES = {
  noneKw: 8095.15, // 对风基准（γ=0）
  unifiedKw: 9299.05, // 全场统一 +30°
  row2Kw: 9934.99, // 仅上游排 +30°（工程可实施折中）
  independentKw: 10041.46, // 逐机独立寻优 —— 论文主结果
  gainsPct: { unified: 14.87, row2: 22.73, independent: 24.04 },
  greedyRowYaws: [30, 20, 0] as const, // 贪心解：上游→中游→下游各行统一偏航
} as const

/** 定标量：FLORIS 双机 5D 间距、8 m/s、零偏航的下游速度亏损（速度比） */
export const WAKE_DEFICIT_REF_5D = 1 - Math.sqrt(FLORIS_PAIR_8MS.p2[6] / FLORIS_PAIR_8MS.p1[6])

/* ================================================================
 * FLORIS 三维速度场绑定（data_3d_real.js 抽取件，运行时注入）
 * 风纱/流线可视化在 FLORIS 覆盖区（T07→T04 双机走廊）优先采样真场，
 * 覆盖区外退回解析 Jensen 场；无真场（如生产包裁掉 135KB 数据）时同样退回。
 * ================================================================ */

export type FlorisCase = '+00' | '+15' | '+30' | '-15' | '-30'

export interface RealField {
  x: number[]
  y: number[]
  z: number[]
  /** u[iz][iy][ix]，m/s */
  u: number[][][]
}

let bound: Partial<Record<FlorisCase, RealField>> | null = null

/** main.tsx 启动时调用（dev 动态 import 数据件；生产可裁剪，返回 false） */
export function bindFloris3D(d: Partial<Record<FlorisCase, RealField>>): boolean {
  if (!d || !d['+00']) return false
  bound = d
  return true
}

export const floris3DBound = () => bound

/**
 * 世界系采样：twin 中北来风沿 +z→−z 吹（北=z 小）。FLORIS 场的 +x 为下游。
 * 映射：fx = 200 + (z − T07.z)（南移→下游→fx 增大 ✓），fy = x − T07.x（东为正，
 * 场 y 为横向东正 ✓），fz = 高度。T07 在场 fx=200 处，其下游 632m 的 T04
 * 落在 fx=832（超出场界 x≤900，覆盖 T04 前 700m 走廊）。
 */
export function sampleWorldU(fc: FlorisCase, x: number, y: number, z: number): number | null {
  const f = bound?.[fc]
  if (!f) return null
  const fx = 200 + (z + 640)
  const fy = x + 40
  const fz = y
  if (fx < f.x[0] || fx > f.x[f.x.length - 1]) return null
  if (fy < f.y[0] || fy > f.y[f.y.length - 1]) return null
  if (fz < f.z[0] || fz > f.z[f.z.length - 1]) return null
  let ix = 0
  while (ix < f.x.length - 2 && f.x[ix + 1] < fx) ix++
  let iy = 0
  while (iy < f.y.length - 2 && f.y[iy + 1] < fy) iy++
  let iz = 0
  while (iz < f.z.length - 2 && f.z[iz + 1] < fz) iz++
  const tx = (fx - f.x[ix]) / (f.x[ix + 1] - f.x[ix])
  const ty = (fy - f.y[iy]) / (f.y[iy + 1] - f.y[iy])
  const tz = (fz - f.z[iz]) / (f.z[iz + 1] - f.z[iz])
  let val = 0
  for (let d2 = 0; d2 <= 1; d2++)
    for (let d1 = 0; d1 <= 1; d1++)
      for (let d0 = 0; d0 <= 1; d0++) {
        const v = f.u[iz + d2][iy + d1][ix + d0]
        val += (Number.isFinite(v) ? v : 8) * (d0 ? tx : 1 - tx) * (d1 ? ty : 1 - ty) * (d2 ? tz : 1 - tz)
      }
  return val
}
