import { useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, terrainHeight } from './terrainUtil'
import { rng } from '../state/simCore'

// ============================================================================
// W6 风况粒子（v3 · 风向语义最终版）
// ---------------------------------------------------------------------------
// 全场风向唯一语义：主导风向 = 南 → 北（微偏东），与机组迎风方向一致——
// NREL 5MW 是上风向机组，转子迎风；9 台转子平面朝 +z（南），即迎风面，
// 与本层粒子来向（+z 起点 → -z 终点）物理自洽（A4 终裁；用户原图.rotor
// 面向观众的正脸构图保持不变）。
//   ① 高空来流 —— 南侧高空(y 560~850)沿同一风向北上，越过阵列后升入北岭；
//      距离远、亮度低，只做纵深氛围。
//   ② 列向来流 —— 近场 11 条流线自南向北依次穿过近/中/远三排（尾流叙事）。
//
// 工程修正：
//   · D3：采样 LUT 化——初始化时一次性弧长烘焙 256 点，逐帧只做查表+插值，
//     不再每帧 2564 次 getPointCatmullRom；
//   · 全层 depthTest:true（C1）：粒子被山体正确遮挡；材质仍
//     toneMapped:false / fog:false / additive，亮度依旧视角无关；
//   · 粒子排布改为确定性随机源（可复现）。
// ============================================================================

const VERT = /* glsl */ `
attribute float aSize;
attribute float aBright;
varying float vB;
void main() {
  vB = aBright;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * (560.0 / -mv.z), 6.5);
  gl_Position = projectionMatrix * mv;
}
`
const FRAG = /* glsl */ `
precision highp float;
varying float vB;
uniform vec3 uColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d) * vB;
  gl_FragColor = vec4(uColor * 1.6, a);
}
`

function curveFrom(pts: THREE.Vector3[]) {
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3)
}

interface Stream {
  curve: THREE.CatmullRomCurve3
  count: number
  speed: number
  size: number
  bright: number
  wig: number // CPU 抖动幅度（远处的流更"粗"，抖动也更大）
}

// 调试开关（仅开发环境）：?noveil=1 时整个风况粒子层不渲染（A/B 归属定位用）
const NOVEIL = import.meta.env.DEV && new URLSearchParams(location.search).has('noveil')

const LUT_N = 256

export default function WindVeil() {
  const built = useMemo(() => {
    const streams: Stream[] = []
    const rand = rng(20260828)

    // ① 南侧高空来流：沿主导风向（南→北、微偏东）越过全场，升入北岭。
    for (let k = 0; k < 6; k++) {
      const pts: THREE.Vector3[] = []
      const n = 8
      const x0 = -1520 + k * 600 + Math.sin(k * 2.7) * 90
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1)
        const z = 1400 - t * 4300 // z: +1400（南侧远方） → -2900（北岭之上）
        const x = x0 + t * 280 + Math.sin(t * 3.0 + k * 1.3) * 90
        const y = 560 + t * 250 + Math.sin(t * Math.PI) * 70 + k * 22
        pts.push(new THREE.Vector3(x, y, z))
      }
      streams.push({ curve: curveFrom(pts), count: 300, speed: 0.028, size: 11, bright: 0.5, wig: 13 })
    }

    // ② 列向来流：南 → 北（偏东），沿机组列向由近排向远排穿过（上风向下游）
    const laneXs = [-640, -480, -330, -190, -60, 70, 200, 330, 470, 610, 750]
    laneXs.forEach((lx, li) => {
      const pts: THREE.Vector3[] = []
      const n = 8
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1)
        const z = 1500 - t * 3000 // z: +1500 → -1500（自南向北纵贯阵列）
        let x = lx + t * 300 + Math.sin(t * 4.4 + li) * 46
        // 途经机组时轻微绕流（示意偏航导流的视觉联想）
        for (const u of FARM) {
          const dz = z - u.z, dx = x - u.x
          const dd = Math.hypot(dx, dz)
          if (dd < 130) x += (dx / Math.max(dd, 1)) * (130 - dd) * 0.5
        }
        const y = terrainHeight(x, z) + 9 + Math.sin(t * Math.PI) * 26 + (li % 3) * 7
        pts.push(new THREE.Vector3(x, y, z))
      }
      streams.push({ curve: curveFrom(pts), count: 64, speed: 0.045, size: 2.7, bright: 0.8, wig: 7.5 })
    })

    const total = streams.reduce((s, st) => s + st.count, 0)
    const pos = new Float32Array(total * 3)
    const aSize = new Float32Array(total)
    const aBright = new Float32Array(total)
    const seeds = new Float32Array(total * 2) // [t0, wiggle phase]
    let o = 0
    for (const st of streams) {
      for (let j = 0; j < st.count; j++) {
        seeds[o * 2] = rand()
        seeds[o * 2 + 1] = rand() * Math.PI * 2
        aSize[o] = st.size * (0.45 + rand() * 1.55)
        aBright[o] = st.bright * (0.35 + rand() * 0.65)
        o++
      }
    }
    // D3：弧长 LUT 一次性烘焙（getPointAt 仅在初始化用）
    const luts = streams.map((s) => {
      const arr = new Float32Array(LUT_N * 3)
      for (let i = 0; i < LUT_N; i++) {
        const p = s.curve.getPointAt(i / (LUT_N - 1))
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z
      }
      return { lut: arr, count: s.count, speed: s.speed, wig: s.wig }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
    g.setAttribute('aBright', new THREE.BufferAttribute(aBright, 1))
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uColor: { value: new THREE.Color('#7fd2f2') } },
      transparent: true, depthWrite: false, depthTest: true,
      fog: false, toneMapped: false,
      blending: THREE.AdditiveBlending,
    })
    const p = new THREE.Points(g, m)
    p.frustumCulled = false
    p.renderOrder = 2
    return { points: p, luts, seeds }
  }, [])

  useEffect(() => () => {
    built.points.geometry.dispose()
    ;(built.points.material as THREE.Material).dispose()
  }, [built])

  useFrame((s) => {
    const t = s.clock.elapsedTime
    const posAttr = built.points.geometry.attributes.position as THREE.BufferAttribute
    const arr = posAttr.array as Float32Array
    let o = 0
    for (const c of built.luts) {
      const lut = c.lut
      for (let j = 0; j < c.count; j++, o++) {
        const tt = (built.seeds[o * 2] + t * c.speed) % 1
        const fi = tt * (LUT_N - 1)
        const i0 = Math.floor(fi)
        const i1 = Math.min(LUT_N - 1, i0 + 1)
        const f = fi - i0
        const bx = lut[i0 * 3] + (lut[i1 * 3] - lut[i0 * 3]) * f
        const by = lut[i0 * 3 + 1] + (lut[i1 * 3 + 1] - lut[i0 * 3 + 1]) * f
        const bz = lut[i0 * 3 + 2] + (lut[i1 * 3 + 2] - lut[i0 * 3 + 2]) * f
        const ph = built.seeds[o * 2 + 1]
        arr[o * 3] = bx + Math.sin(t * 1.3 + ph) * c.wig
        arr[o * 3 + 1] = by + Math.sin(t * 1.7 + ph * 2.0) * (c.wig * 0.7)
        arr[o * 3 + 2] = bz + Math.cos(t * 1.1 + ph) * c.wig
      }
    }
    posAttr.needsUpdate = true
  })

  if (NOVEIL) return null
  return <primitive object={built.points} />
}
