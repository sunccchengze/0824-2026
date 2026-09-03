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

// ---- 地形：海上风电场（大盆地海床 + 四周明显抬升的海岸山脉）----
// 第 29/30 轮重构（用户验收回访）：
//  · 海盆半径大幅扩大，全部 9 机与升压站均位于海中央，距海岸遥远；
//  · 海岸带陡升（陆地明显高于海平面），不再是 50-80m 的糊过渡；
//  · 海床只保留极低幅微地貌（±2m），贴地稳定、贴近真实海平台。
/** 海上风电场中心（海盆圆心；与场景布局场心一致） */
export const FARM_CENTER = { x: -100, z: -640 } as const

/**
 * 地面【实际渲染面】高度（第 30 轮重构）。
 * 直接等于连续地形 terrainHeight（连续海床，无台地量化台阶）。
 * 贴地基准与渲染面同源 —— 风机/升压站/电缆/星光全部贴它定位，零回归。
 */
export function terrainSurfaceY(x: number, z: number): number {
  return terrainHeight(x, z)
}

export function terrainHeight(x: number, z: number): number {
  // 到场心（海盆圆心）距离
  const d = Math.hypot(x - FARM_CENTER.x, z - FARM_CENTER.z)
  // 海床基准（低，贴近真实海平台）+ 极低幅微地貌（不是完全平面）
  const bed = (N.fbm(x * 0.0009, z * 0.0009, 3) - 0.5) * 4.0
  let h = 2.0 + bed
  // 海岸陡坡：d 从海缘(1750m)快速抬升到岸顶(~80m)，陆地明显高过海面
  const coast = smoothstep(1750, 2060, d)
  h += coast * 82
  // 内陆远山（地平线剪影带）：更远处更高，带噪声起伏
  const mtn = smoothstep(2150, 3200, d)
  h += mtn * (95 + 175 * N.ridged(x * 0.00042 + 3.1, z * 0.00042 - 1.4, 4))
  // 升压站局地再压平
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
