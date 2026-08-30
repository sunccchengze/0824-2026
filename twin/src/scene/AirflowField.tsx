/* oxlint-disable react/immutability -- R3F 帧循环 mutate 缓冲为既定性能模式（docs/08 D2） */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, terrainHeight } from './terrainUtil'
import { windAt } from '../data/farmSim'
import { mulberry32 } from '../data/rng.ts'
import { ROTOR_D, WAKE_K, WAKE_DEFLECT, thrustCt } from '../data/turbinePhysics'
import { useSim } from '../state/simStore'

// ============================================================================
// AirflowField —— 全场气流粒子场 + 尾流走廊（项目核心叙事的可视化）
//  · 同源物理：基流 = windAt（与功率/尾流/风纱同一剖面）；逐机尾流 =
//    Jensen 扩张 + 偏航偏折，与 farmSim 功率、HUD 雷达走廊同式。
//    拨任一偏航滑杆 → 该机走廊横偏、粒子绕流弯折、下游机从暗尾流区
//    脱出变亮 → "最优偏航为什么涨功率"直接可看；
//  · 粒子流速/亮度 ∝ 当地有效风速（deficit 越大越暗越慢），尾流边缘
//    绕流微增亮，风剪切随高度增强（log律近似）；
//  · 性能：单 Float32Array 循环、零逐帧分配；low 620 / medium 1400 /
//    high 2600 粒；走廊 9×10 环 LineSegments 同一帧更新；
//  · 视觉克制：纯青白加性点精灵，无 Bloom（HUD「三维气流场」可整层开关）。
// ============================================================================

const VERT = /* glsl */ `
attribute float aSize;
attribute float aBright;
varying float vB;
void main() {
  vB = aBright;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * (520.0 / max(40.0, -mv.z)), 5.2);
  gl_Position = projectionMatrix * mv;
}
`
const FRAG = /* glsl */ `
precision mediump float;
varying float vB;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float m = 1.0 - smoothstep(0.18, 0.5, length(d));
  vec3 col = vec3(0.42, 0.78, 1.0) * (0.30 + 0.80 * vB) + vec3(0.55, 0.85, 1.0) * pow(vB, 3.0);
  gl_FragColor = vec4(col, m * (0.08 + 0.36 * vB));
}
`

const N_RING = 10
const N_SEG = 14
const CX = 1500 // 场域半宽（米）
// 场心（FARM 质心）——粒子域随场心而非原点
const FCX = FARM.reduce((a, f) => a + f.x, 0) / FARM.length
const FCZ = FARM.reduce((a, f) => a + f.z, 0) / FARM.length

