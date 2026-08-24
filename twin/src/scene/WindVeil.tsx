import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, terrainHeight } from './terrainUtil'

// W6 风幕粒子：两半部 —— ① 远丘上空的"银河弧带"扫掠 ② 穿过机组的来流流线
// CPU 对流更新，点云单色青白，呈基准图标志性的粒子弧幕
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

export default function WindVeil() {
  const ref = useRef<THREE.Points>(null!)
  const matRef = useRef<THREE.ShaderMaterial>(null!)

  const built = useMemo(() => {
    const streams: { curve: THREE.CatmullRomCurve3; count: number; speed: number; size: number; bright: number }[] = []

    // ① 银河弧带：三条平行弧，从左后丘顶扫向右后方（基准图上中部粒子弧幕）
    for (let k = 0; k < 3; k++) {
      const pts: THREE.Vector3[] = []
      const n = 9
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1)
        const x = -1250 + t * 2450 + Math.sin(t * 5.2 + k) * 90 + (k - 1) * 60
        const z = -880 + Math.sin(t * 3.1 + k * 0.9) * 150 + t * 300 + (k - 1) * 70
        const y = terrainHeight(x, z) + 10 + Math.sin(t * Math.PI) * (30 + k * 11) + k * 9
        pts.push(new THREE.Vector3(x, y, z))
      }
      streams.push({ curve: curveFrom(pts), count: 640, speed: 0.011 + k * 0.002, size: 5.0, bright: 1.0 })
    }

    // ② 来流流线：北 → 南南东，纵向穿过机组排（呼应偏航尾流叙事）
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
      streams.push({ curve: curveFrom(pts), count: 64, speed: 0.045, size: 2.7, bright: 0.8 })
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
    // 曲线元数据另存
    const curves = streams.map((s) => ({ curve: s.curve, count: s.count, speed: s.speed }))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
    g.setAttribute('aBright', new THREE.BufferAttribute(aBright, 1))
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uColor: { value: new THREE.Color('#7fd2f2') } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    matRef.current = m
    const p = new THREE.Points(g, m)
    p.frustumCulled = false
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
        arr[o * 3] = tmp.x + Math.sin(t * 1.3 + ph) * 7.5
        arr[o * 3 + 1] = tmp.y + Math.sin(t * 1.7 + ph * 2.0) * 5.5
        arr[o * 3 + 2] = tmp.z + Math.cos(t * 1.1 + ph) * 7.5
      }
    }
    posAttr.needsUpdate = true
  })

  return <primitive object={built.points} ref={ref} />
}
