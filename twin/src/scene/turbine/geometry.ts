import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// ============================================================
// AEOLUS-5MW 参数化几何 —— 依 NREL 5MW 参考机组公开数据建模
// 数据源：
//   [1] Jonkman et al. 2009, NREL/TP-500-38060（塔筒/机舱/轮毂/转速）
//   [2] Berg & Resor 2012, SAND2012-4041 / OSTI 1095962（叶片 18 站位）
// 本轮按 docs/07 §二 的 B 类逐条修正：
//   B2 站位表：58.90（原误 59.00）、叶尖弦长 1.419 m
//   B3 塔基直径：y=0 处 r=3.0 m（6.0 m 铭牌直径），仅过渡段略放大
//   B4 删除无依据"后掠"与机舱鳍片（NREL 5MW 均不存在）
//   B5 死代码清除
//   B6 周向采样 26 → 34，近景剖面不再呈十三边形
// 2026-08-28（任务#3）：站位表整体替换为 SAND2013-2569（OSTI 1095962）
// Table 2 全部 17 站位原值 + Table 1 对应翼型相对厚度（含叶根 r<10.15 m
// 圆柱段 t/c=1.0）——不再是估计值。
// 诚实边界：截面形状仍为"NACA 四位数厚度 + 线性降弯度"的解析近似
// （Table 1 只给厚度/扭角/弦长，不公布逐点坐标；且原始设计报告自述为
// "intentionally crude" 概念级模型）——属【示意几何】，只用于可视化，
// 禁止作为气动/结构计算输入。
// ============================================================

/**
 * NREL 5MW 叶片站位表（SAND2013-2569 Table 2/3 + Table 1，17 站位）：
 * [r(m), 弦长(m), 气动扭角(deg), 相对厚度 t/c]。
 * 翼型序列：Cylinder100%(×2) → DU40_A17(40.5%) → DU35(35.09%) →
 * DU30(30%) → DU25_A17(25%) → DU21(21%) → NACA64_A17(18%) 至叶尖。
 */
export const STATIONS: [number, number, number, number][] = [
  [2.8667, 3.542, 13.308, 1.0],   // 叶根圆柱（Table1 ID1）
  [5.6, 3.854, 13.308, 1.0],      // 圆柱（ID2；DOWEC 圆柱段 1.8/5.98m）
  [8.3333, 4.167, 13.308, 1.0],   // 圆柱（DU40 从 r=10.15 才开始）
  [11.75, 4.557, 13.308, 0.405],  // DU40_A17
  [15.85, 4.652, 11.48, 0.3509],  // DU35 附近（ID4）
  [19.95, 4.458, 10.162, 0.3509],
  [24.05, 4.249, 9.011, 0.30],    // DU30
  [28.15, 4.007, 7.795, 0.25],    // DU25_A17
  [32.25, 3.748, 6.544, 0.25],
  [36.35, 3.502, 5.361, 0.21],    // DU21
  [40.45, 3.256, 4.188, 0.21],
  [44.55, 3.01, 3.125, 0.18],     // NACA64_A17
  [48.65, 2.764, 2.319, 0.18],
  [52.75, 2.518, 1.526, 0.18],
  [56.1667, 2.313, 0.863, 0.18],
  [58.9, 2.086, 0.37, 0.18],
  [61.6333, 1.419, 0.106, 0.18],  // 叶尖（61.5 m 为结构名义长，尖缘后掠在翼型内）
]

export const PERIM = 34 // 周向采样（上/下表面各 17）—— HoloTurbine 的肋线与此同步
const N_HALF = PERIM / 2

/**
 * 翼型环：NACA 四位数厚度分布 + 沿展向递减的弯度中线。
 * 根段 tc→1.0 自然退化为圆（叶根圆柱段的几何表达）。
 */
