// ================================================================
// 世界真值源（R4 · 原图像素级还原版 → 第 32 轮：真实海岸线/地貌）
// 地形 / 机位 / 升压站 / 相机 / 锚点 —— 全场景唯一权威
// 构图对齐 docs/research/mockups/user_original_微信图片_174_2.png：
//   远景排 → 中景排 → 近景排（近大远小）；升压站位于画面右下；
//   天际线 ≈ 画面上缘 12%；全场冰青全息基调
// ----------------------------------------------------------------
// 第 32 轮（真实化改造）要义：
//  · 海岸线不再是一根带 320m 摆动的直线，而是确定性「沿岸弧叠加」
//    塑造的三档尺度岬/湾交替（巨弧 3~7km / 中弧 0.7~1.6km / 微弧 0.1~0.3km）
//    ——真正的多波长不规则海岸，见 wobN/wobW 与 ARCS_N/ARCS_W；
//  · 海岸宽度（沙带/崖岸）不再由单一 landMask 带决定：新增
//    signedShore()（到海岸线零集的带符号距离）与沿岸地貌性格 rock，
//    滩宽随局部坡度/地貌/噪声天然宽窄不一；
//  · 山体植被不同：靠岸低地为沙丘/疏草，内陆按地貌脊线分成不同
//    高度带的缓丘-丘陵-远山（颜色在着色器按高程/坡度/湿度分区）；
//  · 陆上微起伏：沙丘带、滩脊、内陆丘陵、远山脊线，保证贴近陆地
//    时有连续的地形起伏细节（网格在岸线带加密，见 WorldTerrain）。
// ================================================================

function makeNoise(seed = 7) {
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 17.43) * 43758.5453
    return s - Math.floor(s)
  }
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const n2 = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = x - xi, yf = y - yi
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
    const u = smooth(xf), v = smooth(yf)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  const fbm = (x: number, y: number, oct = 4) => {
    let v = 0, amp = 0.5, fx = x, fy = y
    for (let i = 0; i < oct; i++) { v += amp * n2(fx, fy); fx *= 2.03; fy *= 2.03; amp *= 0.52 }
    return v
  }
  const ridged = (x: number, y: number, oct = 4) => {
    let v = 0, amp = 0.55, fx = x, fy = y
    for (let i = 0; i < oct; i++) {
      const r = 1 - Math.abs(2 * n2(fx, fy) - 1)
      v += amp * r * r
      fx *= 2.11; fy *= 2.11; amp *= 0.5
    }
    return v
  }
  return { n2, fbm, ridged }
}
const N = makeNoise()
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

// =================================================================
// 第 31 轮框架：开放外海 —— 南(+z)/东(+x) 开放为海，北(-z)/西(-x) 为陆地。
// 第 32 轮：把两片「带噪声摆动的直线海岸」升级为多尺度分形蜿蜒海岸。
// =================================================================
/** 海上风电场中心（保持旧取景重心） */
export const FARM_CENTER = { x: -100, z: -640 } as const

/** 北岸基准线：z = -(CN0 + wobN(x))（越往北 -z 越大越靠陆；靠陆 2300m 处验收点须 ≥30m 高） */
const CN0 = 2050
/** 西岸基准线：x = -(CW0 + wobW(z)) */
const CW0 = 1720
/** landMask 由 0→1 的抬升带宽（米，沿岸法向） */
const RAMP_W = 520

// -----------------------------------------------------------------
// 第 32 轮海岸线位移：真正“分形”的多尺度沿岸噪声。
//   · 直线/一档噪声被淘汰（实测 10km 一弯 → 视觉平直）；
//   · 高斯弧线性叠加也不行（细尺度被粗尺度淹没 → 收敛成单调坡）。
//   · 采用 5 层独立相位的价值噪声叠加（主波 λ≈3km/1km/320m 三层 +
//     ridged 陡脊两层），每层自带局部极值 → 岬/湾在 100m~3km 全尺度
//     交错，且与幅度包络 env 相乘（近场收敛、远场放开）。
//   · 位移最终夹在 [cap*, bayCap*] 之间：cap* = 600m 机组净距的解析
//     安全下限（连续性设计，无平台折角）；bayCap* = 2300m 内陆验收
//     剖面的湾幅上限。双向约束都是硬性几何保证（见 selftest）。
// -----------------------------------------------------------------
/** 沿岸位移噪声 -1..1（五层，尺度 100m~3km） */
function wobble1(q: number, seed: number): number {
  const o1 = (N.fbm(q * 0.00042 + seed, 17.3 + seed * 3.1, 3) - 0.5) * 2
  const o2 = (N.fbm(q * 0.0013 - seed * 1.3, 83.9 + seed * 1.7, 3) - 0.5) * 2
  const o3 = (N.fbm(q * 0.0039 + seed * 2.9, 41.2 + seed * 2.3, 2) - 0.5) * 2
  const r1 = (N.ridged(q * 0.0009 - seed, 5.5 + seed * 4.1, 3) - 0.5) * 2
  const r2 = (N.ridged(q * 0.0027 + seed * 0.7, 67.3 + seed * 1.1, 2) - 0.5) * 2
  const o4 = (N.fbm(q * 0.0064 + seed * 5.7, 90.1 + seed * 2.9, 2) - 0.5) * 2 // ~150m 细碎
  const r3 = (N.ridged(q * 0.0061 - seed * 2.3, 21.7 + seed * 6.7, 2) - 0.5) * 2 // 微岬
  return 0.27 * o1 + 0.23 * o2 + 0.13 * o3 + 0.17 * r1 + 0.09 * r2 + 0.07 * o4 + 0.06 * r3
}

