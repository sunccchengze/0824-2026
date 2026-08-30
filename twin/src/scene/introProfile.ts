import * as THREE from 'three'

// ============================================================================
// 开场巡航速度剖面（第 24 轮：-SKILL- 仓库 GSAP Inertia 技能的原生移植）
// ----------------------------------------------------------------------------
// 技能来源：sunccchengze/-SKILL- @ arena/01a048e7-skill
//   skills/community/gsap-skills/skills/gsap-plugins/SKILL.md（Inertia / MotionPath 两节）
// 语义映射（本项目"不新增依赖"红线，gsap 为 DOM tween 库，three 相机不适用，
// 故按技能原则原生实现纯数学等价）：
//   · InertiaPlugin.track + inertia:"auto"  → track 速度、新目标速度经指数
//     滑行（临界阻尼）达成、松手滑行减速停止——CameraRig 的 coast/WASD 段；
//   · MotionPath（沿路径 + 切向对齐 + 变速）  → 本模块：曲率感知巡航速度
//     v ∝ 1/(1+κ^1.25)（直线加速 / 弯道减速）× 分段 boost 表（smoothstep
//     插值 C1 连续，频率更高、幅度更大：0.42×~1.75×）；
//   · 积分得 时间→弧长 映射表（总时长钉 34s，确定性、可 A/B、截图可复现）；
//   · bank = 侧向加速度模型 √ 映射（≤6.2°，克制）；fov 随速度 47→51.5。
// ============================================================================

export interface IntroSample {
  frac: number      // 弧长分数 0..1
  t: number         // 巡航段时间 (s)
  speed: number     // m/s
  signedK: number   // 带号曲率 1/m（+ = 右转弯）
  bank: number      // rad（相机绕视轴滚转）
  fov: number
}

const N = 2048

// 输入限幅到 [0,1]：曲率比值可 >1（比 90 分位更紧的尖角），
// 不限幅时 smoothstep 在 x>1 会变负 → 侧壁/尖角速度反而飙升（已修）
const smooth01 = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1)
  return t * t * (3 - 2 * t)
}

export interface IntroProfile {
  lookup: (t: number) => IntroSample
  vExit: number          // 巡航终点速度 m/s（收尾环绕接管用）
  exitTangent: THREE.Vector3
  vMin: number
  vMax: number
  stats: {
    len: number
    vMean: number
    totalTime: number
    rawDur: number
    scale: number
    vMin: number
    vMax: number
    turns: number        // 速度方向变化次数（加速↔减速切换）
    bankMaxDeg: number
    maxCurve: number     // 最大曲率 1/m
  }
}

/**
 * @param path      相机 CatmullRom 路径（与 CameraRig 同一条）
 * @param totalDur  巡航段总时长（s），速度表整体缩放到精确等于它
 * @param vCruise   基准巡航速度（m/s，boost=1 且 κ=0 处）
 * @param vMin/vMax 最终速度硬限幅（m/s）
 * @param boostPts  [弧长分数, 速度倍率] 控制点（x 升序）
 */