function airfoilRing(chord: number, tc: number, camber: number, ring: THREE.Vector3[]) {
  if (tc >= 0.999) {
    // 叶根圆柱段（Table 1 ID 1-2 "Cylinder"）：真圆环，直径 = 弦长
    const R = chord / 2
    for (let j = 0; j < PERIM; j++) {
      const a = (j / PERIM) * Math.PI * 2
      ring[j] = new THREE.Vector3(Math.cos(a) * R - 0.25 * chord, Math.sin(a) * R, 0)
    }
    return
  }
  const t = tc * 0.5
  const m = camber
  const p = 0.42
  for (let j = 0; j < PERIM; j++) {
    const upper = j < N_HALF
    const k = upper ? j / (N_HALF - 1) : (j - N_HALF) / (N_HALF - 1)
    const x = upper ? 1 - k : k
    const yc = x <= p
      ? (m / (p * p)) * (2 * p * x - x * x)
      : (m / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * x - x * x)
    const yt = 5 * t * (0.2969 * Math.sqrt(Math.max(x, 1e-6)) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4)
    const cy = (upper ? yc + yt : yc - yt) * chord
    const cx = (x - 0.25) * chord // 桨距轴 0.25c；B4：无后掠
    ring[j] = new THREE.Vector3(cx, cy, 0)
  }
}

/** 叶片蒙皮放样（18 站位 × PERIM 周向），索引化 BufferGeometry */
function buildBladeGeometry(): THREE.BufferGeometry {
  const NS = STATIONS.length
  const vertCount = NS * PERIM + 2 // + 根盖心/尖盖心
  const pos = new Float32Array(vertCount * 3)
  const idx: number[] = []

  const ring = new Array<THREE.Vector3>(PERIM)
  for (let s = 0; s < NS; s++) {
    const [r, chord, twist, tc] = STATIONS[s]
    // B1 口径：弯度沿展向从 0.05（DU 厚根段量级）递减到 0.015（尾部近对称）
    const camber = 0.05 + (0.015 - 0.05) * (s / (NS - 1))
    airfoilRing(chord, tc, camber, ring)
    const a = THREE.MathUtils.degToRad(twist)
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    for (let j = 0; j < PERIM; j++) {
      const v = ring[j]
      const o = (s * PERIM + j) * 3
      pos[o] = v.x * ca - v.y * sa
      pos[o + 1] = r
      pos[o + 2] = v.x * sa + v.y * ca
    }
  }
  for (let s = 0; s < NS - 1; s++) {
    for (let j = 0; j < PERIM; j++) {
      const a = s * PERIM + j
      const b = s * PERIM + ((j + 1) % PERIM)
      const c = (s + 1) * PERIM + j
      const d = (s + 1) * PERIM + ((j + 1) % PERIM)
      idx.push(a, c, b, b, c, d)
    }
  }
  const rootC = NS * PERIM
  const tipC = NS * PERIM + 1
  pos[rootC * 3] = 0; pos[rootC * 3 + 1] = STATIONS[0][0] - 1.1; pos[rootC * 3 + 2] = 0
  pos[tipC * 3] = 0; pos[tipC * 3 + 1] = STATIONS[NS - 1][0] + 0.5; pos[tipC * 3 + 2] = 0
  for (let j = 0; j < PERIM; j++) {
    const n = (j + 1) % PERIM
    idx.push(rootC, n, j)
    idx.push(tipC, (NS - 1) * PERIM + j, (NS - 1) * PERIM + n)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * 塔筒中面廓线 [半径 r, 高度 y]（B3 修正：y=0 处 r=3.0 m ⇒ 底径 6.0 m 铭牌值；
 * 0 以下仅是基础过渡段，轻微放大属构造表达）。
 * 顶部 y=87.6 m，r=1.935 m ⇒ 顶径 3.87 m [1]。
 * 此表同时是 HoloTurbine 肋线环的唯一数据源（避免注释与数据两张皮）。
 */
export const TOWER_PROFILE: [number, number][] = [
  [3.35, -0.6], // 基础过渡段（略放大，表达灌浆连接段）
  [3.0, 0.0],
  [2.95, 3.5],
  [2.46, 43.8], // 线性锥缩中点 (3.0+1.935)/2
  [1.985, 84.5],
  [1.935, 87.6],
]

/** 任意高度塔筒半径（供肋线/电缆接入点使用） */
export function towerRadiusAtY(y: number): number {
  const P = TOWER_PROFILE
  for (let i = 0; i < P.length - 1; i++) {
    const [r0, y0] = P[i]
    const [r1, y1] = P[i + 1]
    if (y <= y1) {
      const t = (y - y0) / (y1 - y0)
      return r0 + (r1 - r0) * Math.max(0, Math.min(1, t))
    }
  }
  return P[P.length - 1][0]
}

function lathe(profile: [number, number][], seg = 44): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y))
  return new THREE.LatheGeometry(pts, seg)
}