// 幅度包络：离风场走廊越近，海岸可动范围越小（600m 净距 + 2300m 验收剖
// 面的硬约束留给 cap/bayCap，包络只负责让“典型摆幅”落在允许带内，
// 保证上限/下限几乎不被触碰 → 没有平台化折线）。
const envN = (q: number) => 0.50 + 0.50 * smoothstep(1000, 4200, Math.abs(q))
const envW = (q: number) => 0.50 + 0.50 * smoothstep(1000, 4200, Math.abs(q + 640))

// 风场走廊沿岸度（只用于 bayCap）
const rampN = (x: number) => clamp01((Math.abs(x) - 1000) / 2300)
const rampW = (z: number) => clamp01((Math.abs(z + 640) - 1150) / 2300)
// 湾后撤上限：近场 = 2300m 内陆验收剖面给的最大湾深；远场放开（风场远方
// 可深湾，与镜头无关）。
const bayCapN = (x: number) => 340 + 560 * smoothstep(0, 1, rampN(x))
const bayCapW = (z: number) => 170 + 660 * smoothstep(0, 1, rampW(z))

/** 岬角（负位移）安全下限：保证北岸任一点到 9 机 ≥600m（2D 距离）。 */
function capNorth(x: number): number {
  const h = Math.min(Math.abs(x + 732), Math.abs(x + 100), Math.abs(x - 532))
  // 北岸到北排机组（z=-1272）基准净距 = CN0-1272 = 778m → 安全余量 178m。
  // h<600 按 2D 距离精确给下限；h≥600 横距已 ≥600，仅线性放宽 + 视觉下限，
  // 全程连续（h=600 处 = -778），不产生沿岸折角/平台。
  return h >= 600
    ? Math.max(-1150, -778 - (h - 600) * 0.3)
    : -778 + Math.sqrt(Math.max(0, 360000 - h * h))
}
/** 西岸岬角安全下限：基准净距 CW0-732 = 988m，行 z∈{-1272,-640,-8} */
function capWest(z: number): number {
  const h = Math.min(Math.abs(z + 1272), Math.abs(z + 640), Math.abs(z + 8))
  return h >= 600
    ? Math.max(-1150, -988 - (h - 600) * 0.3)
    : -988 + Math.sqrt(Math.max(0, 360000 - h * h))
}

/** 均值零化（fbm/ridged 的均值略偏 + 种子偏移 → 先除偏再放大） */
const WOBBLE_MEAN_5 = (() => {
  let s = 0
  for (let i = 0; i <= 400; i++) s += wobble1(-4600 + i * 23, 5.3)
  return s / 401
})()
const WOBBLE_MEAN_2 = (() => {
  let s = 0
  for (let i = 0; i <= 400; i++) s += wobble1(-4600 + i * 23, 2.1)
  return s / 401
})()

/** 北岸位移（米；正=湾后撤，负=岬前凸）——导出供诊断/自检 */
export function wobN(x: number): number {
  const raw = envN(x) * 1500 * (wobble1(x, 5.3) - WOBBLE_MEAN_5)
  return Math.min(Math.max(raw, capNorth(x)), bayCapN(x))
}
/** 西岸位移（米）——导出供诊断/自检 */
export function wobW(z: number): number {
  const raw = envW(z) * 1650 * (wobble1(z * 0.87 + 31.7, 2.1) - WOBBLE_MEAN_2)
  return Math.min(Math.max(raw, capWest(z)), bayCapW(z))
}

