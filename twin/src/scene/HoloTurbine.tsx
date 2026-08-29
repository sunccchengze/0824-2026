/* oxlint-disable react/immutability -- R3F 帧循环内 mutate uniforms/refs 为官方推荐模式（docs/08 D2 说明） */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  getTurbineGeos, TURBINE_SPEC as S, PERIM, STATIONS, TOWER_PROFILE, towerRadiusAtY,
} from './turbine/geometry'

// ============================================================================
// AEOLUS — 全息纯白线稿风机（v3：合批 + 物理朝向 + 状态语义）
//
// 本轮变更（对应 docs/07 评审条目）：
//  · A4     转子朝向修正：机头基向 = 朝北（-z）迎风，正偏航 = 方位向东。
//            与 WindVeil 北→南粒子流、farmSim 坐标约定三方一致。
//  · B8     转速 = f(风)：由演示物理层给出 6.9→12.1 rpm 真实转速域。
//  · C2     基座视觉收敛：黑盘 16m→11m / 环 29m→≤8.9m，"克制"回位。
//  · C4     Halo 外扩 1.012→1.006、不透明度 0.55→0.32，消除双线重影。
//  · D4     每机 ~11 draw call（静态 4 + 转子 4 + 基座 3），旧版 ~62/机。
//  · E4     状态语义：告警 = 红环急促呼吸（全场唯一非青，docs/04）；
//            限功率 = 幽蓝环；选中/舵机 = 外圈瞄准环。
//
// 亮度视角无关的既定口径（用户钦定）：core/halo 关闭深度测试与雾、
// toneMapping，纯白线在任何角度恒亮。远景穿山的纵深代价是该要求的
// 有意取舍，裁决记录在 docs/08 §C1。
// ============================================================================

const D2R = THREE.MathUtils.degToRad
const HOLO_PURE = new THREE.Color(1.0, 1.0, 1.0)
const HOLO_GLOW = new THREE.Color(0.82, 0.97, 1.0)
export const ALARM_RED = new THREE.Color('#ff5f6b')
export const DIM_BLUE = new THREE.Color('#3d5a74')

// ---------------------------------------------------------------------------
// 材质
// ---------------------------------------------------------------------------
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

function makeShellMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    depthTest: true, // 体积暗示层保留正确遮挡
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  })
}
function makeCoreLineMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: HOLO_PURE,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    blending: THREE.NormalBlending,
  })
}
function makeHaloLineMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: HOLO_GLOW,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  })
}
function makeRibMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: HOLO_PURE,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  })
}

// ---------------------------------------------------------------------------
// 合并几何构建（模块级一次，9 机共享）
// ---------------------------------------------------------------------------
interface PartDef {
  geo: THREE.BufferGeometry
  pos?: [number, number, number]
  rot?: [number, number, number]
  scl?: [number, number, number]
  edgeAngle?: number
}

function partMatrix(p: PartDef): THREE.Matrix4 {
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])))
  m.compose(new THREE.Vector3(...(p.pos ?? [0, 0, 0])), q, new THREE.Vector3(...(p.scl ?? [1, 1, 1])))
  return m
}

/** 只保留 position/normal 并施加矩阵（合批时规避 uv/索引差异） */
function prepShell(geo: THREE.BufferGeometry, mat: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone()
  const pos = g.getAttribute('position')
  const nrm = g.getAttribute('normal')
  const nPos = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3)
  const nNrm = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3)
  const v = new THREE.Vector3()
  const nm = new THREE.Matrix3().getNormalMatrix(mat)
  const nv = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mat)
    nPos.setXYZ(i, v.x, v.y, v.z)
    if (nrm) {
      nv.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize()
      nNrm.setXYZ(i, nv.x, nv.y, nv.z)
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', nPos)
  out.setAttribute('normal', nNrm)
  if (g !== geo) g.dispose()
  return out
}

/** EdgesGeometry → 应用矩阵；halo=true 时绕部件自身中心外扩 1.006 */
function prepEdges(geo: THREE.BufferGeometry, mat: THREE.Matrix4, angle: number, halo: boolean): THREE.BufferGeometry {
  const e = new THREE.EdgesGeometry(geo, angle)
  e.applyMatrix4(mat)
  if (halo) {
    e.computeBoundingSphere()
    const c = e.boundingSphere!.center
    const pos = e.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const k = 1.006
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = c.x + (arr[i] - c.x) * k
      arr[i + 1] = c.y + (arr[i + 1] - c.y) * k
      arr[i + 2] = c.z + (arr[i + 2] - c.z) * k
    }
    pos.needsUpdate = true
  }
  return e
}

