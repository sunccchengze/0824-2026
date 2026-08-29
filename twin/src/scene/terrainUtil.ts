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

// ---- 地形：暗海式场区（近似海面微起伏）+ 西北群山剪影（地平线带）----
export function terrainHeight(x: number, z: number): number {
  // 三层尺度：远景山脊、场区缓坡、近景碎石起伏。远处不再是一块平板，
  // 但机组基础附近仍保留可施工的缓坡，保证风机、电缆和升压站自然贴地。
  let h = N.ridged(x * 0.00042, z * 0.00042) * 72
    + N.fbm(x * 0.00088, z * 0.00088) * 30
    + N.fbm(x * 0.0048, z * 0.0048) * 4.0
    - 38
  // 中央风场轻压平：保留 10% 的大尺度地形起伏，不做完全水平的“海面”。
  const dF = Math.hypot(x / 1.06, (z + 320) / 0.94)
  const fieldFlatten = 1 - 0.78 * smoothstep(1060, 360, dF)
  h *= fieldFlatten
  // 场区外叠加低频宏观山脊；从风场向远处逐渐增强，形成真实纵深。
  const macro = (N.fbm(x * 0.00072 + 4.1, z * 0.00072 - 2.7, 5) - 0.46) * 130
  h += macro * (0.10 + 0.90 * smoothstep(360, 1250, dF))
  // 升压站局地再压平
  const dS = Math.hypot(x - SUBSTATION.x, z - SUBSTATION.z)
  h *= 1 - 0.92 * smoothstep(300, 130, dS)
  // 西北远山（地平线剪影带，画面左/上）：加强层次，但保持原冰青暗色。
  h += 235 * smoothstep(-650, -2400, z) * (0.34 + 0.66 * N.fbm(x * 0.00055, 7.7, 4))
  h += 180 * smoothstep(-900, -2200, x) * (0.44 + 0.56 * N.fbm(z * 0.00064, 3.3, 4))
  // 东侧远丘（右缘低剪影）
  h += 105 * smoothstep(1050, 2500, x) * (0.36 + 0.64 * N.fbm(z * 0.00066, 13.1, 4))
  return h
}

// ---- 场区：3×3 排布（舵机 1-5 与显眼机组编排见 SERVOS）----
// 注：列距 ≈410m ≈ 3.3D、行距 440m ≈ 3.5D，比真实尾流工程惯例（5-8D）更紧，
// 是 3×3 大屏构图的视觉取舍（docs/08 已登记为叙事风险，不伪称真实尾流优化）。
export interface FarmUnit { id: string; x: number; z: number; row: number; col: number; speed: number }
export const FARM: FarmUnit[] = (() => {
  const arr: FarmUnit[] = []
  // 排距（z）：远 -1080 / 中 -640 / 近 -200；列距（x）：-450 / -40 / 370
  const rowsZ = [-1080, -640, -200]
  const colsX = [-450, -40, 370]
  let k = 0
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const jx = (((k * 53) % 5) - 2) * 10
      const jz = (((k * 37) % 5) - 2) * 8
      arr.push({
        id: `T0${k + 1}`,
        x: colsX[c] + jx - 60,
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

// ---- 串接集电拓扑（A8 修正：每列一串 远→中→近→升压站，取代 9 条放射直连）----
// 视觉上仍保留“全场能量汇入升压站”的冰河叙事，工程口径变为 3 回集电线路。
export const COLLECTOR_CHAINS: number[][] = [0, 1, 2].map((c) => [c, c + 3, c + 6]) // FARM 索引：远→中→近

// ---- 世界标注锚点（引线标签用；全部锚定真实结构物/流场，不再悬空）----
const HUB_H = 90
export const ANCHOR = {
  // 全场功率总览 → 指向远排中机组 T02（代表阵列整体）
  power: { x: FARM[1].x, y: terrainHeight(FARM[1].x, FARM[1].z) + HUB_H + 14, z: FARM[1].z },
  // 风能资源场 → 阵列近排来风上游上空（主导风向 南→北 的来流一侧，轮毂高度）
  wake: { x: 60, y: terrainHeight(60, 120) + HUB_H + 6, z: 120 },
  // 风机 → 近排左机组 T07 轮毂
  turbine: { x: FARM[6].x, y: terrainHeight(FARM[6].x, FARM[6].z) + HUB_H - 2, z: FARM[6].z },
  // 集电线路 → 近排右机组→升压站主干线 55% 处（贴地 +3.5m，不悬空）
  cable: (() => {
    const t = 0.55
    const x = FARM[8].x + (SUBSTATION.x - FARM[8].x) * t
    const z = FARM[8].z + (SUBSTATION.z - FARM[8].z) * t
    return { x, y: terrainHeight(x, z) + 3.5, z }
  })(),
  // 升压站 → 屋顶 (30m 主体 + 基座)
  substation: { x: SUBSTATION.x - 40, y: terrainHeight(SUBSTATION.x, SUBSTATION.z) + 36, z: SUBSTATION.z - 10 },
  // 圈选：左下近景大机组（FARM[6] 附近）
  dot: { x: -610, y: terrainHeight(-610, -160) + 60, z: -160 },
}
