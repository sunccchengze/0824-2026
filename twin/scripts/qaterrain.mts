// ================================================================
// 第 32 轮地形 QA：把「真实海岸线/陆上细节」诉求量化为可执行指标
// 运行：node --experimental-strip-types scripts/qaterrain.mts
// ================================================================
import {
  FARM, SUBSTATION, FARM_CENTER,
  terrainHeight, terrainSurfaceY, landMask, wobN, wobW,
} from '../src/scene/terrainUtil.ts'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}
const CN0 = 2050
const CW0 = 1700

console.log('== terrain32 QA ==')

// ---------- 1. 机组/升压站距陆地净距 ----------
{
  const probe = (px: number, pz: number) => {
    let best = Infinity
    for (let a = 0; a < 72; a++) {
      const ang = (a / 72) * Math.PI * 2
      const dx = Math.cos(ang), dz = Math.sin(ang)
      for (let r = 20; r <= 5200; r += 20) {
        if (landMask(px + dx * r, pz + dz * r) >= 0.02) { best = Math.min(best, r); break }
      }
    }
    return best
  }
  let minG = Infinity
  for (const u of FARM) minG = Math.min(minG, probe(u.x, u.z))
  const sG = probe(SUBSTATION.x, SUBSTATION.z)
  ok('机组净距：9 机到陆地 ≥600m', minG >= 600, `min=${minG.toFixed(0)}m`)
  ok('升压站净距：到陆地 ≥800m', sG >= 800, `s=${sG.toFixed(0)}m`)
}

// ---------- 2. 机组海域高度（≤12m 贴海） ----------
{
  let seaOK = true
  for (const u of FARM) if (terrainSurfaceY(u.x, u.z) > 12) seaOK = false
  ok('风机区为海床：机位 ≤12m', seaOK)
}

// ---------- 3. 老验收：北/西陆地 @2300m ≥30m；南/东保持海床 ----------
{
  let coastOK = true
  for (const dir of [[0, -1] as const, [-1, 0] as const]) {
    const h = terrainHeight(FARM_CENTER.x + dir[0] * 2300, FARM_CENTER.z + dir[1] * 2300)
    if (h < 30) coastOK = false
  }
  ok('内陆 2300m ≥30m（北/西）', coastOK)
  let openOK = true
  for (const dir of [[0, 1] as const, [1, 0] as const]) {
    const h = terrainHeight(FARM_CENTER.x + dir[0] * 2300, FARM_CENTER.z + dir[1] * 2300)
    if (h > 12) openOK = false
  }
  ok('南/东 2300m 仍为海床 ≤12m', openOK)
}

// ---------- 4. 海岸线曲折度（多波长岬湾交替，直接沿岸线函数度量） ----------
{
  const stats = (fn: (q: number) => number) => {
    const q0 = -4600, q1 = 4600
    const STEP = 20
    const NQ = Math.round((q1 - q0) / STEP)
    const y: number[] = []
    let minY = Infinity, maxY = -Infinity
    for (let i = 0; i <= NQ; i++) {
      const v = fn(q0 + i * STEP)
      y.push(v)
      minY = Math.min(minY, v)
      maxY = Math.max(maxY, v)
    }
    // 岬/湾拐点：斜率变号的局部极值点（两侧各 ≥6m 的起伏才算，剔除微颤）
    let turns = 0
    for (let i = 1; i < y.length - 1; i++) {
      const l = y[i] - y[i - 1]
      const r = y[i + 1] - y[i]
      if (Math.sign(l) !== Math.sign(r) && Math.abs(l) >= 6 && Math.abs(r) >= 6) turns++
    }
    // 细碎度：100m 级样本的中位增量（海岸“粗糙度”代理）
    let ad: number[] = []
    for (let i = 1; i < y.length; i++) ad.push(Math.abs(y[i] - y[i - 1]))
    ad.sort((a, b) => a - b)
    return { turns, span: maxY - minY, minY, maxY, med: ad[Math.floor(ad.length / 2)], p90: ad[Math.floor(ad.length * 0.9)] }
  }
  const sN = stats(wobN)
  const sW = stats(wobW)
  // 旧版（±320m 单频摆动）全程约 2 个拐点、极差 ~640m；分形海岸应显著更多
  // 对照：单频摆动旧版 ≈2 个岬湾拐点、极差 ~640m、中位|Δ100m|≈0；
  // 分形海岸应在全尺度都“动”：大尺度弯 ≥12 个 + 极差 ≥500m + 中位细碎
  ok(`北岸曲折：岬湾拐点 ≥12 且极差 ≥450m（旧版≈2 个/640m）`,
    sN.turns >= 12 && sN.span >= 450 && sN.med >= 10,
    `turns=${sN.turns} span=${sN.span.toFixed(0)}m med|Δ100m|=${sN.med.toFixed(0)}`)
  ok(`西岸曲折：岬湾拐点 ≥12 且极差 ≥450m`, sW.turns >= 12 && sW.span >= 450 && sW.med >= 10,
    `turns=${sW.turns} span=${sW.span.toFixed(0)}m med|Δ100m|=${sW.med.toFixed(0)}`)
}

