// 尾流三参数联合标定：目标 = 老网页 FLORIS 阵列三指标
//   none=8095.15 kW、unified+30°=9299.05 kW、independent 增益=24.04%
// 代价 = 相对误差加权和（0.4/0.4/0.2）。标定即文档：系数出处见 turbinePhysics.ts。
import { __setWakeTuning } from '../src/data/turbinePhysics.ts'
import { farmFrame, optimizeYaw } from '../src/data/farmSim.ts'

const W = { u: 8.0, fromDeg: 0 }
const Z = new Array(9).fill(0)
const T = new Array(9).fill(30)
const errOf = (none: number, uni: number, gain: number) =>
  0.4 * Math.abs(none - 8095.15) / 8095.15 +
  0.4 * Math.abs(uni - 9299.05) / 9299.05 +
  0.2 * Math.abs(gain - 24.04) / 24.04

interface Best { err: number; k: number; d: number; f: number; none: number; uni: number; gain: number }
let best: Best = { err: 1e9, k: 0, d: 0, f: 0, none: 0, uni: 0, gain: 0 }
for (let k1000 = 20; k1000 <= 46; k1000 += 2) {
  for (let d100 = 40; d100 <= 140; d100 += 10) {
    for (let f100 = 15; f100 <= 90; f100 += 5) {
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
