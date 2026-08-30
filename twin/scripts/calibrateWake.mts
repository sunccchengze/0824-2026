// 尾流三参数联合标定：目标 = FLORIS 4.6.6 GCH 同源实算三指标
//   none=8108.08 kW、unified+30°=9060.03 kW、independent 增益=24.04%
// （第 18 轮 P0：旧靶 8095.15/9299.05 来自老版本 FLORIS，与现偏折曲线不同源）
// 注意 WAKE_DEFLECT 现为【尾流展宽系数】σ=D·d/2+kx，不再是偏折强度。
// 代价 = 相对误差加权和（0.4/0.4/0.2）。标定即文档：系数出处见 turbinePhysics.ts。
import { __setWakeTuning } from '../src/data/turbinePhysics.ts'
import { farmFrame, optimizeYaw } from '../src/data/farmSim.ts'

const W = { u: 8.0, fromDeg: 0 }
const Z = new Array(9).fill(0)
const T = new Array(9).fill(30)
const errOf = (none: number, uni: number, gain: number) =>
  0.4 * Math.abs(none - 8108.08) / 8108.08 +
  0.4 * Math.abs(uni - 9060.03) / 9060.03 +
  0.2 * Math.abs(gain - 24.04) / 24.04

interface Best { err: number; k: number; d: number; f: number; none: number; uni: number; gain: number }
let best: Best = { err: 1e9, k: 0, d: 0, f: 0, none: 0, uni: 0, gain: 0 }
for (let k1000 = 12; k1000 <= 40; k1000 += 1) {
  for (let d100 = 30; d100 <= 80; d100 += 2) {
    for (let f100 = 50; f100 <= 99; f100 += 3) {
      __setWakeTuning(k1000 / 1000, d100 / 100, f100 / 100)
      const none = farmFrame(12, Z, 15, W).totalMW * 1000
      const uni = farmFrame(12, T, 15, W).totalMW * 1000
      const gain = optimizeYaw(12, Z, W).gainPct
      const err = errOf(none, uni, gain)
      if (err < best.err) best = { err, k: k1000 / 1000, d: d100 / 100, f: f100 / 100, none, uni, gain }
    }
  }
}
console.log('COARSE ' + JSON.stringify(best))
let fin = best
for (let kk = Math.floor(best.k * 200) - 40; kk <= Math.floor(best.k * 200) + 40; kk += 5) {
  for (let dd = Math.round(best.d * 100) - 15; dd <= Math.round(best.d * 100) + 15; dd += 5) {
    for (let ff = Math.round(best.f *100) - 15; ff <= Math.round(best.f * 100) + 15; ff += 5) {
      if (kk < 5 || dd < 0 || ff < 0) continue
      __setWakeTuning(kk / 200, dd / 100, ff / 100)
      const none = farmFrame(12, Z, 15, W).totalMW * 1000
      const uni = farmFrame(12, T, 15, W).totalMW * 1000
      const gain = optimizeYaw(12, Z, W).gainPct
      const err = errOf(none, uni, gain)
      if (err < fin.err) fin = { err, k: kk / 200, d: dd / 100, f: ff / 100, none, uni, gain }
    }
  }
}
console.log('FINE   ' + JSON.stringify(fin))
