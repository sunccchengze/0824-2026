import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, terrainHeight } from './terrainUtil'

// ===========================================================================
// W6 风况粒子（v2 · 语义修正）
// ---------------------------------------------------------------------------
// 旧版问题：三条"银河弧带"沿 x 向横穿第二排风机、贴地仅 10~60m——看起来像一股
// 方向错误的风；且材质开着深度测试，被山体一挡"换个角度就消失"。
//
// 现在全场风只有一种语义：主导风向 = 北 → 南（微偏东），与机组【列向】一致：
//   ① 远脊来流 —— 北岭后高空(y 500~820)沿同一风向南下，透视收缩成一束束从
//      山脊后涌来的微光；距离远、亮度低，只做纵深氛围，不与机组争抢。
//   ② 列向来流 —— 近场 11 条流线沿 z 向依次穿过远/中/近三排（尾流叙事），
//      途经机组轻微绕流。
//
// 材质遵循全息层统一规则：depthTest:false / depthWrite:false / fog:false /
// toneMapped:false + AdditiveBlending —— 任意视角、任意山体遮挡下亮度恒定。
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

// 调试开关：?noveil=1 时整个风况粒子层不渲染（截图对比/粒子归属定位用）
const NOVEIL = typeof location !== 'undefined' && new URLSearchParams(location.search).has('noveil')

export default function WindVeil() {
  const matRef = useRef<THREE.ShaderMaterial>(null!)
  const built = useMemo(() => {
    const streams: Stream[] = []

    // ① 远脊来流：北岭后高空，沿主导风向（北→南、微偏东）南下。
    //    透视上收缩为山脊后涌出的细碎光带，与 ② 的近场流线首尾呼应。
    for (let k = 0; k < 6; k++) {
      const pts: THREE.Vector3[] = []
      const n = 8
      const x0 = -1520 + k * 600 + Math.sin(k * 2.7) * 90
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1)
        const z = -3380 + t * 1620 // -3380 → -1760，止于远排之后
        const x = x0 + t * 280 + Math.sin(t * 3.0 + k * 1.3) * 90
        const y = 700 - t * 180 + Math.sin(t * Math.PI) * 55 + k * 26
        pts.push(new THREE.Vector3(x, y, z))
      }
      streams.push({ curve: curveFrom(pts), count: 300, speed: 0.028, size: 11, bright: 0.5, wig: 13 })
    }

    // ② 列向来流：北 → 南南东，沿机组列向穿过三排（呼应偏航尾流叙事）
    const laneXs = [-640, -480, -330, -190, -60, 70, 200, 330, 470, 610, 750]
    laneXs.forEach((lx, li) => {
      const pts: THREE.Vector3[] = []
      const n = 8
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1)
        const z = -1500 + t * 2100
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
        seeds[o * 2] = Math.random()
        seeds[o * 2 + 1] = Math.random() * Math.PI * 2
        aSize[o] = st.size * (0.45 + Math.random() * 1.55)
        aBright[o] = st.bright * (0.35 + Math.random() * 0.65)
        o++
      }
    }
    const curves = streams.map((s) => ({
      curve: s.curve, count: s.count, speed: s.speed, wig: s.wig,
    }))
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
    matRef.current = m
    const p = new THREE.Points(g, m)
    p.frustumCulled = false
    p.renderOrder = 2
    return { points: p, curves, seeds }
  }, [])

  useEffect(() => () => {
    built.points.geometry.dispose()
    ;(built.points.material as THREE.Material).dispose()
  }, [built])

  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame((s) => {
    const t = s.clock.elapsedTime
    const posAttr = built.points.geometry.attributes.position as THREE.BufferAttribute
    const arr = posAttr.array as Float32Array
    let o = 0
    for (const c of built.curves) {
      for (let j = 0; j < c.count; j++, o++) {
        const tt = (built.seeds[o * 2] + t * c.speed) % 1
        c.curve.getPoint(tt, tmp)
        const ph = built.seeds[o * 2 + 1]
        arr[o * 3] = tmp.x + Math.sin(t * 1.3 + ph) * c.wig
        arr[o * 3 + 1] = tmp.y + Math.sin(t * 1.7 + ph * 2.0) * (c.wig * 0.7)
        arr[o * 3 + 2] = tmp.z + Math.cos(t * 1.1 + ph) * c.wig
      }
    }
    posAttr.needsUpdate = true
  })

  if (NOVEIL) return null
  return <primitive object={built.points} />
}