function towerRibGeometries(): THREE.BufferGeometry[] {
  const y0 = TOWER_PROFILE[0][1]
  const y1 = TOWER_PROFILE[TOWER_PROFILE.length - 1][1]
  const N_RINGS = 16
  const SEG = 40
  const rings: number[] = []
  for (let r = 0; r < N_RINGS; r++) {
    const y = y0 + ((y1 - y0) * r) / (N_RINGS - 1)
    const rad = towerRadiusAtY(y)
    for (let j = 0; j < SEG; j++) {
      const a0 = (j / SEG) * Math.PI * 2
      const a1 = ((j + 1) / SEG) * Math.PI * 2
      rings.push(Math.cos(a0) * rad, y, Math.sin(a0) * rad, Math.cos(a1) * rad, y, Math.sin(a1) * rad)
    }
  }
  const rg = new THREE.BufferGeometry()
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rings, 3))
  const N_SPARS = 12
  const STEPS = 48
  const spars: number[] = []
  for (let k = 0; k < N_SPARS; k++) {
    const ang = (k / N_SPARS) * Math.PI * 2
    const cx = Math.cos(ang)
    const cz = Math.sin(ang)
    for (let i = 0; i < STEPS - 1; i++) {
      const ya = y0 + ((y1 - y0) * i) / (STEPS - 1)
      const yb = y0 + ((y1 - y0) * (i + 1)) / (STEPS - 1)
      const ra = towerRadiusAtY(ya)
      const rb = towerRadiusAtY(yb)
      spars.push(cx * ra, ya, cz * ra, cx * rb, yb, cz * rb)
    }
  }
  const sg = new THREE.BufferGeometry()
  sg.setAttribute('position', new THREE.Float32BufferAttribute(spars, 3))
  return [rg, sg]
}

/** 单叶片肋线（站位环 + 前后缘/梁线），再按矩阵复制到 3 个桨叶位 */
function bladeRibSet(mat: THREE.Matrix4): THREE.BufferGeometry[] {
  const bladeGeo = getTurbineGeos().blade
  const posAttr = bladeGeo.getAttribute('position') as THREE.BufferAttribute
  const NS = STATIONS.length
  const ringArr: number[] = []
  for (let s = 0; s < NS; s += 2) {
    for (let j = 0; j < PERIM; j++) {
      const a = s * PERIM + j
      const b = s * PERIM + ((j + 1) % PERIM)
      ringArr.push(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a), posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b))
    }
  }
  const rings = new THREE.BufferGeometry()
  rings.setAttribute('position', new THREE.Float32BufferAttribute(ringArr, 3))
  const sparArr: number[] = []
  for (const j of [0, PERIM / 2 - 1, PERIM / 2, PERIM - 1]) {
    for (let s = 0; s < NS - 1; s++) {
      const a = s * PERIM + j
      const b = (s + 1) * PERIM + j
      sparArr.push(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a), posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b))
    }
  }
  const spars = new THREE.BufferGeometry()
  spars.setAttribute('position', new THREE.Float32BufferAttribute(sparArr, 3))
  rings.applyMatrix4(mat)
  spars.applyMatrix4(mat)
  return [rings, spars]
}

interface Merged {
  baseShell: THREE.BufferGeometry
  baseCore: THREE.BufferGeometry
  baseHalo: THREE.BufferGeometry
  baseRibs: THREE.BufferGeometry
  yawShell: THREE.BufferGeometry
  yawCore: THREE.BufferGeometry
  yawHalo: THREE.BufferGeometry
  rotorShell: THREE.BufferGeometry
  rotorCore: THREE.BufferGeometry
  rotorHalo: THREE.BufferGeometry
  rotorRibs: THREE.BufferGeometry
}

let mergedCache: Merged | null = null

