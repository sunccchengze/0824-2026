import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { APPROACH, FARM, SUBSTATION, terrainHeight } from './terrainUtil'

// ============================================================================
// 冰河集电网络 —— 纤细线芯 + 流动粒子
//
// 设计：
//   · 只有两层线：极细的冷白芯 + 更细的微光边（柔和锯齿），没有粗辉光；
//   · 没有三股绞线、没有河床条带（那是让它像灯管的元凶）；
//   · 外送线从 5 根扇骨收成 2 根，避免远看变成一排灯管；
//   · 亮度交给流动脉冲 + 沿途粒子点云承担——粒子在流动，是"活"的；
//   · 所有材质 depthTest:false / toneMapped:false / fog:false，
//     配合 Line2 的屏幕空间等宽，保证从任何视角看粗细亮度都一致。
// ============================================================================

const C_CORE    = new THREE.Color(0.72, 0.92, 1.0)
const C_HALO    = new THREE.Color(0.25, 0.62, 0.95)
const C_PULSE   = new THREE.Color(0.85, 1.5, 2.0)
const C_GLITTER = new THREE.Color(0.45, 0.85, 1.15)

// ------- 晶粒/粒子点云 shader -------
const GL_VERT = /* glsl */ `
attribute float aPhase;
varying float vA;
uniform float uTime;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // 呼吸 + 轻微闪烁
  float tw = 0.55 + 0.45 * sin(uTime * 1.6 + aPhase * 22.0);
  vA = tw;
  gl_PointSize = 2.2 * (380.0 / max(-mv.z, 180.0));
  gl_Position = projectionMatrix * mv;
}
`
const GL_FRAG = /* glsl */ `
precision highp float;
varying float vA;
uniform vec3 uColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vA;
  gl_FragColor = vec4(uColor, a);
}
`

const LIFT = 2.6

function hug(x: number, z: number, extra = 0) {
  return terrainHeight(x, z) + LIFT + extra
}

/** 沿曲线弧长均匀采样，返回 [x,y,z,...] */
function sampleCurve(curve: THREE.CatmullRomCurve3, extraLift = 0): number[] {
  const totalLen = curve.getLength()
  const n = Math.max(120, Math.ceil(totalLen / 3.5))
  const arr: number[] = new Array(n * 3)
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const p = curve.getPointAt(t)
    arr[i * 3]     = p.x
    arr[i * 3 + 1] = hug(p.x, p.z, extraLift)
    arr[i * 3 + 2] = p.z
  }
  return arr
}

function buildLineGeom(points: number[]): LineGeometry {
  const g = new LineGeometry()
  g.setPositions(points)
  return g
}

