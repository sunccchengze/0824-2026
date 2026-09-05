// ================================================================
// 世界真值源（R4 · 原图像素级还原版）
// 地形 / 机位 / 升压站 / 相机 / 锚点 —— 全场景唯一权威
// 构图对齐 docs/research/mockups/user_original_微信图片_174_2.png：
//   远景排 → 中景排 → 近景排（近大远小）；升压站位于画面右下；
//   天际线 ≈ 画面上缘 12%；全场冰青全息基调
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

// ---- 地形：开放外海 + 两相邻侧陆地（第 32 轮 A-round2：用户回访加码）----
// 第 31 轮的海岸是单层 fbm 直线切割带（wobble ±320m），岬湾尺度单一；
// 本轮升级为「7 层噪声蜿蜒 + 大小高斯弧岬湾 + 双侧钳制 + 不规则离岸群岛/海岬」——
//  · 海域张角 100°（西岸线绕北角向南偏东 10°，不再是横平竖直的 90°）；
//  · 南(+z)、东(+x) 两【相邻侧】仍完全开放为纯海（无岸）；
//  · 北(-z)、西(-x) 为陆地，海岸线多尺度曲折（50m 微齿 ~ 3km 大岬湾）；
//  · 全部 9 机与升压站仍位于海中央（600m 机组净距硬约束，见 cap/bayCap）；
//  · 内陆远山加高锐化（300~550m 奇崛山体，雪冠载体更大）；
//  · 海床仍只保留极低幅微地貌（±2m），贴地稳定。
// 注：R32-R34 系回退后重做（见 twin/docs/research/R32-R34-改造提示词.md），
//     因原 commit 不在本快照内，函数名与原实现未必逐字一致，但几何约束等价。
/** 海上风电场中心（保持旧取景重心；本版地形不再以之为圆心） */
export const FARM_CENTER = { x: -100, z: -640 } as const

/** 北向(-z)海岸线基准：dNorth = -z + wobbleN(x) - CN0，>0 为陆侧 */
const CN0 = 2100
/** 西向(-x)海岸线基准：dWest = -x + wobbleW(z) - CW0，>0 为陆侧 */
const CW0 = 1750
/** 西岸整体倾角：tan10°，绕北角拐点向南偏东 —— 海域张角由 90° 打开到 100° */
const TILT10 = 0.1763
/** 倾角枢轴 z（北角拐点，与北岸标称衔接） */
const TILT_PIVOT_Z = -2100
/** 海岸抬升带宽（0→RAMP_W 米内 land 0→1，决定沙带/潮带宽度） */
export const RAMP_W = 520
/** 蜿蜒钳制（cap/bayCap）：向陆最多 -380m；向海（bay 侧）北岸 +200 / 西岸 +350 ——
 *  与 CN0/CW0 联立保证：9 机 + 升压站处 landMask ≡ 0，且 600m 环内零沾陆
 *  （实测最近沾陆约 700m＠T09——东南卫星小岛方向，本土岸线更远；
 *  100m 粒度环扫；selftest R32-A1 断言锁定）。 */
const WOB_LAND = -380
const BAYCAP_N = 200
const BAYCAP_W = 350

/** 5 层噪声蜿蜒基底（fbm 主波 + 次级 + 脊线岬角 + 微细节） */
function wobbleBase(x: number, s: number): number {
  const n5 = N.fbm(x * 0.00058 + s, 40.0, 3) - 0.5
  const n4 = N.fbm(x * 0.0016 + s * 2.1, 7.7, 3) - 0.5
  const n3 = N.ridged(x * 0.0009 + s * 0.7, 21.0, 2) - 0.5
  const n2 = N.fbm(x * 0.0042 + s * 3.7, 3.1, 2) - 0.5
  const n1 = N.fbm(x * 0.009 + s * 5.3, 9.4, 2) - 0.5   // 小岬湾（~110m）
  const n0 = N.fbm(x * 0.021 + s * 7.9, 1.2, 1) - 0.5   // 微齿（~50m）
  return n5 * 2 * 260 + n4 * 2 * 90 + n3 * 2 * 70 + n2 * 2 * 25 + n1 * 2 * 38 + n0 * 2 * 16
}

