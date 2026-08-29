import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// ============================================================
// AEOLUS-5MW 参数化超真实风机 —— 依 NREL 5MW 参考机组公开数据建模
// 数据源：Jonkman et al. 2009《Definition of a 5-MW Reference Wind
// Turbine for Offshore System Development》(NREL/TP-500-38060)
// 及 Berg & Resor 2012 NuMAD 叶片结构概念（OSTI 1095962）：
// 叶片 61.5 m、弦长/扭角 18 站位分布、塔筒 87.6 m/6.0→3.87 m 锥缩、
// 轮毂高 90 m、机舱前伸 5 m、转轴上仰 5°、预锥角 2.5°。
// ============================================================

/** NREL 5MW 叶片站位表：r(m) 弦长(m) 扭角(deg) 相对厚度 t/c
 *  B2 修正：站位 58.90（原误写 59.00）、叶尖弦长 1.417（原 0.900）；
 *  厚度按官方翼型族阶梯分布：缸段→DU40→DU35→DU30→DU25→DU21→NACA64-618，
 *  叶尖保持 18%（原为 11%，与 NACA64-618 不符）。 */
const STATIONS: [number, number, number, number][] = [
  [2.87, 3.542, 13.308, 0.999],
  [5.60, 3.854, 13.308, 0.5],
  [8.33, 4.167, 13.308, 0.4],
  [11.75, 4.557, 13.308, 0.4],
  [15.85, 4.652, 11.480, 0.35],
  [19.95, 4.458, 10.162, 0.35],
  [24.05, 4.249, 9.011, 0.3],
  [28.15, 4.007, 7.795, 0.25],
  [32.25, 3.748, 6.544, 0.25],
  [36.35, 3.502, 5.361, 0.21],
  [40.45, 3.256, 4.188, 0.21],
  [44.55, 3.010, 3.125, 0.18],
  [48.65, 2.764, 2.319, 0.18],
  [52.75, 2.518, 1.526, 0.18],
  [56.85, 2.313, 0.863, 0.18],
  [58.90, 2.086, 0.370, 0.18],
  [60.50, 1.710, 0.106, 0.18],
  [61.50, 1.417, 0.000, 0.18],
]

// NACA 四位数厚度分布（尾缘近似闭合），叠加 64 系列弯度线 → DU/NACA64 家族外观
// B6 修正：周向采样 26 → 40（上下表面各 20），近景截面不再是十三边形折线
export const PERIM = 40
function airfoilRing(chord: number, tc: number, ring: THREE.Vector3[]) {
  const t = Math.min(0.999, tc) * 0.5 // yt 公式中 t/2 → t/c
  const m = 0.045, p = 0.48
  for (let j = 0; j < PERIM; j++) {
    // j 0..19 上表面 TE→LE；j 20..39 下表面 LE→TE（避开端点重复）
    const upper = j <= PERIM / 2 - 1
    const k = upper ? j / (PERIM / 2 - 1) : (j - (PERIM / 2 - 1)) / (PERIM / 2 - 1)
    const x = upper ? 1 - k : k // 0..1
    const yc = x <= p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) * (1 - p))) * ((1 - 2 * p) + 2 * p * x - x * x)
    const yt = 5 * t * (0.2969 * Math.sqrt(Math.max(x, 1e-6)) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x)
    const cy = (upper ? yc + yt : yc - yt) * chord
    // B4 修正：删除凭空叠加的正弦“后掠”（NREL 5MW 叶片无后掠），桨距轴 0.25c
    const cx = (x - 0.25) * chord
    ring[j] = new THREE.Vector3(cx, cy, 0)
  }
}

