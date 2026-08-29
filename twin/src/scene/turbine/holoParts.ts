import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { getTurbineGeos, PERIM, TURBINE_SPEC as S } from './geometry'

// ============================================================================
// 全息线稿装配包（静态合并几何 + 共享材质）
//
// D4 修复：原版每机 ~20 零件 × 3-4 层 ≈ 62 draw calls（9 机 ≈ 558）。
// 本包把「静止件」（塔筒/法兰/机舱/舱门/偏航板/风速仪）的边线、肋线、
// 能量壳分别合并成一套几何；「转子件」（三叶+轮毂+导流罩）合并成另一套
// （顶点烘在旋转系内，正常旋转）。每机 draw calls ≈ 13，9 机 ≈ 120。
//
// C4 修复：光晕不再用「同批边外扩 1.2% 重画」（会重影/发胖），改用 Line2
// 屏幕空间等宽加色双 pass（3.2px / 8px）——距离无关、无几何错位。
// 材质全部模块级单例共享；Line2 分辨率经 lineRes 注册表统一同步。
// ============================================================================

// ---------- Line2 分辨率注册表（App 里挂一个 LineResSync 统一更新） ----------
const RES_MATS: LineMaterial[] = []
export function registerLineRes(m: LineMaterial) {
  if (!RES_MATS.includes(m)) RES_MATS.push(m)
}
export function syncLineRes(w: number, h: number) {
  for (const m of RES_MATS) m.resolution.set(w, h)
}

// ---------- 色票 ----------
const HOLO_PURE = new THREE.Color(1.0, 1.0, 1.0)
const HOLO_GLOW = new THREE.Color(0.82, 0.97, 1.0)

// ---------- 共享材质（单例） ----------
const SHELL_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal   = normalize(normalMatrix * normal);
  vView     = normalize(-mv.xyz);
  vLocal    = position;
  gl_Position = projectionMatrix * mv;
}
`
const SHELL_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
uniform float uTime;
void main() {
  float facing  = max(dot(normalize(vNormal), normalize(vView)), 0.0);
  float fresnel = pow(1.0 - facing, 3.0);
  float scanA = 0.5 + 0.5 * sin(vLocal.y * 0.22 - uTime * 1.6);
  float scanB = 0.5 + 0.5 * sin((vLocal.y + vLocal.z * 0.6) * 0.9 - uTime * 2.8);
  float scan  = scanA * 0.45 + scanB * 0.22;
  float flicker = 0.88 + 0.12 * sin(uTime * 9.3 + vLocal.x * 13.7 + vLocal.z * 7.1);
  float alpha = fresnel * (0.18 + scan * 0.10) * flicker;
  vec3 col = mix(vec3(0.75, 0.95, 1.0), vec3(1.0), facing);
  gl_FragColor = vec4(col, alpha);
}
`

export interface HoloMats {
  shell: THREE.ShaderMaterial
  core: THREE.LineBasicMaterial
  rib: THREE.LineBasicMaterial
  glowA: LineMaterial
  glowB: LineMaterial
  beacon: THREE.MeshBasicMaterial
  disc: THREE.MeshBasicMaterial
  ring: THREE.MeshBasicMaterial
  ringAlert: THREE.MeshBasicMaterial
}

