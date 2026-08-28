import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getTurbineGeos, TURBINE_SPEC as S, type TurbineGeoSet } from './turbine/geometry'

// ============================================================================
// AEOLUS — 全息纯白线稿风机
//
// 设计目标（用户要求）：
//   · 全息「线稿」状态，而不是填充实体；
//   · 线框是纯白色、自发光的，在暗色背景下绝对不能变暗变灰；
//   · 远景不能因为三角面过密糊成一片「填充白」——只保留特征轮廓/硬边，
//     叶片和塔筒只画稀疏的环向/轴向特征线，而不是整面三角 wireframe。
//
// 渲染层级（从底到顶，renderOrder 递增）：
//   1) HoloShell —— 极淡的 fresnel 能量壳（加色混合，几乎不可见，仅在侧视角
//      给出「这是一个全息体」的体积暗示，绝不填白）；
//   2) GhostRibs —— 沿叶片/塔筒展向的稀疏扫描肋线（加色混合，亮白偏青）；
//   3) CoreEdges —— EdgesGeometry 硬边轮廓（不透明纯白，不受光照/雾/
//      toneMapping 影响，depthTest 关闭以保证远景依然纯白）；
//   4) HaloEdges —— 同一批边稍微外扩并用加色混合再画一遍，形成柔和能量
//      晕，而不靠后期 Bloom（后期 Bloom 已关，避免整片场发糊）。
// ============================================================================

const D2R = THREE.MathUtils.degToRad

// 绝对纯白：所有通道打满，保证在任何背景/任何曝光下都是亮的。
const HOLO_PURE = /* #FFFFFF */ new THREE.Color(1.0, 1.0, 1.0)
// 能量晕偏一丁点冰青，用来和 HUD / 电缆配色呼应，但主体仍是白。
const HOLO_GLOW = /* #E6F7FF */ new THREE.Color(0.82, 0.97, 1.0)

// ---------------------------------------------------------------------------
// 1. 全息能量壳（仅菲涅尔边光 + 扫描线，不填充）
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
  // 菲涅尔：正视几乎不可见，侧视才出边光 → 永远不会变成「填充白」。
  float facing  = max(dot(normalize(vNormal), normalize(vView)), 0.0);
  float fresnel = pow(1.0 - facing, 3.0);

  // 扫描线：沿高度方向缓慢下移的能量带，给全息以生命感。
  float scanA = 0.5 + 0.5 * sin(vLocal.y * 0.22 - uTime * 1.6);
  float scanB = 0.5 + 0.5 * sin((vLocal.y + vLocal.z * 0.6) * 0.9 - uTime * 2.8);
  float scan  = scanA * 0.45 + scanB * 0.22;

  // 顶点闪烁：微小颗粒，强化数字投影感。
  float flicker = 0.88 + 0.12 * sin(uTime * 9.3 + vLocal.x * 13.7 + vLocal.z * 7.1);

  float alpha = fresnel * (0.18 + scan * 0.10) * flicker;
  // 颜色：纯白，但 fresnel 最弱处往冰青偏一点点，营造能量边缘感。
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
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  })
}

// ---------------------------------------------------------------------------
// 2. 线材质
// ---------------------------------------------------------------------------
/** 核心轮廓线：不透明纯白，完全绕过光照/雾/toneMapping，保证永远亮。 */
function makeCoreLineMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: HOLO_PURE,
    transparent: false,
    linewidth: 1, // 多数浏览器固定为 1px，靠 Halo 层加粗
    depthWrite: false,
    depthTest: false, // 关闭深度测试 → 被自身/地形挡住也保持纯白
    fog: false,
    toneMapped: false,
    blending: THREE.NormalBlending,
  })
}

/** 能量晕：同一批线外扩 + 加色，产生柔和光晕，替代后期 Bloom。 */
function makeHaloLineMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: HOLO_GLOW,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  })
}

