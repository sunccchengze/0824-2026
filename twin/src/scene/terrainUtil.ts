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

// ---- 世界标注锚点（引线标签用）----
export const ANCHOR = {
  power: { x: -520, y: terrainHeight(-520, -1080) + 240, z: -1080 },
  wake: { x: 480, y: terrainHeight(480, -640) + 210, z: -640 },
  turbine: { x: -520, y: terrainHeight(-520, -200) + 120, z: -200 },
  cable: { x: -280, y: terrainHeight(-280, 90) + 12, z: 90 },
  substation: { x: SUBSTATION.x - 150, y: terrainHeight(SUBSTATION.x - 150, SUBSTATION.z - 120) + 130, z: SUBSTATION.z - 120 },
  // 圈选：左下近景大机组（FARM[6] 附近）
  dot: { x: -610, y: terrainHeight(-610, -160) + 60, z: -160 },
}
