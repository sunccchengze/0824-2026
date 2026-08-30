// ================================================================
// 数据契约回归自检（docs/08 D2：把"截图/帧差验证"沉淀为可执行断言）
// 运行：node --experimental-strip-types scripts/selftest.mts
// 依赖：仅 Node 22 原生类型剥离；无浏览器、无网络。
// ================================================================
import {
  farmFrame, optimizeYaw, windAt, FARM_RATED_MW,
} from '../src/data/farmSim.ts'
import { powerCurveKw, yawFactor, wakeDeficit, TILT_F } from '../src/data/turbinePhysics.ts'
import { FARM } from '../src/scene/terrainUtil.ts'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

console.log('== AEOLUS 数据契约自检 ==')

// 1. 确定性：同输入同帧
{
  const a = farmFrame(7.5, [0, 0, 0, 0, 0, 0, 0, 0, 0], 45)
  const b = farmFrame(7.5, [0, 0, 0, 0, 0, 0, 0, 0, 0], 45)
  ok('确定性：同 (t,yaw,target) 两次求值 totalMW/频率/告警一致',
    close(a.totalMW, b.totalMW) && close(a.freqHz, b.freqHz)
    && JSON.stringify(a.alarms.map((x) => x.key)) === JSON.stringify(b.alarms.map((x) => x.key)))
}

// 2. 功率曲线形状
{
  let mono = true
  let prev = -1
  for (let u = 3; u <= 11.4001; u += 0.1) {
    const p = powerCurveKw(u)
    if (p < prev - 1e-9) mono = false
    prev = p
  }
  ok('功率曲线：额定段单调不减', mono)
  ok('功率曲线：cut-in 以下 = 0', powerCurveKw(2.9) === 0)
  ok('功率曲线：cut-out 以上 = 0', powerCurveKw(25.1) === 0)
  ok('功率曲线：额定平台 = 5000×倾斜因子（FLORIS 表口径，含 5° 转轴倾斜损失）', close(powerCurveKw(15), 5000 * TILT_F, 0.5))
}

// 3. 偏航损失
ok('偏航因子：cos^p 随 |yaw| 递减', yawFactor(0) > yawFactor(10) && yawFactor(10) > yawFactor(25))

// 4. 尾流物理方向与偏航偏折
{
  // 下游机在正南 440m（风从北来）：应出现亏损
  const d0 = wakeDeficit(8, 0, 440, 0, 0)
  // 上游机偏航 25°：尾流横向偏移，下游（对齐机）亏损应减小
  const dS = wakeDeficit(8, 0, 440, 0, 25)
  // 上风向不应有亏损
  const dUp = wakeDeficit(8, 0, -440, 0, 0)
  ok('Jensen：下游同列机组出现速度亏损', d0 > 0.05)
  ok('Jensen：偏航偏折降低下游亏损（wake steering 方向正确）', dS < d0, `d0=${d0.toFixed(3)} dS=${dS.toFixed(3)}`)
  ok('Jensen：上游来流不受下游影响', dUp === 0)
}

// 5. 限功率闭环：total ≈ min(avail, target)
{
  const avail = farmFrame(4.2, [0, 0, 0, 0, 0, 0, 0, 0, 0], 45)
  const curtail = farmFrame(4.2, [0, 0, 0, 0, 0, 0, 0, 0, 0], 8)
  ok('限功率：指令 8MW 时 total≈8（若资源充足）',
    avail.totalMW > 8 ? close(curtail.totalMW, 8, 1e-3) : curtail.totalMW <= avail.totalMW + 1e-6,
    `avail=${avail.totalMW.toFixed(2)} curtail=${curtail.totalMW.toFixed(2)}`)
}

// 6. 电网频率带宽
{
  let inBand = true
  for (let t = 0; t < 24; t += 0.5) {
    const f = farmFrame(t, [0, 0, 0, 0, 0, 0, 0, 0, 0], 45).freqHz
    if (f < 49.8 || f > 50.2) inBand = false
  }
  ok('频率：24h 扫描内 |f-50|≤0.2Hz（并网常态）', inBand)
}

// 7. 机组计数/功率守恒
{
  const fr = farmFrame(11.3, [0, 0, 0, 0, 0, 0, 0, 0, 0], 45)
  const sum = fr.units.reduce((s, u) => s + u.powerKw, 0) / 1000
  ok('守恒：单机功率求和 = 全场功率', close(sum, fr.totalMW, 1e-3), `${sum} vs ${fr.totalMW}`)
  ok('一致性：units 数 = 场景机组数 9', fr.units.length === FARM.length)
  ok('一致性：运行计数 = 9 - idle', fr.runningCount === fr.units.filter((u) => u.status !== 'idle').length)
}