/** 北岸蜿蜒：基底 + 高斯弧（西段岬/东段岬/中部湾），再双侧钳制 */
function wobbleN(x: number): number {
  const g1 = Math.exp(-(((x + 1500) / 700) ** 2)) * 220 // 西段岬（向海）
  const g2 = Math.exp(-(((x - 800) / 900) ** 2)) * 260  // 东段岬（向海）
  const bay = Math.exp(-(((x + 200) / 600) ** 2)) * 180 // 中部大湾（向陆收）
  const g3 = Math.exp(-(((x - 300) / 260) ** 2)) * 120  // 东段小岬（向海）
  const bay2 = Math.exp(-(((x - 1300) / 300) ** 2)) * 130 // 东段小湾（向陆收）
  const raw = wobbleBase(x, 5.7) + g1 + g2 + g3 - bay - bay2
  return Math.max(WOB_LAND, Math.min(BAYCAP_N, raw))
}

/** 西岸蜿蜒：基底 + 高斯弧（北段岬/南段湾），再双侧钳制 */
function wobbleW(z: number): number {
  const g1 = Math.exp(-(((z + 1800) / 800) ** 2)) * 240 // 北段岬（向海）
  const bay = Math.exp(-(((z - 200) / 700) ** 2)) * 200  // 南段大湾（向陆收）
  const g2 = Math.exp(-(((z - 900) / 300) ** 2)) * 130  // 中段小岬（向海）
  const bay2 = Math.exp(-(((z + 800) / 350) ** 2)) * 120 // 北段小湾（向陆收）
  const raw = wobbleBase(z, -3.2) + g1 + g2 - bay - bay2
  return Math.max(WOB_LAND, Math.min(BAYCAP_W, raw))
}

/** 北岸带符号距离（米，>0 陆侧，<0 海侧）：landMask 与 vCoast 的同一真值 */
export function dNorth(x: number, z: number): number {
  return -z + wobbleN(x) - CN0
}
/** 西岸带符号距离（米，>0 陆侧，<0 海侧）：含整体倾角项（海域张角 100°） */
export function dWest(x: number, z: number): number {
  return -x + wobbleW(z) - CW0 + (z - TILT_PIVOT_Z) * TILT10
}

/** 离岸地貌：2 主岛 + 2 卫星小岛 + 1 北岸海岬（全部远离机组/电缆/升压站，见 selftest）。
 *  p1/p2/p3 为轮廓角向谐波相位（3/5/8 瓣，±45% 半径起伏）—— 岛不再是正圆，
 *  而是有岬有湾的不规则岛；卫星小岛构成群岛感。 */
export interface CoastFeature { x: number; z: number; r: number; h: number; p1: number; p2: number; p3: number }
export const ISLANDS: CoastFeature[] = [
  { x: 1700, z: 700, r: 260, h: 26, p1: 1.3, p2: 4.1, p3: 2.2 }, // 东南外海大岛（距 T09/电缆走廊 1353m）
  { x: -500, z: 1400, r: 200, h: 20, p1: 5.0, p2: 0.7, p3: 3.3 }, // 南外海小岛（100°倾角后东移，距 T07 约 1400m）
]
/** 卫星小岛（东南大岛附属，纯海中央，与电缆/机组均 >800m） */
export const SATS: CoastFeature[] = [
  { x: 2100, z: 1100, r: 70, h: 9, p1: 2.0, p2: 1.1, p3: 5.4 },
  { x: 1300, z: 300, r: 55, h: 7, p1: 4.4, p2: 2.8, p3: 0.5 },
]
export const HEADLANDS: CoastFeature[] = [
  { x: -1250, z: -2400, r: 480, h: 42, p1: 0, p2: 0, p3: 0 }, // 北岸向南突出的海岬（距 T01 1218m）
]
/** 岛极坐标：角向谐波半径 rr(θ)，设色 mask 与锥形抬升共用（同一真值） */
function islandPolar(f: CoastFeature, x: number, z: number): { d: number; rr: number } {
  const dx = x - f.x, dz = z - f.z
  const d = Math.hypot(dx, dz)
  const th = Math.atan2(dz, dx)
  const rr = f.r * (1 + 0.22 * Math.sin(3 * th + f.p1) + 0.14 * Math.sin(5 * th + f.p2) + 0.09 * Math.sin(8 * th + f.p3))
  return { d, rr }
}
/** 全部离岸岛（二主二卫）：mask 与抬升共用此表 */
const ISLES: CoastFeature[] = [...ISLANDS, ...SATS]