// ---------------------------------------------------------------------------
// 3. EdgesGeometry 缓存
//    thresholdAngle 给得比较大（28°），只抽真正的硬边（法兰、机舱棱角、
//    叶片前后缘、门框等），避免像上一版那样把整个三角网画出来变成「填白」。
// ---------------------------------------------------------------------------
type EdgeSet = { [K in keyof TurbineGeoSet]: THREE.EdgesGeometry }
let edgeCache: EdgeSet | null = null
function getTurbineEdges(geos: TurbineGeoSet): EdgeSet {
  if (edgeCache) return edgeCache
  const mk = (g: THREE.BufferGeometry, a: number) => new THREE.EdgesGeometry(g, a)
  edgeCache = {
    // 塔筒/法兰是回转体：阈值拉高，只保留上下沿的硬环，侧面三角被剔除
    tower:       mk(geos.tower,       28),
    flange1:     mk(geos.flange1,     25),
    flange2:     mk(geos.flange2,     25),
    yawPlate:    mk(geos.yawPlate,    25),
    // 机舱是 RoundedBox：阈值放低一点，多出几条结构棱
    nacelle:     mk(geos.nacelle,     20),
    nacelleTail: mk(geos.nacelleTail, 20),
    yawFin:      mk(geos.yawFin,      30),
    spinner:     mk(geos.spinner,     28),
    hub:         mk(geos.hub,         25),
    door:        mk(geos.door,        18),
    fin:         mk(geos.fin,         30),
    anemo:       mk(geos.anemo,       25),
    beacon:      mk(geos.beacon,      30),
    // 叶片：阈值给低（6°），既保留前后缘/扭转棱，又不会把每一条放样三角
    // 都画出来糊成一片。配合下面的稀疏肋线，线稿感就出来了。
    blade:       mk(geos.blade,       6),
  }
  return edgeCache
}

