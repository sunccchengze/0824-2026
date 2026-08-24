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

/** NREL 5MW 叶片站位表：r(m) 弦长(m) 扭角(deg) 相对厚度 t/c */
const STATIONS: [number, number, number, number][] = [
  [2.87, 3.542, 13.308, 0.999],
  [5.60, 3.854, 13.308, 0.62],
  [8.33, 4.167, 13.308, 0.44],
  [11.75, 4.557, 13.308, 0.40],
  [15.85, 4.652, 11.480, 0.35],
  [19.95, 4.458, 10.162, 0.32],
  [24.05, 4.249, 9.011, 0.30],
  [28.15, 4.007, 7.795, 0.27],
  [32.25, 3.748, 6.544, 0.25],
  [36.35, 3.502, 5.361, 0.21],
  [40.45, 3.256, 4.188, 0.20],
  [44.55, 3.010, 3.125, 0.18],
  [48.65, 2.764, 2.319, 0.18],
  [52.75, 2.518, 1.526, 0.18],
  [56.85, 2.313, 0.863, 0.18],
  [59.00, 2.086, 0.370, 0.17],
  [60.50, 1.710, 0.106, 0.15],
  [61.50, 0.900, 0.000, 0.11],
]

// NACA 四位数厚度分布（尾缘近似闭合），叠加 64 系列弯度线 → DU/NACA64 家族外观
const PERIM = 26 // 周向采样（上下表面各 13）
function airfoilRing(chord: number, tc: number, ring: THREE.Vector3[]) {
  const t = Math.min(0.999, tc) * 0.5 // yt 公式中 t/2 → t/c
  const m = 0.045, p = 0.48
  for (let j = 0; j < PERIM; j++) {
    // j 0..12 上表面 TE→LE；j 13..25 下表面 LE→TE（避开端点重复）
    const upper = j <= PERIM / 2 - 1
    const k = upper ? j / (PERIM / 2 - 1) : (j - (PERIM / 2 - 1)) / (PERIM / 2 - 1)
    const x = upper ? 1 - k : k // 0..1
    const yc = x <= p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) * (1 - p))) * ((1 - 2 * p) + 2 * p * x - x * x)
    const yt = 5 * t * (0.2969 * Math.sqrt(Math.max(x, 1e-6)) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x)
    const cy = (upper ? yc + yt : yc - yt) * chord
    const cx = (x - 0.25) * chord + Math.sin(x * Math.PI) * 0.02 * chord // 桨距轴 0.25c，轻微后掠
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
  const rootMid = ring ? 0 : 0
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
  void rootMid
  return g
}

/** 回转体廓线工具（塔筒/导流罩/轮毂） */
function lathe(profile: [number, number][], seg = 40): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y))
  return new THREE.LatheGeometry(pts, seg)
}

export interface TurbineGeoSet {
  blade: THREE.BufferGeometry
  tower: THREE.BufferGeometry
  yawPlate: THREE.BufferGeometry
  nacelle: THREE.BufferGeometry
  nacelleTail: THREE.BufferGeometry
  yawFin: THREE.BufferGeometry
  spinner: THREE.BufferGeometry
  hub: THREE.BufferGeometry
  flange1: THREE.BufferGeometry
  flange2: THREE.BufferGeometry
  door: THREE.BufferGeometry
  fin: THREE.BufferGeometry
  anemo: THREE.BufferGeometry
  beacon: THREE.BufferGeometry
}

let cached: TurbineGeoSet | null = null
/** 9 机共享同一套几何（实例化外观差异由变换承担） */
export function getTurbineGeos(): TurbineGeoSet {
  if (cached) return cached
  cached = {
    blade: buildBladeGeometry(),
    // 塔筒：底部法兰环 → 87.6 m 线性锥缩 3.0→1.935（顶端直径 3.87 m）
    tower: lathe([
      [3.9, -0.6], [3.6, 0.0], [3.05, 0.35], [2.95, 3.5],
      [3.0 - (3.0 - 1.935) * 0.5, 43.8], [1.985, 84.5], [1.935, 87.6],
    ], 44),
    flange1: lathe([[3.35, -0.5], [3.5, -0.12], [3.5, 0.12], [3.2, 0.4]], 40),
    flange2: lathe([[2.2, 84.0], [2.22, 84.6], [2.06, 84.9]], 36),
    door: new RoundedBoxGeometry(1.6, 3.0, 0.5, 3, 0.2),
    yawPlate: new THREE.CylinderGeometry(2.7, 2.7, 0.9, 28),
    // 机舱：主体（圆角长方 4.4×4.8×13.6）+ 尾部小罩
    nacelle: new RoundedBoxGeometry(4.4, 4.8, 13.6, 4, 0.85),
    nacelleTail: new RoundedBoxGeometry(3.4, 3.2, 4.6, 3, 0.7),
    yawFin: new RoundedBoxGeometry(0.24, 1.5, 3.4, 2, 0.1),
    // 导流罩：球鼻锥 3.8 m
    spinner: lathe([
      [1.9, -1.4], [2.1, 0.4], [1.9, 1.6], [1.35, 2.7], [0.55, 3.55], [0.01, 3.95],
    ], 36),
    hub: new THREE.CylinderGeometry(1.55, 1.75, 2.6, 24, 1),
    fin: new RoundedBoxGeometry(0.16, 0.9, 1.6, 2, 0.07),
    anemo: new THREE.CylinderGeometry(0.05, 0.07, 1.5, 8),
    beacon: new THREE.SphereGeometry(0.28, 12, 12),
  }
  return cached
}

/** 机身 PBR 材质组（冰青夜色下的冷白机身 + 极地月光响应） */
export function getTurbineMats() {
  const sheath = new THREE.MeshPhysicalMaterial({
    color: '#eef3f8', roughness: 0.3, metalness: 0.05,
    clearcoat: 0.45, clearcoatRoughness: 0.28,
    emissive: '#0d3547', emissiveIntensity: 0.3, // 冰青夜场底色微融
    side: THREE.DoubleSide,
  })
  const body = new THREE.MeshPhysicalMaterial({
    color: '#e2e9ef', roughness: 0.38, metalness: 0.08,
    clearcoat: 0.3, clearcoatRoughness: 0.35,
    emissive: '#0a2e3e', emissiveIntensity: 0.26,
    side: THREE.DoubleSide,
  })
  const dark = new THREE.MeshPhysicalMaterial({ color: '#2c3640', roughness: 0.62, metalness: 0.3 })
  const beacon = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 1.9, 2.4), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  return { sheath, body, dark, beacon }
}

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