/** 方向性陆地基底（北/西，不含岛——岛只做锥形抬升+设色，不触发内陆分带） */
function landBase(x: number, z: number): number {
  const wN = smoothstep(0, RAMP_W, dNorth(x, z))
  const wW = smoothstep(0, RAMP_W, dWest(x, z))
  return Math.max(wN, wW)
}

/** 海岸过渡场（与陆地基底同式，不含岛）：vCoast / Step B 海岸距离场的同一真值 */
export function coastT(x: number, z: number): number {
  return landBase(x, z)
}

/**
 * 陆地权重 0..1：0=开放海床，1=陆地。北/西两个方向各自产生一片陆地，
 * 用平滑 max 组合 —— 任一方向靠陆即抬升。南/东即保持 0（开放海）。
 * 多尺度蜿蜒 + 高斯弧岬湾破除「直线切割」的切割带感；离岸岛叠加设色 mask。
 */
export function landMask(x: number, z: number): number {
  let m = landBase(x, z)
  for (const f of ISLES) {
    const { d, rr } = islandPolar(f, x, z)
    if (d < rr + 120) m = Math.max(m, 1 - smoothstep(rr * 0.45, rr + 80, d))
  }
  return m
}

/** 雪线（米）：山地带中世界高度超过此值染雪冠（GPU 端，见 WorldTerrain v4） */
export const SNOW_LINE = 205

/** 确定性 RNG（草地落位与 selftest 共用，保证"采样验证"与"真实落位"同分布） */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 草地拒绝采样命中数（kind 0=草原带 / 1=林下）：与 grassField.buildSet 同条件
 *  （landMask≥0.05 且按 biome 权重接受）。默认 2 万次试投，命中 >1% 即对应
 *  生物群系带真实存在、全量 6 万可按同分布铺满。 */
export function grassSampleHits(kind: 0 | 1, tries = 20000): number {
  const rnd = mulberry32(kind === 0 ? 1337 : 7331)
  let hits = 0
  for (let i = 0; i < tries; i++) {
    const x = (rnd() * 2 - 1) * 4550
    const z = (rnd() * 2 - 1) * 4550
    if (landMask(x, z) < 0.05) continue
    const w = biomeWeights(x, z)
    if (rnd() > (kind === 0 ? w.grass : w.forest)) continue
    hits++
  }
  return hits
}

/** 六类生物群系权重（CPU 端，与 WorldTerrain v4 GPU 分带同式）：沙岸/潮带/草原/林地/缓丘/远山。
 *  供贴地物（草地散布等）与 selftest 消费；海面（land≈0）返回全零。 */