function buildMerged(): Merged {
  if (mergedCache) return mergedCache
  const G = getTurbineGeos()

  // ---- 塔体（固定于地面）----
  const baseParts: PartDef[] = [
    { geo: G.tower, edgeAngle: 28 },
    { geo: G.flange1, edgeAngle: 25 },
    { geo: G.door, pos: [0, 2.0, -2.92], edgeAngle: 18 },
  ]
  const baseShell = mergeGeometries(baseParts.map((p) => prepShell(p.geo, partMatrix(p))), false)!
  const baseCore = mergeGeometries(baseParts.map((p) => prepEdges(p.geo, partMatrix(p), p.edgeAngle ?? 25, false)), false)!
  const baseHalo = mergeGeometries(baseParts.map((p) => prepEdges(p.geo, partMatrix(p), p.edgeAngle ?? 25, true)), false)!
  const baseRibs = mergeGeometries(towerRibGeometries(), false)!

  // ---- 机舱组（随偏航旋转）：偏航盘/机舱/尾罩/舱门/风速仪 ----
  const yawParts: PartDef[] = [
    { geo: G.yawPlate, pos: [0, S.towerTop + 0.5, S.nacelleZ * 0.4], edgeAngle: 25 },
    { geo: G.nacelle, pos: [0, S.hubY - 0.4, S.nacelleZ], edgeAngle: 20 },
    { geo: G.nacelleTail, pos: [0, S.hubY - 0.6, S.nacelleZ - 8.6], edgeAngle: 20 },
    { geo: G.door, pos: [0, S.hubY - 0.5, S.nacelleZ - 10.6], scl: [1.5, 1.1, 1], edgeAngle: 18 },
    { geo: G.anemo, pos: [0, S.hubY + 3.1, S.nacelleZ - 0.2], edgeAngle: 25 },
  ]
  const yawShell = mergeGeometries(yawParts.map((p) => prepShell(p.geo, partMatrix(p))), false)!
  const yawCore = mergeGeometries(yawParts.map((p) => prepEdges(p.geo, partMatrix(p), p.edgeAngle ?? 25, false)), false)!
  const yawHalo = mergeGeometries(yawParts.map((p) => prepEdges(p.geo, partMatrix(p), p.edgeAngle ?? 25, true)), false)!

  // ---- 转子（随偏航 + 自转）：轮毂/导流罩/3 叶片。
  //      几何只烘焙到"机舱仰角坐标系"内；yaw 基座变换交给场景图组，
  //      自转 = spin 组绕局部 z（转子轴）旋转。
  const spinOffset = new THREE.Matrix4().makeTranslation(0, 0, 5.35)
  const hubM = spinOffset.clone().multiply(partMatrix({ geo: G.hub, rot: [Math.PI / 2, 0, 0], pos: [0, 0, -1.4] }))
  const spinnerM = spinOffset.clone().multiply(partMatrix({ geo: G.spinner, rot: [Math.PI / 2, 0, 0], pos: [0, 0, -0.4] }))
  const bladeMs = [0, 1, 2].map((i) => {
    const bm = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(D2R(S.coneDeg), 0, (i * Math.PI * 2) / 3)),
      new THREE.Vector3(1, 1, 1),
    )
    return spinOffset.clone().multiply(bm)
  })
  const rotorShell = mergeGeometries(
    [
      prepShell(G.hub, hubM),
      prepShell(G.spinner, spinnerM),
      ...bladeMs.map((m) => prepShell(G.blade, m)),
    ],
    false,
  )!
  const rotorCore = mergeGeometries(
    [
      prepEdges(G.hub, hubM, 25, false),
      prepEdges(G.spinner, spinnerM, 28, false),
      ...bladeMs.map((m) => prepEdges(G.blade, m, 6, false)),
    ],
    false,
  )!
  const rotorHalo = mergeGeometries(
    [
      prepEdges(G.hub, hubM, 25, true),
      prepEdges(G.spinner, spinnerM, 28, true),
      ...bladeMs.map((m) => prepEdges(G.blade, m, 6, true)),
    ],
    false,
  )!
  const rotorRibs = mergeGeometries(bladeMs.flatMap((m) => bladeRibSet(m)), false)!

  mergedCache = {
    baseShell, baseCore, baseHalo, baseRibs,
    yawShell, yawCore, yawHalo,
    rotorShell, rotorCore, rotorHalo, rotorRibs,
  }
  return mergedCache
}

// 帧注入走 frameBus（TurbineField 每帧推一次，9 机共享）
import { getFarmFrame } from './frameBus'