/** 到北岸的带符号距离（米；>0 靠陆一侧） */
function dNorth(x: number, z: number): number {
  return -z - CN0 - wobN(x)
}
/** 到西岸的带符号距离（米；>0 靠陆一侧） */
function dWest(x: number, z: number): number {
  return -x - CW0 - wobW(z)
}

/**
 * 陆地权重 0..1：0=开放海床，1=陆地。北/西两个方向各成一片陆地，
 * 用平滑 max 组合 —— 任一方向靠陆即抬升。南/东保持 0（开放海）。
 *
 * R34 · 离岸小岛 + 海岬（叠加在 R32 多波长蜿蜒岸线之上）
 *  · ISLANDS：2 个离岸小岩礁，在 hero 视角能直接看到（< 2000m 距离）
 *  · HEADLANDS：1 个明显的海岬，从西岸凸出 ~300m
 *  · 不动 R32 landMask 主体算法（wobble1 / cap / bayCap 安全约束）
 */
interface IslandSpec { cx: number; cz: number; r: number; h: number }
const ISLANDS: IslandSpec[] = [
  // 西北小岛（远景能看到的"小岩礁"）
  { cx: -700, cz: -1900, r: 90, h: 16 },
  // 西南小岛（画面左下"礁石"）
  { cx: -1300, cz: -400, r: 100, h: 18 },
]
const HEADLANDS: IslandSpec[] = [
  // 西岸海岬（沿 -x 岸线凸出 300m）
  { cx: -1100, cz: -1100, r: 200, h: 26 },
]
export function landMask(x: number, z: number): number {
  const Ln = smoothstep(0, RAMP_W, dNorth(x, z))
  const Lw = smoothstep(0, RAMP_W, dWest(x, z))
  let land = Math.max(Ln, Lw)
  // 离岸小岛（圆形 mask）
  for (const isl of ISLANDS) {
    const d = Math.hypot(x - isl.cx, z - isl.cz)
    if (d < isl.r) {
      const m = 1 - smoothstep(isl.r * 0.7, isl.r, d)
      land = Math.max(land, m * 0.98)
    }
  }
  // 海岬
  for (const hd of HEADLANDS) {
    const d = Math.hypot(x - hd.cx, z - hd.cz)
    if (d < hd.r) {
      const m = 1 - smoothstep(hd.r * 0.5, hd.r, d)
      land = Math.max(land, m * 0.95)
    }
  }
  return land
}

/**
 * 到「海岸线零集」的带符号近似距离（米）：>0 在陆侧、<0 在海侧。
 * 用于着色器分带（湿沙/干滩/沙丘带/植被带）——宽度随海岸线形态
 * 与沿岸地貌自然变化，实现「海岸宽窄不一」。
 */
export function signedShore(x: number, z: number): number {
  const dn = dNorth(x, z)
  const dw = dWest(x, z)
  const inLand = dn > 0 || dw > 0
  if (!inLand) return Math.max(dn, dw)          // 海侧：取最近一条岸
  if (dn > 0 && dw > 0) return Math.min(dn, dw) // 陆角内侧：到更近的岸
  return Math.max(dn, dw)                        // 单岸陆侧
}

/**
 * R32 · 闭式反解 landMask=0.5 等值面的带符号米距离（海侧负、陆侧正）。
 * 复用 landMask 已有的 wN / wW 闭式场，不再走 EDT 二维扫描。
 *
 * landMask 中 dNorth = -z - CN0 - wobN(x)：>0 陆、<0 海
 *   dNorth=0 等值面在 z* = -(CN0+wobN(x))（北岸零线）
 *   距该零线的"海侧负/陆侧正"米数 = -z - (CN0+wobN(x)) - 0（dNorth 本身）
 *   但只在 |dNorth|<RAMP_W 内有意义；超出则置 ±∞，片元用 abs 收 0..3.2m
 *
 * 同理 dWest = -x - CW0 - wobW(z)
 *
 * 取 min：陆角处取"较近"那条岸；单岸陆/海任一方向都按 d* 自身符号。
 */
export function terrainCoastDistance(x: number, z: number): number {
  const dn = -z - CN0 - wobN(x)        // 北岸 dNorth：>0 陆、<0 海
  const dw = -x - CW0 - wobW(z)        // 西岸 dWest
  // dNorth/dWest 在 [−RAMP_W, +RAMP_W] 内线性；在带外 landMask 已饱和，
  // 但带外我们也要给"远处有距离"的近似。RAMP_W=520，超出后线性外推。
  // clamp 到 ±2000 防数值爆（片元 abs(...)<3.2 会把带外自然收敛到 0）。
  const dnClamped = Math.max(-2000, Math.min(2000, dn))
  const dwClamped = Math.max(-2000, Math.min(2000, dw))
  return Math.min(dnClamped, dwClamped)
}

