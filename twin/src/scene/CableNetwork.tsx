import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { APPROACH, COLLECTOR_CHAINS, FARM, SUBSTATION, terrainHeight } from './terrainUtil'
import { registerLineRes } from './turbine/holoParts'
import { rng } from '../state/simCore'

// ============================================================================
// 冰河集电网络 —— 串接集电拓扑（A8 工程修正版）
//
// 旧版问题：9 台机组各自放射直连升压站（home-run），不是真实集电系统。
// 现在：每列一串 —— 远排→中排→近排 串接后由一回集电干线汇入升压站
// （COLLECTOR_CHAINS，3 回集电线路，真实陆上风电场典型做法）；
// 外送 2 回 220kV 走向 APPROACH。视觉上保留“能量汇流”的冰河叙事。
//
// 工程修正：
//   · D3：脉冲/晶粒定位全部查 LUT（弧长均匀采样一次性烘焙），
//     逐帧不再 getPointAt；
//   · C1：线芯/微光/脉冲/晶粒 depthTest:true——跨山脊出线路径被正确遮挡；
//     屏幕空间等宽 + toneMapped:false 仍保证亮度视角无关；
//   · Line2 分辨率经统一注册表同步（D9，见 holoParts/LineResSync）；
//   · 所有随机排布使用确定性随机源 rng(seed)。
// ============================================================================

const C_CORE    = new THREE.Color(0.72, 0.92, 1.0)
const C_TRUNK   = new THREE.Color(0.85, 1.0, 1.0)
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