export function buildIntroProfile(
  path: THREE.CatmullRomCurve3,
  totalDur: number,
  vCruise: number,
  vMin: number,
  vMax: number,
  boostPts: ReadonlyArray<readonly [number, number]>,
): IntroProfile {
  const pos: THREE.Vector3[] = new Array(N)
  const tang: THREE.Vector3[] = new Array(N)
  for (let i = 0; i < N; i++) pos[i] = path.getPointAt(i / (N - 1))
  for (let i = 0; i < N; i++) {
    const a = path.getPointAt(Math.max(0, (i - 1) / (N - 1)))
    const b = path.getPointAt(Math.min(1, (i + 1) / (N - 1)))
    tang[i] = b.sub(a).normalize()
  }
  const segLen: number[] = new Array(N)
  let len = 0
  for (let i = 0; i < N - 1; i++) { segLen[i] = pos[i].distanceTo(pos[i + 1]); len += segLen[i] }
  segLen[N - 1] = 0

  // dT/ds（带号侧向分量：右 = up × T 点积 → 右正）
  const up = new THREE.Vector3(0, 1, 0)
  const right = new THREE.Vector3()
  const signedK: number[] = new Array(N)
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 4)
    const b = Math.min(N - 1, i + 4)
    const ds = Math.max(((b - a) / (N - 1)) * len, 1e-6)
    const dT = tang[b].clone().sub(tang[a]).divideScalar(ds)
    right.crossVectors(tang[i], up)
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
    right.normalize()
    signedK[i] = dT.dot(right)
  }

  // boost 控制点 smoothstep 插值（C1）
  const boostAt = (f: number): number => {
    if (f <= boostPts[0][0]) return boostPts[0][1]
    for (let j = 0; j < boostPts.length - 1; j++) {
      const [f0, m0] = boostPts[j]
      const [f1, m1] = boostPts[j + 1]
      if (f <= f1) return m0 + (m1 - m0) * smooth01((f - f0) / (f1 - f0))
    }
    return boostPts[boostPts.length - 1][1]
  }

  // 原始速度 = 巡航 × 曲率温和调制 × boost，限幅。
  // 曲率先做 25 样本盒式平滑（抹掉节点尖角 1/19m 级别的采样尖峰，
  // 保留"这段转得紧不紧"的感知曲率），再按 90 分位归一——
  // 乘性调制 0.65~1.0（直线走满巡航，最紧段 −35%），避免除法式方波。
  const kAbs: number[] = new Array(N)
  let maxCurve = 0
  for (let i = 0; i < N; i++) {
    kAbs[i] = Math.abs(signedK[i])
    if (kAbs[i] > maxCurve) maxCurve = kAbs[i]
  }
  const kSm = new Array(N)
  const HW = 12
  for (let i = 0; i < N; i++) {
    let s = 0
    let n = 0
    for (let j = i - HW; j <= i + HW; j++) {
      if (j < 0 || j >= N) continue
      s += kAbs[j]
      n++
    }
    kSm[i] = s / n
  }
  const kSorted = [...kSm].sort((x, y) => x - y)
  const kRef = Math.max(kSorted[Math.floor(N * 0.9)], 1e-6)
  const vRaw: number[] = new Array(N)
  for (let i = 0; i < N; i++) {
    const curvFactor = 0.65 + 0.35 * (1 - smooth01(kSm[i] / kRef))
    vRaw[i] = THREE.MathUtils.clamp(vCruise * curvFactor * boostAt(i / (N - 1)), vMin, vMax)
  }

  // 缩放到精确总时长（rawDur 越大 = 原速越慢 → 乘子越大以提速）
  let rawDur = 0
  for (let i = 0; i < N - 1; i++) rawDur += segLen[i] / ((vRaw[i] + vRaw[i + 1]) * 0.5)
  const scale = rawDur / totalDur
  const v: number[] = new Array(N)
  for (let i = 0; i < N; i++) v[i] = vRaw[i] * scale

  const tAt: number[] = new Array(N)
  tAt[0] = 0
  for (let i = 0; i < N - 1; i++) tAt[i + 1] = tAt[i] + segLen[i] / ((v[i] + v[i + 1]) * 0.5)

  let vLo = v[0]
  let vHi = v[0]
  for (let i = 1; i < N; i++) {
    if (v[i] < vLo) vLo = v[i]
    if (v[i] > vHi) vHi = v[i]
  }
  const span = Math.max(vHi - vLo, 1e-3)

  // bank：侧向加速度 a=κv² → √ 映射 → ≤0.108 rad (6.2°)
  const bank: number[] = new Array(N)
  let bankMax = 0
  for (let i = 0; i < N; i++) {
    const aLat = Math.abs(signedK[i]) * v[i] * v[i]
    bank[i] = Math.sign(signedK[i]) * 0.108 * Math.sqrt(THREE.MathUtils.clamp((aLat - 1.5) / 50, 0, 1))
    const d = Math.abs(bank[i]) * 57.2958
    if (d > bankMax) bankMax = d
  }

  // 速度方向变化计数（加速↔减速切换）
  let turns = 0
  let prev = 0
  for (let i = 1; i < N; i++) {
    const d = v[i] - v[i - 1]
    if (Math.abs(d) > 0.35) {
      const s = d > 0 ? 1 : -1
      if (prev !== 0 && s !== prev) turns++
      prev = s
    }
  }

  const lookup = (t: number): IntroSample => {
    if (t <= 0) {
      return { frac: 0, t: 0, speed: v[0], signedK: signedK[0], bank: bank[0], fov: 47 }
    }
    if (t >= tAt[N - 1]) {
      return {
        frac: 1, t: totalDur, speed: v[N - 1], signedK: signedK[N - 1],
        bank: bank[N - 1], fov: 47 + 4.5 * smooth01((v[N - 1] - vLo) / span),
      }
    }
    // 二分找区间
    let lo = 0, hi = N - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (tAt[mid] <= t) lo = mid
      else hi = mid
    }
    const f = (t - tAt[lo]) / Math.max(tAt[hi] - tAt[lo], 1e-6)
    const lerp = (a: number, b: number) => a + (b - a) * f
    return {
      frac: lerp(lo / (N - 1), hi / (N - 1)),
      t,
      speed: lerp(v[lo], v[hi]),
      signedK: lerp(signedK[lo], signedK[hi]),
      bank: lerp(bank[lo], bank[hi]),
      fov: 47 + 4.5 * smooth01((lerp(v[lo], v[hi]) - vLo) / span),
    }
  }

  return {
    lookup,
    vExit: v[N - 1],
    exitTangent: tang[N - 1].clone(),
    vMin: vLo,
    vMax: vHi,
    stats: {
      len,
      vMean: len / totalDur,
      totalTime: tAt[N - 1],
      rawDur,
      scale,
      vMin: vLo,
      vMax: vHi,
      turns,
      bankMaxDeg: bankMax,
      maxCurve,
    },
  }
}

/** 巡航段 boost 表：直线加速 / 弯道减速，13 段变速（~2.6s 一次转向），倍率 0.55~1.50
 *  与曲率温和调制(0.65~1.0)相乘后，峰谷比 ≈ 4.2×，节奏快、幅度大、C1 连续 */
export const BOOST_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0.00, 0.55],  // 高空起始：沉稳
  [0.06, 0.85],  // 垂直俯冲（直线）提速
  [0.13, 1.25],  // 冲底加速
  [0.20, 0.62],  // 低位转向（弯道减速）
  [0.28, 1.00],  // 低空后掠
  [0.36, 0.55],  // 抬头入远景（减速）
  [0.45, 1.40],  // 全景大直线拉出（大 boost）
  [0.53, 1.50],  // 直推 T03 全速（峰值）
  [0.60, 0.58],  // T03 转头（弯道减速）
  [0.68, 1.25],  // 对角线穿场
  [0.76, 0.58],  // 转向 T07（减速）
  [0.85, 1.05],  // 接近段
  [0.93, 0.60],  // 终点前减速
  [1.00, 0.55],  // 交棒收尾环绕（近悬停）
]