export interface BiomeWeights {
  sand: number; tidal: number; grass: number; forest: number; hill: number; mountain: number
}
export function biomeWeights(x: number, z: number): BiomeWeights {
  const L = landMask(x, z)
  if (L <= 0.001) return { sand: 0, tidal: 0, grass: 0, forest: 0, hill: 0, mountain: 0 }
  const sand = 1 - smoothstep(0.06, 0.16, L)
  const tidal = smoothstep(0.05, 0.12, L) * (1 - smoothstep(0.16, 0.28, L))
  const grass = smoothstep(0.14, 0.30, L) * (1 - smoothstep(0.45, 0.62, L))
  const forest = smoothstep(0.38, 0.55, L) * (1 - smoothstep(0.68, 0.82, L))
  const hill = smoothstep(0.60, 0.75, L) * (1 - smoothstep(0.85, 0.95, L))
  const mountain = smoothstep(0.82, 0.93, L)
  // 主导群系对比增强（pow 1.25 再归一，与 GPU 同式）：过渡带不再"混在一起看不真切"
  const ce = 1.25
  const eSand = sand ** ce, eTidal = tidal ** ce, eGrass = grass ** ce
  const eForest = forest ** ce, eHill = hill ** ce, eMtn = mountain ** ce
  const s = eSand + eTidal + eGrass + eForest + eHill + eMtn
  // 中间过渡带各分量和可能 <1（分带交叠设计），归一保证"权重"语义
  if (s < 1e-6) return { sand: 0, tidal: 0, grass: 0, forest: 0, hill: 0, mountain: 0 }
  return { sand: eSand / s, tidal: eTidal / s, grass: eGrass / s, forest: eForest / s, hill: eHill / s, mountain: eMtn / s }
}

/**
 * 地面【实际渲染面】高度（第 30 轮起连续面）。
 * 直接等于连续地形 terrainHeight（连续海床，无台地量化台阶）。
 * 贴地基准与渲染面同源 —— 风机/升压站/电缆/星光全部贴它定位，零回归。
 */
export function terrainSurfaceY(x: number, z: number): number {
  return terrainHeight(x, z)
}

export function terrainHeight(x: number, z: number): number {
  const land = landBase(x, z)
  // 海床基准（低，贴近真实海平台）+ 极低幅微地貌（不是完全平面）
  const bed = (N.fbm(x * 0.0009, z * 0.0009, 3) - 0.5) * 4.0
  let h = 2.0 + bed
  if (land > 0) {
    // 分带：近岸沙带(矮、平缓) → 森林台地(中、丘陵起伏) → 内陆远山(高、奇崛)
    const sand = smoothstep(0.0, 0.28, land)      // 近海黄沙带
    const forest = smoothstep(0.20, 0.72, land)   // 森林台地
    const mountain = smoothstep(0.55, 1.0, land)  // 内陆远山
    const roll = (N.fbm(x * 0.0021 + 8.8, z * 0.0021 - 3.3, 2) - 0.5) * 2 // 台地丘陵起伏 ±12m
    const crag = N.ridged(x * 0.00032 + 3.1, z * 0.00032 - 1.4, 4)        // 主峰（锐化）
    const crag2 = N.ridged(x * 0.0011 - 7.7, z * 0.0011 + 4.2, 2)         // 次峰（破碎感）
    h += sand * 10
    h += forest * (34 + 20 * N.ridged(x * 0.0005 + 1.7, z * 0.0005 - 9.3, 3) + 12 * roll)
    h += mountain * (90 + 300 * crag ** 1.4 + 60 * crag2)
  }
  // 离岸岛/海岬（第 32 轮）：不规则轮廓锥形抬升（中心全高 → rr+180m 处归零），
  // 与主体陆地自然衔接；岛只走本抬升，不触发上面的内陆分带（避免岛变高山）。
  for (const f of ISLES) {
    const { d, rr } = islandPolar(f, x, z)
    if (d < rr + 180) h += f.h * (1 - smoothstep(0, rr + 180, d))
  }
  for (const f of HEADLANDS) {
    const d = Math.hypot(x - f.x, z - f.z)
    if (d < f.r + 220) h += f.h * (1 - smoothstep(0, f.r + 220, d))
  }
  // 升压站局地再压平（站体仍在海中央）
  const dS = Math.hypot(x - SUBSTATION.x, z - SUBSTATION.z)
  h *= 1 - 0.9 * smoothstep(300, 130, dS)
  return h
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
