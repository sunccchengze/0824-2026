// ===== 世界真值源 R2 =====
// 地形高度场 / 机位 / 升压站 / 相机 / 标注锚点 —— 全场景唯一权威，禁止各自为政
// 依据 docs/research/mockups/styleD_user_ice_blue.png 逐区对版

// ---- 预置噪声（值噪声 + fbm + 脊线）----
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
  // 脊线噪声：锋利山脊
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

// ---- 地形：丘陵 + 谷地压平（场区/电缆走廊）+ 西北远山剪影 ----
export function terrainHeight(x: number, z: number): number {
  let h = N.ridged(x * 0.00052, z * 0.00052) * 95
    + N.fbm(x * 0.0016, z * 0.0016) * 30
    + N.fbm(x * 0.0065, z * 0.0065) * 4.5
    - 38
  // 中央场区谷地压平（椭圆：cx=0, cz=-290，半径≈820）
  const dF = Math.hypot(x / 1.06, (z + 290) / 0.94)
  h *= 1 - 0.85 * smoothstep(840, 320, dF)
  // 升压站局地再压平
  const dS = Math.hypot(x - SUBSTATION.x, z - SUBSTATION.z)
  h *= 1 - 0.9 * smoothstep(300, 120, dS)
  // 西侧山脊（画面左缘剪影，起坡外推避免遮挡中场）
  h += 130 * smoothstep(-850, -1950, x) * (0.5 + 0.5 * N.fbm(z * 0.0007, 3.3, 3))
  // 北侧远山（地平线剪影带）
  h += 150 * smoothstep(-750, -2600, z) * (0.45 + 0.55 * N.fbm(x * 0.0006, 7.7, 3))
  // 东侧远丘（右缘低剪影）
  h += 85 * smoothstep(1000, 2400, x) * (0.4 + 0.6 * N.fbm(z * 0.00072, 13.1, 3))
  return h
}

// ---- 场区布局：3×3，北排为首排（来流 NNW），间距≈5D×7D ----
export interface FarmUnit { id: string; x: number; z: number; row: number; col: number; speed: number }
export const FARM: FarmUnit[] = (() => {
  const arr: FarmUnit[] = []
  let k = 0
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x = (c - 1) * 380 + (((k * 53) % 5) - 2) * 12 - 30
      const z = -720 + r * 430 + (((k * 37) % 5) - 2) * 9
      arr.push({ id: `T0${k + 1}`, x, z, row: r, col: c, speed: 1.02 + ((k * 29) % 5) * 0.1 })
      k++
    }
  }
  return arr
})()
export const ROW_COUNT = 3

export const SUBSTATION = { x: 380, z: 330 }
// 集电外送方向（画面右下角的出束）
export const APPROACH = { x: 2050, z: 1350 }

// ---- 相机构图（对版基准图：天际线≈画面上缘 5%，近大远小强透视）----
export const CAM = {
  pos: [330, 540, 1300] as [number, number, number],
  target: [0, 50, -200] as [number, number, number],
  fov: 40,
}

// ---- 世界标注锚点（HUD 引线标签用；已按 CAM 透视逐点校准屏幕落位）----
export const ANCHOR = {
  power: { x: -1200, y: terrainHeight(-1200, -900) + 280, z: -900 },
  wake: { x: 350, y: terrainHeight(350, -800) + 180, z: -800 },
  turbine: { x: -560, y: terrainHeight(-560, -160) + 110, z: -160 },
  cable: { x: -420, y: terrainHeight(-420, -60) + 14, z: -60 },
  substation: { x: SUBSTATION.x - 80, y: terrainHeight(SUBSTATION.x - 80, SUBSTATION.z - 90) + 115, z: SUBSTATION.z - 90 },
}
