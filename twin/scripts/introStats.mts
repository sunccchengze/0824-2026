// 第 24 轮：开场速度剖面定量验证（node 直接跑，与运行时同一份模块）
import { buildIntroProfile, BOOST_TABLE } from '../src/scene/introProfile.ts'
import * as THREE from 'three'
import { FARM } from '../src/scene/terrainUtil.ts'

const NODES = [
  new THREE.Vector3(-100, 1720, -640),
  new THREE.Vector3(-100, 720, -640),
  new THREE.Vector3(-100, 300, -640),
  new THREE.Vector3(-100, 300, -520),
  new THREE.Vector3(-100, 330, -200),
  new THREE.Vector3(-100, 390, 250),
  new THREE.Vector3(60, 480, 990),
  new THREE.Vector3(120, 470, 900),
  new THREE.Vector3(FARM[2].x + 145, 210, FARM[2].z - 160),
  new THREE.Vector3(FARM[2].x + 160, 220, FARM[2].z - 110),
  new THREE.Vector3(FARM[4].x + 100, 130, FARM[4].z + 105),
  new THREE.Vector3(FARM[6].x + 145, 86, FARM[6].z + 120),
  new THREE.Vector3(FARM[6].x + 76, 56, FARM[6].z + 168),
]
const path = new THREE.CatmullRomCurve3(NODES, false, 'centripetal', 0.38)
const P = buildIntroProfile(path, 34, 170, 40, 400, BOOST_TABLE)
const s = P.stats
console.log('== 巡航段速度剖面（34s）==')
console.log(`总长 ${s.len.toFixed(0)} m | 需均速 ${s.vMean.toFixed(1)} m/s | min ${s.vMin.toFixed(1)} | max ${s.vMax.toFixed(1)} m/s`)
console.log(`[debug] rawDur=${s.rawDur.toFixed(1)}s scale=${s.scale.toFixed(3)} totalTime=${s.totalTime.toFixed(1)}s`)
console.log(`变速方向反转 ${s.turns} 次（平均 ${(34 / Math.max(s.turns, 1)).toFixed(1)}s 一次） | 峰谷比 ${(s.vMax / s.vMin).toFixed(2)}× | 最大侧倾 ${s.bankMaxDeg.toFixed(1)}° | 最大曲率 1/${(1 / Math.max(s.maxCurve, 1e-6)).toFixed(0)}m`)
console.log('t(s)  速度(m/s)  弧长分数%  fov')
for (let t = 0; t <= 34; t += 2) {
  const st = P.lookup(t)
  console.log(`${String(t).padStart(2, ' ')}   ${st.speed.toFixed(1).padStart(6)}    ${(st.frac * 100).toFixed(1).padStart(5)}    ${st.fov.toFixed(1)}`)
}
console.log(`巡航出口速度 ${P.vExit.toFixed(1)} m/s（收尾环绕接管角速度 ≈ ${(P.vExit / 184.6).toFixed(2)} rad/s）`)