export default function CableNetwork() {
  const pulses = useRef<THREE.InstancedMesh>(null!)
  const { size } = useThree()

  const built = useMemo(() => {
    const group = new THREE.Group()

    // ------- 线材质：屏幕空间恒定宽度 -------
    const matCore = new LineMaterial({
      color: C_CORE.getHex(),
      linewidth: 0.85,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false as any,
      blending: THREE.NormalBlending,   // 核心线用正常混合，避免加色在亮处过曝
    })
    const matHalo = new LineMaterial({
      color: C_HALO.getHex(),
      linewidth: 2.2,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false as any,
      blending: THREE.AdditiveBlending,
    })

    // 脉冲材质：小小的光球，加色
    const pulseMat = new THREE.MeshBasicMaterial({
      color: C_PULSE,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    })
    const pulseGeo = new THREE.SphereGeometry(0.55, 8, 8)

    const allCurves: THREE.CatmullRomCurve3[] = []
    const glitterPos: number[] = []
    const glitterPhase: number[] = []
    const pulseSpeeds: number[] = []

    const addCable = (pts: THREE.Vector3[], opts: { pulseSpeed?: number } = {}) => {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3)
      allCurves.push(curve)
      pulseSpeeds.push(opts.pulseSpeed ?? 0.08)

      const pos = sampleCurve(curve)

      // 微光边（在底，柔和抗锯齿/边缘辉）
      const haloLine = new Line2(buildLineGeom(pos), matHalo)
      haloLine.renderOrder = 1
      haloLine.frustumCulled = false
      group.add(haloLine)

      // 线芯（在上）
      const coreLine = new Line2(buildLineGeom(pos), matCore)
      coreLine.renderOrder = 2
      coreLine.frustumCulled = false
      group.add(coreLine)

      // 沿路径布静态粒子（闪烁）
      const len = curve.getLength()
      const pDensity = Math.max(50, Math.floor(len / 5))
      for (let j = 0; j < pDensity; j++) {
        const t = Math.random()
        const p = curve.getPointAt(t)
        const tan = curve.getTangentAt(t)
        const nx = -tan.z, nz = tan.x
        const off = (Math.random() - 0.5) * 1.8
        const x = p.x + nx * off
        const z = p.z + nz * off
        glitterPos.push(x, hug(x, z, Math.random() * 0.6), z)
        glitterPhase.push(Math.random())
      }
    }

    // ------- 每台机组 → 升压站 -------
    FARM.forEach((u, idx) => {
      const sx = u.x, sz = u.z
      const ex = SUBSTATION.x - 78 + (idx % 3) * 46
      const ez = SUBSTATION.z - 52 + Math.floor(idx / 3) * 40
      const dx = ex - sx, dz = ez - sz
      const len = Math.hypot(dx, dz)
      const px = -dz / len, pz = dx / len

      const N = 14
      const pts: THREE.Vector3[] = []
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1)
        const wander = Math.sin(idx * 2.3 + t * 6.4) * 46 * Math.sin(t * Math.PI)
          + Math.sin(idx * 5.1 + t * 13.0) * 16 * Math.sin(t * Math.PI)
        const x = sx + dx * t + px * wander
        const z = sz + dz * t + pz * wander
        pts.push(new THREE.Vector3(x, hug(x, z), z))
      }
      addCable(pts, { pulseSpeed: 0.08 })
    })

    // ------- 外送线束：5 根扇骨 → 收成 2 根主通道 -------
    // 上沿：从升压站顶部出去偏上方一束
    // 下沿：从升压站侧面出去偏下方一束
    const outRoutes = [
      { k: -1.8 },
      { k:  1.8 },
    ]
    for (const { k } of outRoutes) {
      const sx = SUBSTATION.x + 62, sz = SUBSTATION.z + k * 22
      const ex = APPROACH.x,       ez = APPROACH.z + k * 60
      const mx1 = sx + (ex - sx) * 0.4, mz1 = sz + (ez - sz) * 0.38 + k * 18
      const mx2 = sx + (ex - sx) * 0.7, mz2 = sz + (ez - sz) * 0.72 + k * 12
      const pts = [
        new THREE.Vector3(sx,  hug(sx,  sz,  1.2), sz),
        new THREE.Vector3(mx1, hug(mx1, mz1, 0.8), mz1),
        new THREE.Vector3(mx2, hug(mx2, mz2, 0.4), mz2),
        new THREE.Vector3(ex,  hug(ex,  ez,  0.0), ez),
      ]
      addCable(pts, { pulseSpeed: 0.14 })
    }

    // ------- 粒子点云（沿线路布好的所有粒子） -------
    const gg = new THREE.BufferGeometry()
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(glitterPos), 3))
    gg.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(glitterPhase), 1))
    const gm = new THREE.ShaderMaterial({
      vertexShader: GL_VERT,
      fragmentShader: GL_FRAG,
      uniforms: { uTime: { value: 0 }, uColor: { value: C_GLITTER } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    })
    const glitter = new THREE.Points(gg, gm)
    glitter.renderOrder = 3
    glitter.frustumCulled = false
    group.add(glitter)

    // 每条线 2-3 个流动脉冲
    const perCurve = 3
    const lineMats = [matCore, matHalo]
    return {
      group, allCurves, perCurve, pulseGeo, pulseMat,
      glitterMat: gm, lineMats, pulseSpeeds,
      total: allCurves.length * perCurve,
    }
  }, [])

  // 每帧：更新 LineMaterial resolution + 驱动脉冲
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame((s) => {
    const t = s.clock.elapsedTime
    built.glitterMat.uniforms.uTime.value = t

    const dpr = s.viewport.dpr
    const w = size.width * dpr
    const h = size.height * dpr
    for (const m of built.lineMats) m.resolution.set(w, h)

    const im = pulses.current
    if (!im) return
    let k = 0
    for (let i = 0; i < built.allCurves.length; i++) {
      const c = built.allCurves[i]
      const speed = built.pulseSpeeds[i] ?? 0.08
      for (let j = 0; j < built.perCurve; j++) {
        const tt = (t * speed + j / built.perCurve + i * 0.137) % 1
        const p = c.getPointAt(tt)
        const x = p.x, z = p.z
        // 脉冲只在中段最亮，首尾淡入淡出
        const fade = Math.sin(tt * Math.PI)
        const s_ = 0.55 + 0.5 * fade
        dummy.position.set(x, hug(x, z, 0.4), z)
        dummy.scale.setScalar(s_)
        dummy.updateMatrix()
        im.setMatrixAt(k++, dummy.matrix)
      }
    }
    im.instanceMatrix.needsUpdate = true
  })

  useEffect(() => {
    const dpr = window.devicePixelRatio || 1
    const w = size.width * dpr
    const h = size.height * dpr
    for (const m of built.lineMats) m.resolution.set(w, h)
  }, [built, size])

  return (
    <group>
      <primitive object={built.group} />
      <instancedMesh
        ref={pulses}
        args={[built.pulseGeo, built.pulseMat, built.total]}
        frustumCulled={false}
        renderOrder={4}
      />
    </group>
  )
}