// ---------------------------------------------------------------------------
// 单个机组
// ---------------------------------------------------------------------------
export default function HoloTurbine({ idx, x, z, y, servo }: {
  idx: number
  x: number; z: number; y: number
  servo: boolean
}) {
  const root = useRef<THREE.Group>(null!)
  const spin = useRef<THREE.Group>(null!)
  const beaconMat = useRef<THREE.MeshBasicMaterial>(null!)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null!)
  const spinRef = useRef(0)

  const assets = useMemo(() => {
    const merged = buildMerged()
    return {
      merged,
      shell: makeShellMaterial(),
      core: makeCoreLineMaterial(),
      halo: makeHaloLineMaterial(),
      rib: makeRibMaterial(),
    }
  }, [])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    assets.shell.uniforms.uTime.value = t
    if (beaconMat.current) {
      beaconMat.current.opacity = 0.3 + 0.7 * Math.pow(0.5 + 0.5 * Math.sin(t * 3.2 + idx * 1.7), 3)
    }
    const u = getFarmFrame()?.units[idx]
    if (!u) return
    // 转子：rad/s = rpm × 2π/60（B8：转速是风的函数）
    spinRef.current -= dt * ((u.rpm * Math.PI) / 30)
    if (spin.current) spin.current.rotation.z = spinRef.current
    // 偏航：机头基向朝北（迎风，A4 修正）；正偏航 = 方位向东
    if (root.current) {
      const target = Math.PI - D2R(u.yawDeg)
      const cur = root.current.rotation.y
      let d = target - (cur % (Math.PI * 2))
      if (d > Math.PI) d -= Math.PI * 2
      if (d < -Math.PI) d += Math.PI * 2
      root.current.rotation.y = cur + d * Math.min(1, dt * 3.5)
    }
    // 状态环：告警红（呼吸）/ 限功率幽蓝 / 正常纯白
    if (ringMat.current) {
      const m = ringMat.current
      if (u.status === 'alarm') {
        m.color.copy(ALARM_RED)
        m.opacity = 0.55 + 0.4 * Math.abs(Math.sin(t * 5))
      } else if (u.status === 'curtail') {
        m.color.copy(DIM_BLUE)
        m.opacity = 0.65
      } else if (u.status === 'idle') {
        m.color.copy(DIM_BLUE)
        m.opacity = 0.35
      } else {
        m.color.copy(HOLO_PURE)
        m.opacity = 0.62 + 0.12 * Math.sin(t * 1.4 + idx)
      }
    }
  })

  return (
    <group position={[x, y, z]}>
      {/* 基座暗盘（C2 收敛） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]} renderOrder={0}>
        <circleGeometry args={[11, 48]} />
        <meshBasicMaterial color="#010408" transparent opacity={0.5} depthWrite={false} fog={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* 能量环（状态语义） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.9, 0]} renderOrder={5}>
        <ringGeometry args={[5.6, 6.3, 64]} />
        <meshBasicMaterial ref={ringMat} color={HOLO_PURE} transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.05, 0]} renderOrder={6}>
        <ringGeometry args={[3.9, 4.25, 56]} />
        <meshBasicMaterial color={HOLO_PURE} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* 舵机/选中指示外环 */}
      {servo && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.9, 0]} renderOrder={7}>
          <ringGeometry args={[8.4, 8.9, 72]} />
          <meshBasicMaterial color={HOLO_PURE} transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* 塔体线稿（固定，4 draw call） */}
      <mesh geometry={assets.merged.baseShell} material={assets.shell} renderOrder={1} />
      <lineSegments geometry={assets.merged.baseRibs} material={assets.rib} renderOrder={2} />
      <lineSegments geometry={assets.merged.baseHalo} material={assets.halo} renderOrder={3} />
      <lineSegments geometry={assets.merged.baseCore} material={assets.core} renderOrder={4} />

      {/* 偏航组：机舱 + 转子 + 信标一起转向 */}
      <group ref={root}>
        <mesh geometry={assets.merged.yawShell} material={assets.shell} renderOrder={1} />
        <lineSegments geometry={assets.merged.yawHalo} material={assets.halo} renderOrder={3} />
        <lineSegments geometry={assets.merged.yawCore} material={assets.core} renderOrder={4} />
        <mesh position={[0, S.hubY + 3.9, S.nacelleZ - 0.2]}>
          <sphereGeometry args={[0.4, 10, 10]} />
          <meshBasicMaterial ref={beaconMat} color={HOLO_GLOW} transparent opacity={0.6} depthWrite={false} depthTest={false} fog={false} toneMapped={false} />
        </mesh>
        <group position={[0, S.hubY, S.nacelleZ]} rotation={[-D2R(S.tiltDeg), 0, 0]}>
          <group ref={spin}>
            <mesh geometry={assets.merged.rotorShell} material={assets.shell} renderOrder={1} />
            <lineSegments geometry={assets.merged.rotorRibs} material={assets.rib} renderOrder={2} />
            <lineSegments geometry={assets.merged.rotorHalo} material={assets.halo} renderOrder={3} />
            <lineSegments geometry={assets.merged.rotorCore} material={assets.core} renderOrder={4} />
          </group>
        </group>
      </group>
    </group>
  )
}