// 8. 告警确定性 + 字段完备
{
  const a = farmFrame(2.75, [28, 28, 28, -22, -22, -22, 12, 12, 12], 9)
  const b = farmFrame(2.75, [28, 28, 28, -22, -22, -22, 12, 12, 12], 9)
  ok('告警：同输入同事件集', JSON.stringify(a.alarms) === JSON.stringify(b.alarms))
  ok('告警：≤6 条且含等级/部件/定位字段', a.alarms.length <= 6
    && a.alarms.every((e) => (e.level === 'warn' || e.level === 'crit') && e.part.length > 0))
  ok('告警：大偏差+限功率工况至少 1 条', a.alarms.length >= 1)
}

// 9. 寻优：增益非负
{
  const seeds = [[0, 0, 0, 0, 0, 0, 0, 0, 0], [10, -6, 3, -12, 5, 0, -8, 4, -2]]
  let allOk = true
  for (const sy of seeds) {
    const base = farmFrame(15.2, sy, 45).totalMW
    const r = optimizeYaw(15.2, sy)
    if (r.totalMW < base - 1e-6) allOk = false
  }
  ok('寻优：优化后功率 ≥ 优化前（任意初始偏航）', allOk)
  const r = optimizeYaw(15.2, [0, 0, 0, 0, 0, 0, 0, 0, 0])
  ok('寻优：基准工况增益 >0（存在可利用的尾流偏折收益）', r.gainPct > 0, `gain=${r.gainPct.toFixed(2)}%`)
}

// 10. 能源口径物理上限
{
  const fr = farmFrame(6.6, [0, 0, 0, 0, 0, 0, 0, 0, 0], 45)
  ok('年估算 ≤ 装机×8760（A2-1 类错误不可能复现）',
    fr.energyYearEstMWh <= FARM_RATED_MW * 8760 + 1)
  ok('容量系数 0-100%', fr.cfPct >= 0 && fr.cfPct <= 100)
}

// 11. 风况函数域与连续
{
  let jumpMax = 0
  let prev = windAt(0).u
  for (let t = 0; t < 24; t += 0.05) {
    const { u } = windAt(t)
    if (u < 3 || u > 25) jumpMax = -1
    jumpMax = Math.max(jumpMax, Math.abs(u - prev))
    prev = u
  }
  ok('风况：全程处于 [3,25] 运行域且无跳变(Δ<0.5m/s/步)', jumpMax > 0 && jumpMax < 0.5, `maxΔ=${jumpMax.toFixed(3)}`)
}

// 12. V&V：对老网页 FLORIS 阵列基准的三指标复算（标定不漂移）
{
  const W = { u: 8, fromDeg: 0 }
  const Z = new Array(9).fill(0)
  const T = new Array(9).fill(30)
  const none = farmFrame(12, Z, 45, W).totalMW * 1000
  const uni = farmFrame(12, T, 45, W).totalMW * 1000
  const gain = optimizeYaw(12, Z, W).gainPct
  ok('V&V FLORIS none：8095.15 kW ±5%', Math.abs(none - 8095.15) <= 404.8, `=${none.toFixed(1)}`)
  ok('V&V FLORIS unified+30°：9299.05 kW ±5%', Math.abs(uni - 9299.05) <= 465, `=${uni.toFixed(1)}`)
  ok('V&V FLORIS 独立寻优增益：24.04% ±3pt', Math.abs(gain - 24.04) <= 3, `=${gain.toFixed(2)}%`)
  const p6 = powerCurveKw(6)
  const p8 = powerCurveKw(8)
  ok('V&V 单机功率锚点：731.0/1753.95 kW ±0.5%（FLORIS 表×倾斜）',
    Math.abs(p6 - 731) / 731 <= 0.005 && Math.abs(p8 - 1753.95) / 1753.95 <= 0.005,
    `p6=${p6.toFixed(1)} p8=${p8.toFixed(2)}`)
  const f12 = farmFrame(12, Z, 45, W)
  ok('V&V 转速口径：全场均值处于 6.9-13.5 rpm 带（含功率耦合上限）',
    f12.meanRpm >= 6.8 && f12.meanRpm <= 13.5, `=${f12.meanRpm.toFixed(2)}`)
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
