import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { APPROACH, FARM, SUBSTATION, terrainHeight } from './terrainUtil'

const C_CABLE = new THREE.Color(0.30, 0.98, 1.38)
const C_RIBBON = new THREE.Color(0.20, 0.72, 1.05)
const C_PULSE = new THREE.Color(1.05, 1.8, 2.2)
const C_GLITTER = new THREE.Color(0.75, 1.5, 1.85)

const GL_VERT = /* glsl */ `
attribute float aPhase;
varying float vA;
uniform float uTime;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vA = 0.4 + 0.6 * (0.5 + 0.5 * sin(uTime * 2.1 + aPhase * 34.0));
  gl_PointSize = 2.6 * (380.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`
const GL_FRAG = /* glsl */ `
precision highp float;
varying float vA;
uniform vec3 uColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(uColor * 1.5, smoothstep(0.5, 0.1, d) * vA);
}
`

function hug(x: number, z: number, lift = 1.3) {
  return terrainHeight(x, z) + lift
}

// W8 冰河集电：贴地电缆河 + 河床辉光 + 晶粒 + 流动脉冲 + 外送线束（基准图 W8/W10）
export default function CableNetwork() {
  const pulses = useRef<THREE.InstancedMesh>(null!)

  const built = useMemo(() => {
    const group = new THREE.Group()
    const cableMat = new THREE.MeshBasicMaterial({ color: C_CABLE, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    const ribbonMat = new THREE.MeshBasicMaterial({ color: C_RIBBON, transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
    const beamMat = new THREE.MeshBasicMaterial({ color: C_CABLE, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    const pulseMat = new THREE.MeshBasicMaterial({ color: C_PULSE, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    const pulseGeo = new THREE.SphereGeometry(1.9, 8, 8)

    const centerCurves: THREE.CatmullRomCurve3[] = []
    const glitterPos: number[] = []
    const glitterPhase: number[] = []

    // ---- 每台机组：蛇形集电路径 → 升压站 ----
    FARM.forEach((u, idx) => {
      const sx = u.x, sz = u.z
      const ex = SUBSTATION.x - 78 + (idx % 3) * 46
      const ez = SUBSTATION.z - 52 + Math.floor(idx / 3) * 40
      const dx = ex - sx, dz = ez - sz
      const len = Math.hypot(dx, dz)
      const px = -dz / len, pz = dx / len // 垂直向
      const pts: THREE.Vector3[] = []
      const n = 8
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1)
        const wander = Math.sin(idx * 2.3 + t * 6.4) * 46 * Math.sin(t * Math.PI)
          + Math.sin(idx * 5.1 + t * 13.0) * 16 * Math.sin(t * Math.PI)
        const x = sx + dx * t + px * wander
        const z = sz + dz * t + pz * wander
        pts.push(new THREE.Vector3(x, hug(x, z, 1.3), z))
      }
      const center = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.32)
      centerCurves.push(center)

      // 三股电缆束
      for (let s = -1; s <= 1; s++) {
        const sp: THREE.Vector3[] = []
        const m = 9
        for (let i = 0; i < m; i++) {
          const t = i / (m - 1)
          const c = center.getPoint(t)
          const tan = center.getTangent(t)
          const ox = -tan.z * s * 2.3, oz = tan.x * s * 2.3
          sp.push(new THREE.Vector3(c.x + ox, hug(c.x + ox, c.z + oz, 1.25 - Math.abs(s) * 0.1), c.z + oz))
        }
        const cg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sp, false, 'catmullrom', 0.3), 90, 0.62, 6, false)
        const mesh = new THREE.Mesh(cg, cableMat)
        group.add(mesh)
      }

      // 河床辉光条带（贴地投影）
      const SEG = 72, HALF = 5.0
      const vpos = new Float32Array((SEG + 1) * 2 * 3)
      const vidx: number[] = []
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG
        const c = center.getPoint(t)
        const tan = center.getTangent(t)
        const nx = -tan.z, nz = tan.x
        const x1 = c.x + nx * HALF, z1 = c.z + nz * HALF
        const x2 = c.x - nx * HALF, z2 = c.z - nz * HALF
        const o = i * 6
        vpos[o] = x1; vpos[o + 1] = hug(x1, z1, 0.7); vpos[o + 2] = z1
        vpos[o + 3] = x2; vpos[o + 4] = hug(x2, z2, 0.7); vpos[o + 5] = z2
        if (i < SEG) {
          const a = i * 2
          vidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
      }
      const rg = new THREE.BufferGeometry()
      rg.setAttribute('position', new THREE.BufferAttribute(vpos, 3))
      rg.setIndex(vidx)
      group.add(new THREE.Mesh(rg, ribbonMat))

      // 沿途晶粒
      for (let j = 0; j < 90; j++) {
        const t = Math.random()
        const c = center.getPoint(t)
        const jit = 7
        const x = c.x + (Math.random() - 0.5) * jit * 2
        const z = c.z + (Math.random() - 0.5) * jit * 2
        glitterPos.push(x, hug(x, z, 1.0 + Math.random() * 2.2), z)
        glitterPhase.push(Math.random())
      }
    })

    // ---- 外送线束：升压站 → 画面右下角（进线方向）----
    const beamCurves: THREE.CatmullRomCurve3[] = []
    for (let k = -2; k <= 2; k++) {
      const sx = SUBSTATION.x + 62, sz = SUBSTATION.z + k * 16
      const ex = APPROACH.x, ez = APPROACH.z + k * 85
      const mx1 = sx + (ex - sx) * 0.35, mz1 = sz + (ez - sz) * 0.42 + k * 10
      const mx2 = sx + (ex - sx) * 0.72, mz2 = sz + (ez - sz) * 0.8 + k * 14
      const pts = [
        new THREE.Vector3(sx, hug(sx, sz, 2.4), sz),
        new THREE.Vector3(mx1, hug(mx1, mz1, 2.0), mz1),
        new THREE.Vector3(mx2, hug(mx2, mz2, 1.8), mz2),
        new THREE.Vector3(ex, hug(ex, ez, 1.6), ez),
      ]
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.25)
      beamCurves.push(curve)
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.78, 6, false), beamMat))
    }

    // ---- 晶粒点云合一 ----
    const gg = new THREE.BufferGeometry()
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(glitterPos), 3))
    gg.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(glitterPhase), 1))
    const gm = new THREE.ShaderMaterial({
      vertexShader: GL_VERT, fragmentShader: GL_FRAG,
      uniforms: { uTime: { value: 0 }, uColor: { value: C_GLITTER } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    const glitter = new THREE.Points(gg, gm)
    glitter.frustumCulled = false
    group.add(glitter)

    const allCurves = [...centerCurves, ...beamCurves]
    const perCurve = 5
    return { group, allCurves, perCurve, pulseGeo, pulseMat, glitterMat: gm, total: allCurves.length * perCurve }
  }, [])

  useEffect(() => () => {
    built.group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
    })
  }, [built])

  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame((s) => {
    const im = pulses.current
    const t = s.clock.elapsedTime
    built.glitterMat.uniforms.uTime.value = t
    if (!im) return
    let k = 0
    for (let i = 0; i < built.allCurves.length; i++) {
      const c = built.allCurves[i]
      const beam = i >= FARM.length
      for (let j = 0; j < built.perCurve; j++) {
        const tt = (t * (beam ? 0.16 : 0.075) + j / built.perCurve + i * 0.037) % 1
        const p = c.getPoint(tt)
        dummy.position.set(p.x, p.y + 0.5, p.z)
        dummy.scale.setScalar(0.8 + 0.3 * Math.sin(tt * Math.PI * 2 + j))
        dummy.updateMatrix()
        im.setMatrixAt(k++, dummy.matrix)
      }
    }
    im.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <primitive object={built.group} />
      <instancedMesh ref={pulses} args={[built.pulseGeo, built.pulseMat, built.total]} frustumCulled={false} />
    </group>
  )
}
