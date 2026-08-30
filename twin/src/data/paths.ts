import * as THREE from 'three'

// ================================================================
// 贴地路径工具（CableNetwork / WindVeil 共用）
// ----------------------------------------------------------------
// 评审 D3：旧版每帧调用 curve.getPoint/getPointAt（2564+99 次/帧）。
// 这里在构建期把样条离散为**等弧长折线表**，运行期只做 O(1) 索引 +
// 线性插值；粒子/脉冲动画从"每帧万次曲线求值"降为"每帧万次加减乘"。
// ================================================================

export class HugPath {
  /** 顶点 xyz 打包 */
  readonly pts: Float32Array
  /** 总弧长 */
  readonly total: number
  private readonly step: number

  constructor(pts: Float32Array, total: number) {
    this.pts = pts
    this.total = total
    this.step = total / (pts.length / 3 - 1)
  }

  count(): number {
    return this.pts.length / 3
  }

  /** s ∈ [0, total] 弧长位置 → 目标数组（x,y,z） */
  sample(s: number, out: Float32Array | number[]): void {
    const t = Math.max(0, Math.min(this.total, s))
    const f = t / this.step
    const i = Math.min(this.count() - 2, Math.floor(f))
    const k = f - i
    const a = i * 3
    const b = a + 3
    const p = this.pts
    out[0] = p[a] + (p[b] - p[a]) * k
    out[1] = p[a + 1] + (p[b + 1] - p[a + 1]) * k
    out[2] = p[a + 2] + (p[b + 2] - p[a + 2]) * k
  }

  /** 归一化参数 t01 → 弧长近似（供 LineGeometry 重建等场景） */
  pointAt(t01: number, out: THREE.Vector3): THREE.Vector3 {
    const buf = HugPath.tmp
    this.sample(t01 * this.total, buf)
    out.set(buf[0], buf[1], buf[2])
    return out
  }

  private static tmp = new Float32Array(3)
}

/**
 * 由任意 THREE.Curve 构建等弧长折线表（空间流线用；不做地形贴合）。
 */
export function buildPathFromCurve(curve: THREE.Curve<THREE.Vector3>, n = 256): HugPath {
  const raw: THREE.Vector3[] = []
  for (let i = 0; i < n; i++) raw.push(curve.getPoint(i / (n - 1), new THREE.Vector3()))
  const cum = new Float64Array(n)
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + raw[i].distanceTo(raw[i - 1])
  const total = cum[n - 1]
  const pts = new Float32Array(n * 3)
  let j = 1
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * total
    while (j < n - 1 && cum[j] < s) j++
    const k = (s - cum[j - 1]) / Math.max(1e-6, cum[j] - cum[j - 1])
    pts[i * 3] = raw[j - 1].x + (raw[j].x - raw[j - 1].x) * k
    pts[i * 3 + 1] = raw[j - 1].y + (raw[j].y - raw[j - 1].y) * k
    pts[i * 3 + 2] = raw[j - 1].z + (raw[j].z - raw[j - 1].z) * k
  }
  return new HugPath(pts, total)
}

/**
 * 采样器：给定世界路径点（x,z），贴地采样为等弧长 HugPath。
 * lift 为"示意悬高"（真实直埋电缆在 0.8m 以下，地面不可见；可视化层
 * 抬 2.6m 属【示意】口径，登记于 docs/08 A8）。
 */
export function buildHugPath(
  plan: [number, number][],
  lift: (x: number, z: number) => number,
  samplesPerMeter = 1 / 6,
): { path: HugPath; curvePts: number[] } {
  const ctrl = plan.map(([x, z]) => new THREE.Vector3(x, 0, z))
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.35)
  const len = curve.getLength()
  const n = Math.max(24, Math.min(720, Math.ceil(len * samplesPerMeter) + 1))
  const v = new THREE.Vector3()
  const px: number[] = []
  const pz: number[] = []
  for (let i = 0; i < n; i++) {
    curve.getPoint(i / (n - 1), v)
    px.push(v.x)
    pz.push(v.z)
  }
  // 二次贴合地形 + 等弧长重采样
  let acc = 0
  const raw: number[][] = []
  for (let i = 0; i < n; i++) {
    const x = px[i]
    const z = pz[i]
    const y = lift(x, z)
    raw.push([x, y, z])
    if (i > 0) acc += Math.hypot(x - raw[i - 1][0], y - raw[i - 1][1], z - raw[i - 1][2])
  }
  // 用累积长度均分重采样
  const cum = new Float64Array(n)
  cum[0] = 0
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1], raw[i][2] - raw[i - 1][2])
  const m = n
  const out = new Float32Array(m * 3)
  let j = 1
  for (let i = 0; i < m; i++) {
    const s = (i / (m - 1)) * acc
    while (j < n - 1 && cum[j] < s) j++
    const k = (s - cum[j - 1]) / Math.max(1e-6, cum[j] - cum[j - 1])
    out[i * 3] = raw[j - 1][0] + (raw[j][0] - raw[j - 1][0]) * k
    out[i * 3 + 1] = raw[j - 1][1] + (raw[j][1] - raw[j - 1][1]) * k
    out[i * 3 + 2] = raw[j - 1][2] + (raw[j][2] - raw[j - 1][2]) * k
  }
  // LineGeometry 用的扁平数组
  const curvePts: number[] = []
  for (let i = 0; i < m; i++) curvePts.push(out[i * 3], out[i * 3 + 1], out[i * 3 + 2])
  return { path: new HugPath(out, acc), curvePts }
}