/** 沿曲线弧长均匀采样并贴地，返回 [x,y,z,...]（同时用作脉冲 LUT） */
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

  const built = useMemo(() => {
    const group = new THREE.Group()
    const rand = rng(20260827)

    // ------- 线材质：屏幕空间恒定宽度（单例级共享，分辨率统一注册） -------
    const matCore = new LineMaterial({
      color: C_CORE.getHex(),
      linewidth: 0.85,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      depthTest: true,
      fog: false,
      blending: THREE.NormalBlending,   // 核心线用正常混合，避免加色在亮处过曝
      dashed: false,
      alphaToCoverage: false,
    })
    const matTrunk = new LineMaterial({
      color: C_TRUNK.getHex(),
      linewidth: 1.8,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: true,
      fog: false,
      blending: THREE.NormalBlending,
      dashed: false,
      alphaToCoverage: false,
    })
    const matHalo = new LineMaterial({
      color: C_HALO.getHex(),
      linewidth: 2.2,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      depthTest: true,
      fog: false,
      blending: THREE.AdditiveBlending,
      dashed: false,
      alphaToCoverage: false,
    })
    matCore.toneMapped = false
    matTrunk.toneMapped = false
    matHalo.toneMapped = false
    registerLineRes(matCore)
    registerLineRes(matTrunk)
    registerLineRes(matHalo)

    const pulseMat = new THREE.MeshBasicMaterial({
      color: C_PULSE,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    })
    const pulseGeo = new THREE.SphereGeometry(0.55, 8, 8)

    interface CableSeg { lut: number[]; count: number; speed: number }
    const segs: CableSeg[] = []
    const glitterPos: number[] = []
    const glitterPhase: number[] = []

    /**
     * 铺一条电缆：pts 为 (x,z) 拐点的串接路径；trunk=干线（更亮更粗）。
     * LUT 化：沿线弧长均匀采样一次（含贴地），脉冲/晶粒全部查表。
     */
    const addCable = (xz: [number, number][], opts: { trunk?: boolean; pulseSpeed?: number; wanderSeed?: number } = {}) => {
      const N = Math.max(8, xz.length * 4)
      const pts: THREE.Vector3[] = []
      const ws = opts.wanderSeed ?? 0
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1)
        // 多段线性插值 + 蛇形微摆（自然架空走廊观感）
        const seg = t * (xz.length - 1)
        const k = Math.min(xz.length - 2, Math.floor(seg))
        const f = seg - k
        const [x0, z0] = xz[k]
        const [x1, z1] = xz[k + 1]
        const dx = x1 - x0, dz = z1 - z0
        const len = Math.max(1, Math.hypot(dx, dz))
        const px = -dz / len, pz = dx / len
        const wander = Math.sin(ws + t * 6.4) * 34 * Math.sin(t * Math.PI)
          + Math.sin(ws * 1.7 + t * 13.0) * 12 * Math.sin(t * Math.PI)
        const x = x0 + dx * f + px * wander
        const z = z0 + dz * f + pz * wander
        pts.push(new THREE.Vector3(x, hug(x, z), z))
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3)
      const lut = sampleCurve(curve)
      segs.push({ lut, count: lut.length / 3, speed: opts.pulseSpeed ?? 0.08 })

      // 微光边（在底，柔和抗锯齿/边缘辉）
      const haloLine = new Line2(buildLineGeom(lut), matHalo)
      haloLine.renderOrder = 1
      haloLine.frustumCulled = false
      group.add(haloLine)

      // 线芯（在上；干线用更亮更粗的 matTrunk）
      const coreLine = new Line2(buildLineGeom(lut), opts.trunk ? matTrunk : matCore)
      coreLine.renderOrder = 2
      coreLine.frustumCulled = false
      group.add(coreLine)

      // 沿路径布静态粒子（闪烁，确定性随机）
      const len = curve.getLength()
      const pDensity = Math.max(50, Math.floor(len / 5))
      const n = lut.length / 3
      for (let j = 0; j < pDensity; j++) {
        const fi = rand() * (n - 1)
        const i0 = Math.floor(fi)
        const i1 = Math.min(n - 1, i0 + 1)
        const ff = fi - i0
        const bx = lut[i0 * 3] + (lut[i1 * 3] - lut[i0 * 3]) * ff
        const bz = lut[i0 * 3 + 2] + (lut[i1 * 3 + 2] - lut[i0 * 3 + 2]) * ff
        const off = (rand() - 0.5) * 1.8
        const x = bx + off
        const z = bz + off * 0.6
        glitterPos.push(x, hug(x, z, rand() * 0.6), z)
        glitterPhase.push(rand())
      }
    }

    // ------- 串接集电：每列 远→中→近→升压站 -------
    COLLECTOR_CHAINS.forEach((chain, ci) => {
      const portX = SUBSTATION.x - 78 + ci * 46
      const portZ = SUBSTATION.z - 52 + ci * 34
      // 机间支线段（远→中、中→近）
      for (let s = 0; s < chain.length - 1; s++) {
        const a = FARM[chain[s]]
        const b = FARM[chain[s + 1]]
        addCable([[a.x, a.z], [b.x, b.z]], { pulseSpeed: 0.09, wanderSeed: ci * 7.3 + s * 2.9 })
      }
      // 集电干线：近排→升压站（全场最亮的三股能量流）
      const near = FARM[chain[chain.length - 1]]
      addCable(
        [[near.x, near.z], [near.x + (portX - near.x) * 0.5, near.z + (portZ - near.z) * 0.48], [portX, portZ]],
        { trunk: true, pulseSpeed: 0.12, wanderSeed: ci * 11.1 + 40 },
      )
    })

    // ------- 外送线束：2 回 220kV 主通道 -------
    const outRoutes = [{ k: -1.8 }, { k: 1.8 }]
    for (const { k } of outRoutes) {
      const sx = SUBSTATION.x + 62, sz = SUBSTATION.z + k * 22
      const ex = APPROACH.x,       ez = APPROACH.z + k * 60
      const mx1 = sx + (ex - sx) * 0.4, mz1 = sz + (ez - sz) * 0.38 + k * 18
      const mx2 = sx + (ex - sx) * 0.7, mz2 = sz + (ez - sz) * 0.72 + k * 12
      addCable([[sx, sz], [mx1, mz1], [mx2, mz2], [ex, ez]], { trunk: true, pulseSpeed: 0.14, wanderSeed: 90 + k })
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
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    })
    const glitter = new THREE.Points(gg, gm)
    glitter.renderOrder = 3
    glitter.frustumCulled = false
    group.add(glitter)

    const perCurve = 3
    return {
      group, segs, perCurve, pulseGeo, pulseMat,
      glitterMat: gm,
      total: segs.length * perCurve,
    }
  }, [])

  // 每帧：驱动脉冲（LUT 查表，不再 getPointAt）
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame((s) => {
    const t = s.clock.elapsedTime
    built.glitterMat.uniforms.uTime.value = t

    const im = pulses.current
    if (!im) return
    let k = 0
    for (let i = 0; i < built.segs.length; i++) {
      const seg = built.segs[i]
      const n = seg.count
      for (let j = 0; j < built.perCurve; j++) {
        const tt = (t * seg.speed + j / built.perCurve + i * 0.137) % 1
        const fi = tt * (n - 1)
        const i0 = Math.floor(fi)
        const i1 = Math.min(n - 1, i0 + 1)
        const f = fi - i0
        const x = seg.lut[i0 * 3] + (seg.lut[i1 * 3] - seg.lut[i0 * 3]) * f
        const y = seg.lut[i0 * 3 + 1] + (seg.lut[i1 * 3 + 1] - seg.lut[i0 * 3 + 1]) * f
        const z = seg.lut[i0 * 3 + 2] + (seg.lut[i1 * 3 + 2] - seg.lut[i0 * 3 + 2]) * f
        const fade = Math.sin(tt * Math.PI)
        const sc = 0.55 + 0.5 * fade
        dummy.position.set(x, y + 0.4, z)
        dummy.scale.setScalar(sc)
        dummy.updateMatrix()
        im.setMatrixAt(k++, dummy.matrix)
      }
    }
    im.instanceMatrix.needsUpdate = true
  })

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