let matsCache: HoloMats | null = null
export function getHoloMats(): HoloMats {
  if (matsCache) return matsCache
  const shell = new THREE.ShaderMaterial({
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    depthTest: true, // C1 修复：全息层也吃真实深度，远景不再透过山体
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  })
  const core = new THREE.LineBasicMaterial({
    color: HOLO_PURE,
    transparent: false,
    linewidth: 1,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    blending: THREE.NormalBlending,
  })
  const rib = new THREE.LineBasicMaterial({
    color: HOLO_PURE,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  })
  // Line2 屏幕空间等宽光晕（替代几何外扩，杜绝重影）
  const glowA = new LineMaterial({
    color: HOLO_GLOW.getHex(),
    linewidth: 3.2,
    transparent: true,
    opacity: 0.30,
    depthWrite: false,
    depthTest: true,
    fog: false,
    blending: THREE.AdditiveBlending,
    dashed: false,
    alphaToCoverage: false,
  })
  const glowB = new LineMaterial({
    color: new THREE.Color(0.35, 0.75, 1.0).getHex(),
    linewidth: 8.0,
    transparent: true,
    opacity: 0.10,
    depthWrite: false,
    depthTest: true,
    fog: false,
    blending: THREE.AdditiveBlending,
    dashed: false,
    alphaToCoverage: false,
  })
  glowA.toneMapped = false
  glowB.toneMapped = false
  registerLineRes(glowA)
  registerLineRes(glowB)
  const beacon = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.7, 1.6, 2.0),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  })
  const disc = new THREE.MeshBasicMaterial({
    color: '#010408',
    transparent: true,
    opacity: 0.66, // C2 收敛：黑盘不再像井盖（原 0.82 / r16）
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
  const ring = new THREE.MeshBasicMaterial({
    color: HOLO_PURE,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
  const ringAlert = ring.clone()
  ringAlert.color = new THREE.Color('#ff5f6b')
  matsCache = { shell, core, rib, glowA, glowB, beacon, disc, ring, ringAlert }
  return matsCache
}

// ---------- 合并工具 ----------
type Item = { g: THREE.BufferGeometry; m: THREE.Matrix4; edge: number }

const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z)
const RX = (a: number) => new THREE.Matrix4().makeRotationX(a)
const RZ = (a: number) => new THREE.Matrix4().makeRotationZ(a)
const SC = (x: number, y: number, z: number) => new THREE.Matrix4().makeScale(x, y, z)

/** 边线（EdgesGeometry threshold°）按矩阵烘焙并合并为线段顶点数组 */
function mergeEdges(items: Item[]): Float32Array {
  const chunks: Float32Array[] = []
  let total = 0
  for (const it of items) {
    const eg = new THREE.EdgesGeometry(it.g, it.edge)
    eg.applyMatrix4(it.m)
    const arr = eg.getAttribute('position').array as Float32Array
    chunks.push(arr)
    total += arr.length
    eg.dispose()
  }
  const out = new Float32Array(total)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

/** 网格壳（三角面）合并：非索引化 + 法线正确变换 */
function mergeShells(items: Item[]): THREE.BufferGeometry {
  const pos: number[] = []
  const nor: number[] = []
  for (const it of items) {
    const g = it.g.index ? it.g.toNonIndexed() : it.g
    const gg = g === it.g ? g.clone() : g
    gg.applyMatrix4(it.m)
    pos.push(...(gg.getAttribute('position').array as Float32Array))
    nor.push(...(gg.getAttribute('normal').array as Float32Array))
    gg.dispose()
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  return geo
}

const lineGeo = (arr: Float32Array) => {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  return g
}

const fatLineGeo = (arr: Float32Array) => {
  const g = new LineGeometry()
  g.setPositions(arr)
  return g
}

// ---------- 肋线（展向截面环 + 跨度向梁线；静态=塔筒，转子=叶片×3） ----------
function towerRibsPos(): Float32Array {
  // 与 geometry.ts 新塔筒廓线一致（底径 6.0）
  const profile: [number, number][] = [
    [3.0, -0.6], [3.0, 0.0], [2.98, 0.8], [2.92, 3.5], [2.4675, 43.8], [1.99, 84.5], [1.935, 87.6],
  ]
  const radiusAt = (y: number) => {
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, y0] = profile[i]
      const [r1, y1] = profile[i + 1]
      if (y <= y1) return r0 + (r1 - r0) * ((y - y0) / (y1 - y0))
    }
    return profile[profile.length - 1][0]
  }
  const out: number[] = []
  const RINGS = 18, SEG = 48, SPARS = 12, STEPS = 60
  for (let r = 0; r < RINGS; r++) {
    const y = -0.6 + ((87.6 + 0.6) * r) / (RINGS - 1)
    const rad = radiusAt(y)
    for (let j = 0; j < SEG; j++) {
      const a0 = (j / SEG) * Math.PI * 2, a1 = ((j + 1) / SEG) * Math.PI * 2
      out.push(Math.cos(a0) * rad, y, Math.sin(a0) * rad, Math.cos(a1) * rad, y, Math.sin(a1) * rad)
    }
  }
  for (let k = 0; k < SPARS; k++) {
    const a = (k / SPARS) * Math.PI * 2
    const cx = Math.cos(a), cz = Math.sin(a)
    for (let i = 0; i < STEPS - 1; i++) {
      const y0 = -0.6 + ((87.6 + 0.6) * i) / (STEPS - 1)
      const y1 = -0.6 + ((87.6 + 0.6) * (i + 1)) / (STEPS - 1)
      out.push(cx * radiusAt(y0), y0, cz * radiusAt(y0), cx * radiusAt(y1), y1, cz * radiusAt(y1))
    }
  }
  return new Float32Array(out)
}

/** 单支叶片（模板朝向）的肋线（环 + 梁线），之后再按 ×3 旋转烘焙 */
function bladeRibsOnce(): { rings: Float32Array; spars: Float32Array } {
  const blade = getTurbineGeos().blade
  const pos = blade.getAttribute('position') as THREE.BufferAttribute
  const NS = 18
  const rings: number[] = []
  for (let s = 0; s < NS; s += 2) {
    for (let j = 0; j < PERIM; j++) {
      const a = s * PERIM + j, b = s * PERIM + ((j + 1) % PERIM)
      rings.push(pos.getX(a), pos.getY(a), pos.getZ(a), pos.getX(b), pos.getY(b), pos.getZ(b))
    }
  }
  // 前缘 j=19/20、后缘 j=0(=39) 与两条弧面梁线
  const spars: number[] = []
  for (const j of [0, 10, 19, 20, 30, 39]) {
    for (let s = 0; s < NS - 1; s++) {
      const a = s * PERIM + j, b = (s + 1) * PERIM + j
      spars.push(pos.getX(a), pos.getY(a), pos.getZ(a), pos.getX(b), pos.getY(b), pos.getZ(b))
    }
  }
  return { rings: new Float32Array(rings), spars: new Float32Array(spars) }
}

function xformArr(arr: Float32Array, m: THREE.Matrix4): Float32Array {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(arr.slice(), 3))
  g.applyMatrix4(m)
  return g.getAttribute('position').array as Float32Array
}

// ---------- 装配包 ----------
export interface HoloKit {
  staticShell: THREE.BufferGeometry
  staticCore: THREE.BufferGeometry
  staticRibs: THREE.BufferGeometry
  staticGlowA: THREE.BufferGeometry // Line2 用（同 core 顶点）
  staticGlowB: THREE.BufferGeometry
  rotorShell: THREE.BufferGeometry
  rotorCore: THREE.BufferGeometry
  rotorRibs: THREE.BufferGeometry
  rotorGlowA: THREE.BufferGeometry
  rotorGlowB: THREE.BufferGeometry
  beacon: THREE.BufferGeometry
}

let kitCache: HoloKit | null = null
export function getHoloKit(): HoloKit {
  if (kitCache) return kitCache
  const G = getTurbineGeos()

  // —— 静止件（坐标=机组根坐标系） ——
  const statics: Item[] = [
    { g: G.tower, m: T(0, 0, 0), edge: 28 },
    { g: G.flange1, m: T(0, 0, 0), edge: 25 },
    { g: G.flange2, m: T(0, 0, 0), edge: 25 },
    { g: G.door, m: T(0, 2.0, -2.92), edge: 18 },
    { g: G.yawPlate, m: T(0, S.towerTop + 0.5, S.nacelleZ * 0.4), edge: 25 },
    { g: G.nacelle, m: T(0, S.hubY - 0.4, S.nacelleZ), edge: 20 },
    { g: G.nacelleTail, m: T(0, S.hubY - 0.6, S.nacelleZ - 8.6), edge: 20 },
    { g: G.door, m: T(0, S.hubY - 0.5, S.nacelleZ - 10.6).multiply(SC(1.5, 1.1, 1)), edge: 18 },
    { g: G.anemo, m: T(0, S.hubY + 3.1, S.nacelleZ - 0.2), edge: 25 },
  ]
  const staticCorePos = mergeEdges(statics)
  const staticRibsPos = towerRibsPos()

  // —— 转子件（坐标=旋转系：spin 组内，旋转轴=z） ——
  const coneRad = THREE.MathUtils.degToRad(S.coneDeg)
  const rotors: Item[] = [
    { g: G.hub, m: T(0, 0, -1.4).multiply(RX(Math.PI / 2)), edge: 25 },
    { g: G.spinner, m: T(0, 0, -0.4).multiply(RX(Math.PI / 2)), edge: 28 },
  ]
  for (let i = 0; i < 3; i++) {
    rotors.push({ g: G.blade, m: RZ((i * Math.PI * 2) / 3).multiply(RX(coneRad)), edge: 6 })
  }
  const rotorCorePos = mergeEdges(rotors)
  // 转子肋线：三叶片肋线按相同旋转烘焙
  const { rings, spars } = bladeRibsOnce()
  const ribChunks: Float32Array[] = []
  for (let i = 0; i < 3; i++) {
    const m = RZ((i * Math.PI * 2) / 3).multiply(RX(coneRad))
    ribChunks.push(xformArr(rings, m), xformArr(spars, m))
  }
  const rotorRibsPos = new Float32Array(ribChunks.reduce((s, c) => s + c.length, 0))
  {
    let o = 0
    for (const c of ribChunks) { rotorRibsPos.set(c, o); o += c.length }
  }

  kitCache = {
    staticShell: mergeShells(statics),
    staticCore: lineGeo(staticCorePos),
    staticRibs: lineGeo(staticRibsPos),
    staticGlowA: fatLineGeo(staticCorePos),
    staticGlowB: fatLineGeo(staticCorePos),
    rotorShell: mergeShells(rotors),
    rotorCore: lineGeo(rotorCorePos),
    rotorRibs: lineGeo(rotorRibsPos),
    rotorGlowA: fatLineGeo(rotorCorePos),
    rotorGlowB: fatLineGeo(rotorCorePos),
    beacon: G.beacon,
  }
  return kitCache
}