// ---------------------------------------------------------------------------
// 4. 叶片/塔筒的「肋线」（展向扫描环）
//    EdgesGeometry 只给硬边，曲面内部的线稿感靠我们手工沿展向插入若干
//    闭合环来表达（像工程图里的截面示意线）。
// ---------------------------------------------------------------------------
type Ribs = {
  bladeRings: THREE.BufferGeometry   // 叶片：翼型截面环（周向）
  bladeSpars: THREE.BufferGeometry   // 叶片：前后缘 + 梁线（展向）
  towerRings: THREE.BufferGeometry   // 塔筒：水平环
  towerSpars: THREE.BufferGeometry   // 塔筒：垂直经线
}
let ribsCache: Ribs | null = null
function buildRibs(): Ribs {
  if (ribsCache) return ribsCache

  // ===== 叶片 =====
  // 直接从已缓存叶片几何中按顶点索引提取（NS × PERIM 个放样点，最后两个是根盖/尖盖）
  const bladeGeo = getTurbineGeos().blade
  const posAttr = bladeGeo.getAttribute('position') as THREE.BufferAttribute
  const PERIM = 26 // 与 geometry.ts 保持一致（0..12 上表面，13..25 下表面）
  const NS = 18

  // ① 翼型截面环（周向）—— 每隔 1 个站位画一圈，远处看就是线稿截面
  const bladeRingsArr: number[] = []
  const RING_STRIDE = 2
  for (let s = 0; s < NS; s += RING_STRIDE) {
    for (let j = 0; j < PERIM; j++) {
      const a = s * PERIM + j
      const b = s * PERIM + ((j + 1) % PERIM)
      bladeRingsArr.push(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a))
      bladeRingsArr.push(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b))
    }
  }
  const bladeRings = new THREE.BufferGeometry()
  bladeRings.setAttribute('position', new THREE.Float32BufferAttribute(bladeRingsArr, 3))

  // ② 展向「梁线」—— 沿前缘(j=13 下表面LE)、后缘(j=PERIM/2=13附近上表面TE)、
  //   以及 3 条结构指示线（上表面最凸/下表面最凸/桨距轴附近）贯穿 18 个站位。
  //   上表面 j=0..12：j=0 是 TE(上)，j=12 是 LE(上)
  //   下表面 j=13..25：j=13 是 LE(下)，j=25 是 TE(下)
  const bladeSparsArr: number[] = []
  const SPAR_JS = [0, 6, 12, 13, 19, 25] // 后缘 / 上弧 / 前缘(上) / 前缘(下) / 下弧 / 后缘(下)
  for (const j of SPAR_JS) {
    for (let s = 0; s < NS - 1; s++) {
      const a = s * PERIM + j
      const b = (s + 1) * PERIM + j
      bladeSparsArr.push(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a))
      bladeSparsArr.push(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b))
    }
  }
  const bladeSpars = new THREE.BufferGeometry()
  bladeSpars.setAttribute('position', new THREE.Float32BufferAttribute(bladeSparsArr, 3))

  // ===== 塔筒 =====
  // 沿高度插值半径（与 geometry.ts 中 lathe 廓线保持近似一致即可：
  // 底部 y=-0.6 r=3.9；y=0 r=3.6；y=3.5 r=2.95；中部 43.8m 取中值；y=87.6 r=1.935）
  const towerProfile: [number, number][] = [
    [3.9, -0.6], [3.6, 0.0], [3.05, 0.35], [2.95, 3.5],
    [2.45, 43.8], [1.985, 84.5], [1.935, 87.6],
  ]
  function towerRadiusAtY(y: number): number {
    for (let i = 0; i < towerProfile.length - 1; i++) {
      const [r0, y0] = towerProfile[i]
      const [r1, y1] = towerProfile[i + 1]
      if (y <= y1) {
        const t = (y - y0) / (y1 - y0)
        return r0 + (r1 - r0) * t
      }
    }
    return towerProfile[towerProfile.length - 1][0]
  }

  // ① 水平环
  const TOWER_RINGS = 18
  const TOWER_SEG = 48
  const towerRingsArr: number[] = []
  for (let r = 0; r < TOWER_RINGS; r++) {
    const y = -0.6 + ((87.6 + 0.6) * r) / (TOWER_RINGS - 1)
    const rad = towerRadiusAtY(y)
    for (let j = 0; j < TOWER_SEG; j++) {
      const a0 = (j / TOWER_SEG) * Math.PI * 2
      const a1 = ((j + 1) / TOWER_SEG) * Math.PI * 2
      towerRingsArr.push(Math.cos(a0) * rad, y, Math.sin(a0) * rad)
      towerRingsArr.push(Math.cos(a1) * rad, y, Math.sin(a1) * rad)
    }
  }
  const towerRings = new THREE.BufferGeometry()
  towerRings.setAttribute('position', new THREE.Float32BufferAttribute(towerRingsArr, 3))

  // ② 垂直经线（12 条，从底到顶）
  const TOWER_SPARS = 12
  const TOWER_STEPS = 60
  const towerSparsArr: number[] = []
  for (let k = 0; k < TOWER_SPARS; k++) {
    const ang = (k / TOWER_SPARS) * Math.PI * 2
    const cx = Math.cos(ang), cz = Math.sin(ang)
    for (let i = 0; i < TOWER_STEPS - 1; i++) {
      const y0 = -0.6 + ((87.6 + 0.6) * i) / (TOWER_STEPS - 1)
      const y1 = -0.6 + ((87.6 + 0.6) * (i + 1)) / (TOWER_STEPS - 1)
      const r0 = towerRadiusAtY(y0), r1 = towerRadiusAtY(y1)
      towerSparsArr.push(cx * r0, y0, cz * r0)
      towerSparsArr.push(cx * r1, y1, cz * r1)
    }
  }
  const towerSpars = new THREE.BufferGeometry()
  towerSpars.setAttribute('position', new THREE.Float32BufferAttribute(towerSparsArr, 3))

  ribsCache = { bladeRings, bladeSpars, towerRings, towerSpars }
  return ribsCache
}

function makeRibMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: HOLO_PURE,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  })
}

// ---------------------------------------------------------------------------
// 5. 单个零件：能量壳 + 核心边 + 光晕边
// ---------------------------------------------------------------------------
type PartProps = {
  geometry: THREE.BufferGeometry
  edge: THREE.BufferGeometry
  shell: THREE.ShaderMaterial
  core: THREE.LineBasicMaterial
  halo: THREE.LineBasicMaterial
  rings?: THREE.BufferGeometry     // 周向环
  spars?: THREE.BufferGeometry     // 展向/经向线
  ribMat?: THREE.LineBasicMaterial
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
  shellScale?: number
}

function HoloPart({
  geometry, edge, shell, core, halo, rings, spars, ribMat,
  position, rotation, scale, shellScale = 0.997,
}: PartProps) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* 能量壳：稍微内收，避免和边线 z-fighting */}
      <mesh geometry={geometry} material={shell} scale={shellScale} renderOrder={1} />
      {/* 肋线：周向环 + 展向/经向梁（线稿笼） */}
      {rings && ribMat && <lineSegments geometry={rings} material={ribMat} renderOrder={2} />}
      {spars && ribMat && <lineSegments geometry={spars} material={ribMat} renderOrder={2} />}
      {/* 能量晕：外扩一点，加色 → 柔和白边（在核心线下面，避免糊边） */}
      <lineSegments geometry={edge} material={halo} scale={[1.012, 1.012, 1.012]} renderOrder={3} />
      {/* 核心硬边：1.0 比例，不透明纯白，压在最上 */}
      <lineSegments geometry={edge} material={core} renderOrder={4} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// 6. 整机