export interface TurbineGeoSet {
  blade: THREE.BufferGeometry
  tower: THREE.BufferGeometry
  yawPlate: THREE.BufferGeometry
  nacelle: THREE.BufferGeometry
  nacelleTail: THREE.BufferGeometry
  spinner: THREE.BufferGeometry
  hub: THREE.BufferGeometry
  flange1: THREE.BufferGeometry
  door: THREE.BufferGeometry
  anemo: THREE.BufferGeometry
  beacon: THREE.BufferGeometry
}

let cached: TurbineGeoSet | null = null
/** 9 机共享同一套几何（部件合并与实例化的基础） */
export function getTurbineGeos(): TurbineGeoSet {
  if (cached) return cached
  cached = {
    blade: buildBladeGeometry(),
    tower: lathe(TOWER_PROFILE, 44),
    // 底部法兰环（灌浆段顶）
    flange1: lathe([[3.32, -0.62], [3.46, -0.34], [3.46, -0.12], [3.12, 0.16]], 40),
    door: new RoundedBoxGeometry(1.6, 3.0, 0.5, 3, 0.2),
    yawPlate: new THREE.CylinderGeometry(2.7, 2.7, 0.9, 28),
    nacelle: new RoundedBoxGeometry(4.4, 4.8, 13.6, 4, 0.85),
    nacelleTail: new RoundedBoxGeometry(3.4, 3.2, 4.6, 3, 0.7),
    spinner: lathe([[1.9, -1.4], [2.1, 0.4], [1.9, 1.6], [1.35, 2.7], [0.55, 3.55], [0.01, 3.95]], 36),
    hub: new THREE.CylinderGeometry(1.55, 1.75, 2.6, 24, 1),
    // 风速风向仪：立杆 + 三杯臂（B10：不再是光杆）
    anemo: (() => {
      const parts: THREE.BufferGeometry[] = []
      const pole = new THREE.CylinderGeometry(0.05, 0.07, 1.5, 8)
      parts.push(pole)
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3
        const arm = new THREE.CylinderGeometry(0.02, 0.02, 0.34, 6)
        arm.rotateZ(Math.PI / 2)
        arm.rotateY(a)
        arm.translate(Math.cos(a) * 0.17, 0.75, Math.sin(a) * 0.17)
        parts.push(arm)
        const cup = new THREE.SphereGeometry(0.06, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2)
        cup.translate(Math.cos(a) * 0.34, 0.78, Math.sin(a) * 0.34)
        parts.push(cup)
      }
      return mergeSimple(parts)
    })(),
    beacon: new THREE.SphereGeometry(0.28, 12, 12),
  }
  return cached
}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0
  const nonIndexed = geos.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g
    count += ng.getAttribute('position').count
    return ng
  })
  const pos = new Float32Array(count * 3)
  const nrm = new Float32Array(count * 3)
  let o = 0
  for (const g of nonIndexed) {
    const p = g.getAttribute('position')
    const n = g.getAttribute('normal')
    for (let i = 0; i < p.count; i++) {
      pos[(o + i) * 3] = p.getX(i); pos[(o + i) * 3 + 1] = p.getY(i); pos[(o + i) * 3 + 2] = p.getZ(i)
      if (n) { nrm[(o + i) * 3] = n.getX(i); nrm[(o + i) * 3 + 1] = n.getY(i); nrm[(o + i) * 3 + 2] = n.getZ(i) }
    }
    o += p.count
    g.dispose()
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  return g
}

/**
 * 材质统一在 HoloTurbine.tsx 生成：几何文件只负责真实比例，避免
 * 白色 PBR 皮肤重新进入渲染链；9 机全部保持纯白全息线稿。
 */
export const TURBINE_SPEC = {
  hubY: 90.0,       // 轮毂高 90 m [1]
  towerTop: 87.6,
  nacelleZ: 1.8,    // 机舱重心后移
  rotorFwd: 4.9,    // 转面前伸（5 m 悬伸）
  tiltDeg: 5.0,     // 转轴上仰 5°
  coneDeg: 2.5,     // 预锥角
  bladeLen: 61.5,
  rotorD: 126,
  ratedRpm: 12.1,   // [1] 铭牌转速（HUD/物理层共用口径）
}