/** 沿岸地貌性格 0..1：0=平缓沙岸（宽滩+沙丘），1=岩岸岬角（崖岸+砾滩） */
function coastalRock(x: number, z: number): number {
  const g1 = N.ridged(x * 0.00062 + 7.31, z * 0.00055 - 11.7, 4)
  const g2 = N.ridged(x * 0.0019 - 3.1, z * 0.0016 + 2.9, 3)
  return clamp01(g1 * 1.7 + g2 * 0.9 - 1.05)
}

/**
 * 地面【实际渲染面】高度（连续面，无台地量化台阶）。
 * 贴地基准与渲染面同源 —— 风机/升压站/电缆/星光全部贴它定位，零回归。
 */
export function terrainSurfaceY(x: number, z: number): number {
  return terrainHeight(x, z)
}

export function terrainHeight(x: number, z: number): number {
  // —— 海床基准（低，贴近真实海平台）+ 低幅微地貌 ——
  const bed = (N.fbm(x * 0.0009, z * 0.0009, 3) - 0.5) * 4.0
  let h = 2.0 + bed

  const dn = dNorth(x, z)
  const dw = dWest(x, z)
  if (dn <= 0 && dw <= 0) {
    // 开放海：直出（波/浪由片元处理）
    return flattenSubstation(x, z, h)
  }

  // —— 陆地：由「到岸距离 ds」分带塑造地貌（米级连续过渡）——
  // ds：陆侧到最近海岸线零集的距离
  const ds = dn > 0 && dw > 0 ? Math.min(dn, dw) : Math.max(dn, dw)

  // 沿岸地貌性格：低=沙岸，高=岩岸（值由两条脊线噪声交替，连续）
  const rock = coastalRock(x, z)
  const sandN = N.fbm(x * 0.0017 + 3.4, z * 0.0013 - 6.2, 3)       // 沿岸细变化
  const duneN = N.ridged(x * 0.0026 - 1.8, z * 0.0021 + 8.8, 3)    // 沙丘脊

  // 1) 滩面（前滨/湿滩）：水边 0→~2m
  h += 1.7 * smoothstep(0, 16, ds) * (0.7 + 0.6 * sandN)

  // 2) 干滩与沙丘带（岩岸几乎没有沙）：沙丘随 duneN 起伏，宽窄随 rock
  const duneEnd = 560 * (1 - rock * 0.84) + 90 * rock
  h += (1 - rock) * (6.0 + 12.0 * duneN * duneN)
    * smoothstep(12, 70, ds) * (1 - smoothstep(duneEnd * 0.5, duneEnd, ds))

  // 3) 岩岸岬角：崖体在岸线附近快速抬升（陡、窄滩），并保留远处山体
  h += rock * (16 + 100 * duneN * duneN) * smoothstep(4, 160, ds)

  // 4) 后缘缓丘-疏林丘陵（沿岸带之后全部覆盖，形态随脊线起伏）
  const hills = 32 + 62 * N.ridged(x * 0.00042 + 9.2, z * 0.00035 - 4.1, 4)
  h += hills * smoothstep(110, 680, ds)

  // 5) 内陆基座：保证内陆整体明显高于海面（距岸 ~300m 起稳定 +36m，
  //    使 2300m 验收剖面在湾幅上限下仍 ≥30m）
  h += 36 * smoothstep(300, 1050, ds)

  // 6) 远山体（距岸 ~1km+ 隆起为山，脊线噪声 5~15km 尺度 + 次级 0.5~1km）
  const mtn = 45 + 175 * N.ridged(x * 0.00019 + 3.3, z * 0.00016 - 8.8, 4)
    + 26 * N.ridged(x * 0.0011 - 5.1, z * 0.0009 + 1.6, 4)
  h += mtn * smoothstep(900, 2400, ds)

  // R34 · 离岸小岛 / 海岬的额外高度（与 R32 主体算法独立叠加）
  for (const isl of ISLANDS) {
    const d = Math.hypot(x - isl.cx, z - isl.cz)
    if (d < isl.r) {
      const peak = 1 - smoothstep(0, isl.r, d)
      h += peak * isl.h
    }
  }
  for (const hd of HEADLANDS) {
    const d = Math.hypot(x - hd.cx, z - hd.cz)
    if (d < hd.r) {
      const peak = 1 - smoothstep(0, hd.r, d)
      h += peak * hd.h
    }
  }

  return flattenSubstation(x, z, h)
}