// ---------- 5. 海岸带宽窄不一（前滨→干滩宽度随沿岸位置差异大） ----------
{
  // 沿岸各 x：从北岸线向陆走，记录「高度达 6m」的距离（米）。
  // 平缓沙岸（宽滩+沙丘带纵深数百米）vs 崖岸（几十米内陡升）→ 方差大。
  const widths: number[] = []
  for (let x = -4200; x <= 4200; x += 120) {
    const zc = -CN0 - wobN(x) // 北岸线（lm>0 起点的近似）
    for (let d = 0; d <= 1500; d += 15) {
      const z = zc - d
      if (terrainHeight(x, z) >= 6) { widths.push(d); break }
    }
  }
  const mean = widths.reduce((a, b) => a + b, 0) / Math.max(1, widths.length)
  const dev = Math.sqrt(widths.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, widths.length))
  const cv = dev / Math.max(1e-6, mean)
  const p10 = widths.sort((a, b) => a - b)[Math.floor(widths.length * 0.1)]
  const p90 = widths.sort((a, b) => a - b)[Math.floor(widths.length * 0.9)]
  ok('海岸带宽窄不一：10%~90% 位距比值 ≥3',
    p90 / Math.max(1e-6, p10) >= 3,
    `p10=${p10.toFixed(0)} p90=${p90.toFixed(0)} cv=${cv.toFixed(2)} mean=${mean.toFixed(0)} n=${widths.length}`)
}

// ---------- 6. 陆上细节：近岸微观起伏 + 内陆抬升为丘陵/远山 ----------
{
  // 近岸地貌微起伏：距岸 60~700m 带内高度极差（沙丘/崖/缓坡交替）
  let microRanges: number[] = []
  for (let x = -3800; x <= 3800; x += 300) {
    const zc = -CN0 - wobN(x)
    let lo = Infinity, hi = -Infinity
    for (let d = 60; d <= 700; d += 20) {
      const h = terrainHeight(x, zc - d)
      lo = Math.min(lo, h); hi = Math.max(hi, h)
    }
    if (hi - lo >= 1) microRanges.push(hi - lo)
  }
  const avgRange = microRanges.reduce((a, b) => a + b, 0) / Math.max(1, microRanges.length)
  ok('近岸地貌起伏：60~700m 带平均极差 ≥6m（沙丘/丘壑）', avgRange >= 6,
    `avg=${avgRange.toFixed(1)}m`)

  // 内陆抬升：从岸线向陆 2.6km 总抬升
  let riseOK = 0, riseN = 0
  for (const x of [-3200, -1800, -400, 600, 1800, 3000]) {
    const zc = -CN0 - wobN(x)
    const h0 = terrainHeight(x, zc - 60)
    const h1 = terrainHeight(x, zc - 2600)
    if (h1 - h0 > 60) riseOK++
    riseN++
  }
  ok('内陆抬升：多数岸段 2.6km 内抬升 >60m', riseOK >= 4, `${riseOK}/${riseN}`)
}

// ---------- 7. 无 NaN / 连续 ----------
{
  let nan = false
  let maxStep = 0
  for (let i = 0; i < 20000; i++) {
    const x = ((i * 977) % 9200) - 4600
    const z = ((i * 1433) % 9200) - 4600
    const h = terrainHeight(x, z)
    if (!Number.isFinite(h)) { nan = true; break }
    if (i % 40 === 0) {
      const h2 = terrainHeight(x + 4, z + 3)
      maxStep = Math.max(maxStep, Math.abs(h2 - h))
    }
  }
  ok('全图 20000 采样无 NaN/Inf', !nan)
  ok('地形连续：4m 步高程差 < 12m（陡崖也连续，无断裂）', maxStep < 12, `maxStep=${maxStep.toFixed(1)}m`)
}

// ---------- 8. 求值速度（网格顶点量级 1e5） ----------
{
  const t0 = performance.now()
  let acc = 0
  for (let i = 0; i < 12000; i++) {
    const x = ((i * 977) % 9200) - 4600
    const z = ((i * 1433) % 9200) - 4600
    acc += terrainHeight(x, z)
  }
  const dt = performance.now() - t0
  ok(`地形求值速度（12k 点 ${dt.toFixed(0)}ms ≈ 网格 10 万点 ${(dt * 8.3).toFixed(0)}ms）`, dt < 8000)
  void acc
}

// ---------- 9. 结构备忘：北/西岸线位置范围（供人工核对，不设门槛） ----------
{
  console.log(`  · 北岸 z ∈ [${(-CN0 - 1600).toFixed(0)}, ${(-CN0 + 700).toFixed(0)}]（供视觉核对）`)
  console.log(`  · 西岸 x ∈ [${(-CW0 - 1600).toFixed(0)}, ${(-CW0 + 700).toFixed(0)}]（供视觉核对）`)
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