export default function AirflowField() {
  const quality = useSim((s) => s.quality)
  const n = quality === 'high' ? 2600 : quality === 'medium' ? 1400 : 620

  const { pts, cones } = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(n * 3)
    const bright = new Float32Array(n)
    const size = new Float32Array(n)
    const seed = mulberry32(0x0830) // 项目纪律（D2）：渲染期随机必须可复现
    for (let i = 0; i < n; i++) {
      pos[i * 3] = FCX + (seed() * 2 - 1) * CX
      pos[i * 3 + 1] = 4 + seed() ** 1.6 * 250
      pos[i * 3 + 2] = FCZ + (seed() * 2 - 1) * CX
      bright[i] = 1
      size[i] = 1.3 + seed() * 2.4
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 140, 0), 3000)
    const ptsObj = new THREE.Points(
      g,
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    const cg = new THREE.BufferGeometry()
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FARM.length * N_RING * N_SEG * 2 * 3), 3))
    cg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 140, 0), 3000)
    const conesObj = new THREE.LineSegments(
      cg,
      new THREE.LineBasicMaterial({ color: '#7fd4ff', transparent: true, opacity: 0.17, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    return { pts: ptsObj, cones: conesObj }
  }, [n])

  useEffect(
    () => () => {
      pts.geometry.dispose()
      ;(pts.material as THREE.Material).dispose()
      cones.geometry.dispose()
      ;(cones.material as THREE.Material).dispose()
    },
    [pts, cones],
  )

  useFrame((_state, dtRaw) => {
    const s = useSim.getState()
    const on = s.airflow
    pts.visible = on
    cones.visible = on
    if (!on) return
    const dt = Math.min(0.05, dtRaw)
    const w = windAt(s.tHours)
    const baseU = w.u
    const th = (((w.fromDeg % 360) + 360) % 360) * (Math.PI / 180)
    const fx = Math.sin(th), fz = Math.cos(th) // 顺风向单位向量（北来风 → +z）
    const cxv = fz, czv = -fx // 侧风单位向量
    const ct = Math.min(0.9, thrustCt(baseU))
    const a = (1 - Math.sqrt(Math.max(0, 1 - ct))) / 2
    const g = pts.geometry
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const bright = g.getAttribute('aBright') as THREE.BufferAttribute
    const pa = pos.array as Float32Array
    const ba = bright.array as Float32Array
    const NX = FARM.length
    const x9 = new Array<number>(NX)
    const z9 = new Array<number>(NX)
    const tan9 = new Array<number>(NX)
    for (let j = 0; j < NX; j++) {
      x9[j] = FARM[j].x
      z9[j] = FARM[j].z
      tan9[j] = Math.tan((((s.unitYaw[j] ?? 0) * Math.PI) / 180)) * WAKE_DEFLECT
    }
    const SPEED = 34 // 可视化平流倍率（域内 ~9s 过一遍，与 24h/50s 时间尺度同量级）
    for (let i = 0; i < n; i++) {
      const o = i * 3
      let px = pa[o], py = pa[o + 1], pz = pa[o + 2]
      let def2 = 0
      let lat = 0
      for (let j = 0; j < NX; j++) {
        const dx = px - x9[j]
        const dz = pz - z9[j]
        const ax = dx * fx + dz * fz // 下风距离
        if (ax <= ROTOR_D * 0.35) continue
        const cr = dx * cxv + dz * czv // 横向偏移
        const sigma = ROTOR_D * 0.5 + WAKE_K * ax
        const q = (cr - 2 * a * ax * tan9[j]) / sigma
        const bell = Math.exp(-0.5 * q * q)
        const core = (ROTOR_D / (ROTOR_D + 2 * WAKE_K * ax)) ** 2
        const di = Math.min(0.85, 2 * a * core * bell)
        def2 += di * di
        lat += di * (q / (1 + Math.abs(q))) // 绕流：沿尾流边缘外弯
      }
      const eff = Math.sqrt(Math.max(0.03, 1 - def2))
      const shear = 0.72 + 0.5 * Math.min(1, Math.log(Math.max(8, py) / 8) / Math.log(30))
      const sp = baseU * eff * shear * SPEED
      px += (fx + cxv * lat * 1.35) * sp * dt
      pz += (fz + czv * lat * 1.35) * sp * dt
      py += lat * sp * dt * 0.22 + (eff < 0.9 ? 2.4 * dt * SPEED * 0.2 : 0) // 尾流内轻微上洗
      const gd = terrainHeight(px, pz)
      if (py < gd + 2.5) py = gd + 2.5 // 贴丘爬升，不闪灭
      const along = (px - FCX) * fx + (pz - FCZ) * fz
      const across = (px - FCX) * cxv + (pz - FCZ) * czv
      if (along > CX + 260 || Math.abs(across) > CX * 1.15 || py > 330) {
        const back = -CX - Math.random() * 300
        const side = (Math.random() * 2 - 1) * CX * 0.94
        px = FCX + fx * back + cxv * side
        pz = FCZ + fz * back + czv * side
        py = Math.max(terrainHeight(px, pz) + 4, 4 + Math.random() ** 1.7 * 255)
      }
      pa[o] = px
      pa[o + 1] = py
      pa[o + 2] = pz
      ba[i] = 0.16 + 0.84 * eff
    }
    pos.needsUpdate = true
    bright.needsUpdate = true

    // 尾流走廊环（与 deficit 场同一公式系：半径 Jensen 扩张、中心线偏航横偏）
    const cp = cones.geometry.getAttribute('position') as THREE.BufferAttribute
    const ca = cp.array as Float32Array
    let c = 0
    for (let j = 0; j < NX; j++) {
      const t = tan9[j]
      for (let r = 0; r < N_RING; r++) {
        const ax = 45 + r * (r * 14 + 42)
        const rad = ROTOR_D * (0.5 + a) + WAKE_K * ax
        const off = 2 * a * ax * t
        const by = terrainHeight(x9[j], z9[j]) + 88
        for (let kk = 0; kk < N_SEG; kk++) {
          const a1 = (kk / N_SEG) * Math.PI * 2
          const a2 = ((kk + 1) / N_SEG) * Math.PI * 2
          const o1 = Math.cos(a1) * rad + off
          const o2 = Math.cos(a2) * rad + off
          const h1 = Math.sin(a1) * rad * 0.6
          const h2 = Math.sin(a2) * rad * 0.6
          ca[c++] = x9[j] + fx * ax + cxv * o1
          ca[c++] = by + h1
          ca[c++] = z9[j] + fz * ax + czv * o1
          ca[c++] = x9[j] + fx * ax + cxv * o2
          ca[c++] = by + h2
          ca[c++] = z9[j] + fz * ax + czv * o2
        }
      }
    }
    cp.needsUpdate = true
  })

  return (
    <group>
      <primitive object={pts} />
      <primitive object={cones} />
    </group>
  )
}
