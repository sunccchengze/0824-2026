/* oxlint-disable react/immutability -- R3F 帧循环内 mutate geometry position 缓冲为既定性能模式（docs/08 D2 说明） */
import { useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, terrainHeight } from './terrainUtil'
import { buildPathFromCurve, type HugPath } from '../data/paths.ts'
import { mulberry32 } from '../data/rng.ts'

// ===========================================================================
// 风况粒子（v3：性能 + 可复现 + 语义恒定）
// ---------------------------------------------------------------------------
// 全场风只有一种语义：主导风向 = 北 → 南（+z），与 A4 修正后的转子迎风
// 朝向（机头朝北）、farmSim 坐标约定三方一致：
//   ① 远脊来流 —— 北岭后高空南下，只做纵深氛围；
//   ② 列向来流 —— 近场 11 条流线沿 z 向穿过远/中/近三排（尾流叙事），
//      途经机组轻微绕流。
// D3：流线构建期离散为等弧长折线表（data/paths），每帧只做索引+插值；
// D2：粒子随机量全部由 seed 派生（mulberry32），StrictMode/截图 A/B 可复现；
// D10：?noveil 调试开关仅在 DEV 或 ?debug=1 下生效。
// ===========================================================================

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

import { debugEnabled, hasFlag } from '../data/debug.ts'

interface StreamDef {
  pts: THREE.Vector3[]
  count: number
  speed: number
  size: number
  bright: number
  wig: number
}

export default function WindVeil() {
  const built = useMemo(() => {
    const rnd = mulberry32(0x5EED42)
    const defs: StreamDef[] = []

    // ① 远脊来流（6 条）
    for (let k = 0; k < 6; k++) {
      const pts: THREE.Vector3[] = []
      const n = 8
      const x0 = -1520 + k * 600 + Math.sin(k * 2.7) * 90
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1)
        pts.push(new THREE.Vector3(
          x0 + t * 280 + Math.sin(t * 3.0 + k * 1.3) * 90,
          700 - t * 180 + Math.sin(t * Math.PI) * 55 + k * 26,
          -3380 + t * 1620,
        ))
      }
      defs.push({ pts, count: 300, speed: 0.028, size: 11, bright: 0.5, wig: 13 })
    }

    // ② 列向来流（11 条，北→南）
    const laneXs = [-640, -480, -330, -190, -60, 70, 200, 330, 470, 610, 750]
    laneXs.forEach((lx, li) => {
      const pts: THREE.Vector3[] = []
      const n = 8
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1)
        const z = -1500 + t * 2100
        let x = lx + t * 300 + Math.sin(t * 4.4 + li) * 46
        for (const u of FARM) {
          const dz = z - u.z
          const dx = x - u.x
          const dd = Math.hypot(dx, dz)
          if (dd < 130) x += (dx / Math.max(dd, 1)) * (130 - dd) * 0.5
        }
        pts.push(new THREE.Vector3(x, terrainHeight(x, z) + 9 + Math.sin(t * Math.PI) * 26 + (li % 3) * 7, z))
      }
      defs.push({ pts, count: 64, speed: 0.05, size: 2.7, bright: 0.8, wig: 7.5 })
    })

    const streams: { path: HugPath; count: number; speed: number; wig: number; speedFrac: number }[] = []
    const total = defs.reduce((s, d) => s + d.count, 0)
    const pos = new Float32Array(total * 3)
    const aSize = new Float32Array(total)
    const aBright = new Float32Array(total)
    const seeds = new Float32Array(total * 2)
    let o = 0
    for (const d of defs) {
      const path = buildPathFromCurve(new THREE.CatmullRomCurve3(d.pts, false, 'catmullrom', 0.3), 192)
      streams.push({ path, count: d.count, speed: 0, wig: d.wig, speedFrac: d.speed })
      for (let j = 0; j < d.count; j++, o++) {
        seeds[o * 2] = rnd()
        seeds[o * 2 + 1] = rnd() * Math.PI * 2
        aSize[o] = d.size * (0.45 + rnd() * 1.55)
        aBright[o] = d.bright * (0.35 + rnd() * 0.65)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
    g.setAttribute('aBright', new THREE.BufferAttribute(aBright, 1))
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uColor: { value: new THREE.Color('#7fd2f2') } },
      transparent: true, depthWrite: false, depthTest: false,
      fog: false, toneMapped: false,
      blending: THREE.AdditiveBlending,
    })
    const p = new THREE.Points(g, m)
    p.frustumCulled = false
    p.renderOrder = 2
    return { points: p, streams, seeds, mat: m }
  }, [])

  useEffect(() => () => {
    built.points.geometry.dispose()
    built.mat.dispose()
  }, [built])

  const buf = useMemo(() => new Float32Array(3), [])
  useFrame((s) => {
    const t = s.clock.elapsedTime
    const posAttr = built.points.geometry.attributes.position as THREE.BufferAttribute
    const arr = posAttr.array as Float32Array
    let o = 0
    for (const st of built.streams) {
      const { path, count, speedFrac, wig } = st
      const total = path.total
      for (let j = 0; j < count; j++, o++) {
        // 沿弧长匀速（speedFrac 为"每秒走过全长的比例"）
        const sPos = (built.seeds[o * 2] * total + t * speedFrac * total) % total
        path.sample(sPos, buf)
        const ph = built.seeds[o * 2 + 1]
        arr[o * 3] = buf[0] + Math.sin(t * 1.3 + ph) * wig
        arr[o * 3 + 1] = buf[1] + Math.sin(t * 1.7 + ph * 2.0) * (wig * 0.7)
        arr[o * 3 + 2] = buf[2] + Math.cos(t * 1.1 + ph) * wig
      }
    }
    posAttr.needsUpdate = true
  })

  if (debugEnabled() && hasFlag('noveil')) return null
  return <primitive object={built.points} />
}