/** 叶片蒙皮放样（18 站位 × 26 周向），返回索引化 BufferGeometry */
function buildBladeGeometry(): THREE.BufferGeometry {
  const NS = STATIONS.length
  const vertCount = NS * PERIM + 2 // + 根盖心/尖盖心
  const pos = new Float32Array(vertCount * 3)
  const idx: number[] = []

  const ring = new Array<THREE.Vector3>(PERIM)
  for (let s = 0; s < NS; s++) {
    const [r, chord, twist, tc] = STATIONS[s]
    airfoilRing(chord, tc, ring)
    const a = THREE.MathUtils.degToRad(twist) // 展向扭转（桨距轴=y）
    const ca = Math.cos(a), sa = Math.sin(a)
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
  // 根盖 & 尖盖（扇面）
  const rootC = NS * PERIM, tipC = NS * PERIM + 1
  pos[rootC * 3] = 0; pos[rootC * 3 + 1] = STATIONS[0][0]; pos[rootC * 3 + 2] = 0
  pos[tipC * 3] = 0; pos[tipC * 3 + 1] = STATIONS[NS - 1][0] + 0.6; pos[tipC * 3 + 2] = 0
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

/** 回转体廓线工具（塔筒/导流罩/轮毂） */
function lathe(profile: [number, number][], seg = 40): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y))
  return new THREE.LatheGeometry(pts, seg)
}

// B4 修正：移除凭空“机舱顶鳍片 yawFin / 散热翅 fin”（真实 5MW 机舱无此特征）
export interface TurbineGeoSet {
  blade: THREE.BufferGeometry
  tower: THREE.BufferGeometry
  yawPlate: THREE.BufferGeometry
  nacelle: THREE.BufferGeometry
  nacelleTail: THREE.BufferGeometry
  spinner: THREE.BufferGeometry
  hub: THREE.BufferGeometry
  flange1: THREE.BufferGeometry
  flange2: THREE.BufferGeometry
  door: THREE.BufferGeometry
  anemo: THREE.BufferGeometry
  beacon: THREE.BufferGeometry
}

let cached: TurbineGeoSet | null = null
/** 9 机共享同一套几何（实例化外观差异由变换承担） */
export function getTurbineGeos(): TurbineGeoSet {
  if (cached) return cached
  cached = {
    blade: buildBladeGeometry(),
    // 塔筒：B3 修正 —— 底径 6.0 m（原放样 7.2~7.8 m，超规格 20%），
    // 87.6 m 线性锥缩 3.0→1.935 m（顶端直径 3.87 m，官方值）
    tower: lathe([
      [3.0, -0.6], [3.0, 0.0], [2.98, 0.8], [2.92, 3.5],
      [2.4675, 43.8], [1.99, 84.5], [1.935, 87.6],
    ], 44),
    flange1: lathe([[3.16, -0.5], [3.3, -0.12], [3.3, 0.12], [3.02, 0.4]], 40),
    flange2: lathe([[2.2, 84.0], [2.22, 84.6], [2.06, 84.9]], 36),
    door: new RoundedBoxGeometry(1.6, 3.0, 0.5, 3, 0.2),
    yawPlate: new THREE.CylinderGeometry(2.7, 2.7, 0.9, 28),
    // 机舱：主体（圆角长方 4.4×4.8×13.6）+ 尾部小罩
    nacelle: new RoundedBoxGeometry(4.4, 4.8, 13.6, 4, 0.85),
    nacelleTail: new RoundedBoxGeometry(3.4, 3.2, 4.6, 3, 0.7),
    // 导流罩：球鼻锥 3.8 m
    spinner: lathe([
      [1.9, -1.4], [2.1, 0.4], [1.9, 1.6], [1.35, 2.7], [0.55, 3.55], [0.01, 3.95],
    ], 36),
    hub: new THREE.CylinderGeometry(1.55, 1.75, 2.6, 24, 1),
    anemo: new THREE.CylinderGeometry(0.05, 0.07, 1.5, 12),
    beacon: new THREE.SphereGeometry(0.42, 14, 14),
  }
  return cached
}

/**
 * 材质已统一在 HoloTurbine.tsx 中生成：几何文件只负责真实比例，避免
 * 白色 PBR 皮肤重新进入渲染链，所有 9 台机组都保持透明冰青线条化。
 */
export const TURBINE_SPEC = {
  hubY: 90.0,       // 轮毂高 90 m
  towerTop: 87.6,
  nacelleZ: 1.8,    // 机舱重心后移
  rotorFwd: 4.9,    // 转面前伸（5 m 悬伸）
  tiltDeg: 5.0,     // 转轴上仰 5°
  coneDeg: 2.5,     // 预锥角
  bladeLen: 61.5,
  rotorD: 126,
}