// ---------------------------------------------------------------------------
export default function HoloTurbine({ x, z, y, yawDeg, speed, servo }: {
  x: number; z: number; y: number; yawDeg: number; speed: number; servo: boolean
}) {
  const root = useRef<THREE.Group>(null!)
  const spin = useRef<THREE.Group>(null!)

  const geos   = useMemo(() => getTurbineGeos(), [])
  const edges  = useMemo(() => getTurbineEdges(geos), [geos])
  const ribs   = useMemo(() => buildRibs(), [])

  const shell  = useMemo(() => makeShellMaterial(), [])
  const core   = useMemo(() => makeCoreLineMaterial(), [])
  const halo   = useMemo(() => makeHaloLineMaterial(), [])
  const ribMat = useMemo(() => makeRibMaterial(), [])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    shell.uniforms.uTime.value = t
    if (spin.current) spin.current.rotation.z += dt * speed * 1.15
    if (root.current) {
      const target = D2R(yawDeg)
      root.current.rotation.y += (target - root.current.rotation.y) * Math.min(1, dt * 3)
    }
  })

  return (
    <group position={[x, y, z]}>
      {/* 底层暗吸光盘：让基座能量环压在一个稳定暗底上，避免与地形 z-fighting 导致某角度变暗 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.55, 0]} renderOrder={0}>
        <circleGeometry args={[16, 64]} />
        <meshBasicMaterial
          color="#010408"
          transparent
          opacity={0.82}
          depthWrite={false}
          depthTest={false}
          fog={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 能量环：depthTest:false + toneMapped:false + renderOrder 锁顺序，
          任何视角都保持纯白，不被地面/自身遮挡而忽亮忽暗 */}
      {[
        { rIn: 9.2, rOut: 10.4, y: 0.95, op: 0.70 },
        { rIn: 4.0, rOut: 4.42, y: 1.10, op: 0.90 },
      ].map((ring, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, ring.y, 0]}
          renderOrder={5 + i}
        >
          <ringGeometry args={[ring.rIn, ring.rOut, 72]} />
          <meshBasicMaterial
            color={HOLO_PURE}
            transparent
            opacity={ring.op}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            depthTest={false}
            fog={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {servo && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 2.05, 0]}
          renderOrder={7}
        >
          <ringGeometry args={[13.5, 14.7, 80]} />
          <meshBasicMaterial
            color={HOLO_PURE}
            transparent
            opacity={0.85}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            depthTest={false}
            fog={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      <group ref={root}>
        {/* 塔筒 + 法兰 + 舱门（塔筒附加水平环 + 垂直经线，形成线稿笼） */}
        <HoloPart geometry={geos.tower}       edge={edges.tower}       shell={shell} core={core} halo={halo} rings={ribs.towerRings} spars={ribs.towerSpars} ribMat={ribMat} />
        <HoloPart geometry={geos.flange1}     edge={edges.flange1}     shell={shell} core={core} halo={halo} />
        <HoloPart geometry={geos.flange2}     edge={edges.flange2}     shell={shell} core={core} halo={halo} />
        <HoloPart geometry={geos.door}        edge={edges.door}        shell={shell} core={core} halo={halo} position={[0, 2.0, -2.92]} />

        <HoloPart geometry={geos.yawPlate}    edge={edges.yawPlate}    shell={shell} core={core} halo={halo} position={[0, S.towerTop + 0.5, S.nacelleZ * 0.4]} />
        <HoloPart geometry={geos.nacelle}     edge={edges.nacelle}     shell={shell} core={core} halo={halo} position={[0, S.hubY - 0.4, S.nacelleZ]} />
        <HoloPart geometry={geos.nacelleTail} edge={edges.nacelleTail} shell={shell} core={core} halo={halo} position={[0, S.hubY - 0.6, S.nacelleZ - 8.6]} />
        <HoloPart geometry={geos.door}        edge={edges.door}        shell={shell} core={core} halo={halo} position={[0, S.hubY - 0.5, S.nacelleZ - 10.6]} scale={[1.5, 1.1, 1]} />
        {[0, 1].map((i) => (
          <HoloPart key={i} geometry={geos.fin} edge={edges.fin} shell={shell} core={core} halo={halo}
            position={[i ? 1.3 : -1.3, S.hubY + 2.15, S.nacelleZ - 1.5]} />
        ))}
        <HoloPart geometry={geos.anemo}  edge={edges.anemo}  shell={shell} core={core} halo={halo} position={[0, S.hubY + 3.1, S.nacelleZ - 0.2]} />
        <HoloPart geometry={geos.beacon} edge={edges.beacon} shell={shell} core={core} halo={halo} position={[0, S.hubY + 3.9, S.nacelleZ - 0.2]} />
        <HoloPart geometry={geos.yawFin} edge={edges.yawFin} shell={shell} core={core} halo={halo} position={[0, S.hubY + 1.4, S.nacelleZ - 9.2]} />

        <group position={[0, S.hubY, S.nacelleZ]} rotation={[-D2R(S.tiltDeg), 0, 0]}>
          <group ref={spin} position={[0, 0, 5.35]}>
            <HoloPart geometry={geos.hub} edge={edges.hub} shell={shell} core={core} halo={halo}
              rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -1.4]} />
            {[0, 1, 2].map((i) => (
              <group key={i} rotation={[0, 0, (i * Math.PI * 2) / 3]}>
                {/* 叶片：翼型截面环 + 前后缘/梁展向线 → 工程线稿 */}
                <HoloPart
                  geometry={geos.blade}
                  edge={edges.blade}
                  shell={shell}
                  core={core}
                  halo={halo}
                  rings={ribs.bladeRings}
                  spars={ribs.bladeSpars}
                  ribMat={ribMat}
                  rotation={[D2R(S.coneDeg), 0, 0]}
                />
              </group>
            ))}
            <HoloPart geometry={geos.spinner} edge={edges.spinner} shell={shell} core={core} halo={halo}
              rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.4]} />
          </group>
        </group>
      </group>
    </group>
  )
}