/** 升压站局地再压平（站体仍居海中央，海床低幅微地貌不影响站体） */
function flattenSubstation(x: number, z: number, h: number): number {
  const dS = Math.hypot(x - SUBSTATION.x, z - SUBSTATION.z)
  return h * (1 - 0.9 * smoothstep(300, 130, dS))
}

// ---- 场区：3×3 排布（舵机 1-5 与显眼机组编排见 SERVOS）----
// 2026-08-28（任务#1 数据对齐）：阵列几何直接采用老网页/FLORIS 例题场
// ——3×3、纵横间距 632 m = 5.02D（NREL 5MW D=126m）。这同时消解了
// docs/07 B7 的"间距小于工程惯例"叙事风险：5D 恰是尾流控制惯例下限，
// 且与本仓引用的 FLORIS 9 机基准功率 8095.15 kW 同一几何，代理引擎
// 的尾流 k 即按该工况标定（turbinePhysics.JENSEN_K）。机组 ±20m 内
// 微移位为取景用的确定性抖动（演示层，不影响功率物理口径）。
export const ROW_GAP_M = 632 // 行距=FLORIS 例程阵列间距（5.02D）
export const COL_GAP_M = 632 // 列距

export const ROTOR_D_M = 126 // NREL 5MW 风轮直径（示意几何）
export interface FarmUnit { id: string; x: number; z: number; row: number; col: number; speed: number }
export const FARM: FarmUnit[] = (() => {
  const arr: FarmUnit[] = []
  // 场心 (-100, -640)（保持旧取景重心）；FLORIS 间距 632m
  const rowsZ = [-1272, -640, -8]
  const colsX = [-732, -100, 532]
  let k = 0
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const jx = (((k * 53) % 5) - 2) * 10
      const jz = (((k * 37) % 5) - 2) * 8
      arr.push({
        id: `T0${k + 1}`,
        x: colsX[c] + jx,
        z: rowsZ[r] + jz,
        row: r, col: c,
        speed: 1.02 + ((k * 29) % 5) * 0.1,
      })
      k++
    }
  }
  return arr
})()

// 5 路舵机对应的机组（近大远小中最显眼 5 台：近排左/中、中排左/右、远排中）
export const SERVOS: number[] = [6, 7, 3, 5, 1]

export const ROW_COUNT = 3

// 升压站：画面右中下（原图位置 x≈60%、y≈58%）
export const SUBSTATION = { x: 300, z: 300 }
export const APPROACH = { x: 1900, z: 1400 }

// ---- 相机构图（对版原图：强透视、天际线≈画面上缘 12%）----
export const CAM = {
  pos: [60, 430, 990] as [number, number, number],
  target: [0, 22, -340] as [number, number, number],
  fov: 47,
}

// ---- 世界标注锚点（引线标签用）----
// A6 修复：锚点必须挂在"被指物体"的真实几何位置附近（塔基/机舱/站体顶/
// 线路中点），而不是随意的高空悬点；Callouts 还会按屏幕投影做避让。
const HUB = 90 // 轮毂高（米）
export const ANCHOR = {
  // 全场功率总览 → 指向中排中间机组机舱（功率汇聚的语义中心）
  power: { x: FARM[4].x, y: terrainSurfaceY(FARM[4].x, FARM[4].z) + HUB + 8, z: FARM[4].z },
  // 风能资源场 → 近排北侧的来流空域（机组北缘外 220m、轮毂高度）
  wake: { x: FARM[7].x, y: terrainSurfaceY(FARM[7].x, FARM[7].z - 220) + HUB - 6, z: FARM[7].z - 220 },
  // 风机 → 近排左侧机组（T07）塔筒中段
  turbine: { x: FARM[6].x + 14, y: terrainSurfaceY(FARM[6].x, FARM[6].z) + 52, z: FARM[6].z },
  // 集电线路 → 近排串接电缆中段（行 z 与升压站之间）
  cable: { x: (FARM[8].x + SUBSTATION.x) / 2, y: terrainSurfaceY((FARM[8].x + SUBSTATION.x) / 2, (FARM[8].z + SUBSTATION.z) / 2) + 14, z: (FARM[8].z + SUBSTATION.z) / 2 },
  // 升压站 → 站体顶缘
  substation: { x: SUBSTATION.x - 40, y: terrainSurfaceY(SUBSTATION.x, SUBSTATION.z) + 46, z: SUBSTATION.z - 20 },
  // 圈选：左下近景大机组（T07 塔基）
  dot: { x: FARM[6].x, y: terrainSurfaceY(FARM[6].x, FARM[6].z) + 4, z: FARM[6].z },
}
