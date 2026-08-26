import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getTurbineGeos, TURBINE_SPEC as S, type TurbineGeoSet } from './turbine/geometry'

// ============================================================================
// NREL 5MW 真实几何的全息化版本
//
// 这里直接复用真实机组的塔筒、机舱、轮毂和 18 站位翼型叶片几何，
// 再用透明低 alpha 体积提示 + 纯白边框 / 线框重建成数字孪生。这样既保留
// 真实风机的结构比例，也确保所有可见结构边界在任何背景下都是纯白。
// ============================================================================

const D2R = THREE.MathUtils.degToRad
// 风机专用纯白能量色：RGB 三通道完全一致，HUD 与电缆仍保持冰青配色。
const HOLO_WHITE = new THREE.Color(1.0, 1.0, 1.0)
const HOLO_WHITE_HI = new THREE.Color(1.0, 1.0, 1.0)

const SURFACE_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  vLocal = position;
  gl_Position = projectionMatrix * mv;
}
`

const SURFACE_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
uniform vec3 uColor;
uniform float uTime;
void main() {
  // 只保留极淡的透明体积提示；真正的主体边框由下面的纯白 wireframe
  // 和 EdgesGeometry 绘制，绝不把风机内部填成白色。
  float facing = max(dot(normalize(vNormal), normalize(vView)), 0.0);
  float fresnel = pow(1.0 - facing, 2.35);
  float scan = 0.5 + 0.5 * sin(vLocal.y * 0.32 - uTime * 2.2);
  float alpha = 0.012 + fresnel * 0.028 + scan * 0.006;
  gl_FragColor = vec4(vec3(0.025, 0.055, 0.068), alpha);
}
`

function makeSurfaceMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: SURFACE_VERT,
    fragmentShader: SURFACE_FRAG,
    uniforms: {
      uColor: { value: HOLO_WHITE.clone() },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    fog: false,
    toneMapped: false,
  })
}

function makeWireMaterial() {
  return new THREE.MeshBasicMaterial({
    color: HOLO_WHITE,
    // 线框本身也使用不透明纯白，避免远景 1px 结构线在透明混合后变灰。
    transparent: false,
    opacity: 1.0,
    wireframe: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  })
}

function makeEdgeMaterial() {
  return new THREE.LineBasicMaterial({
    color: HOLO_WHITE_HI,
    // 轮廓线使用不透明纯白，透明感由低 alpha 的实体层和稀疏线框提供；
    // 这样远景不会因半透明叠加变成脏灰，同时也不会进入 Bloom。
    transparent: false,
    opacity: 1.0,
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  })
}

type EdgeSet = { [K in keyof TurbineGeoSet]: THREE.EdgesGeometry }
let edgeCache: EdgeSet | null = null
function getTurbineEdges(geos: TurbineGeoSet): EdgeSet {
  if (edgeCache) return edgeCache
  edgeCache = {
    blade: new THREE.EdgesGeometry(geos.blade, 14),
    tower: new THREE.EdgesGeometry(geos.tower, 10),
    yawPlate: new THREE.EdgesGeometry(geos.yawPlate, 12),
    nacelle: new THREE.EdgesGeometry(geos.nacelle, 16),
    nacelleTail: new THREE.EdgesGeometry(geos.nacelleTail, 16),
    yawFin: new THREE.EdgesGeometry(geos.yawFin, 12),
    spinner: new THREE.EdgesGeometry(geos.spinner, 12),
    hub: new THREE.EdgesGeometry(geos.hub, 12),
    flange1: new THREE.EdgesGeometry(geos.flange1, 10),
    flange2: new THREE.EdgesGeometry(geos.flange2, 10),
    door: new THREE.EdgesGeometry(geos.door, 14),
    fin: new THREE.EdgesGeometry(geos.fin, 12),
    anemo: new THREE.EdgesGeometry(geos.anemo, 10),
    beacon: new THREE.EdgesGeometry(geos.beacon, 12),
  }
  return edgeCache
}

type HoloPartProps = {
  geometry: THREE.BufferGeometry
  edge: THREE.BufferGeometry
  surface: THREE.ShaderMaterial
  wire: THREE.MeshBasicMaterial
  line: THREE.LineBasicMaterial
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

/** 透明体积提示 + 纯白三角线框 + 纯白轮廓线，构成真实模型的高亮全息层。 */
function HoloPart({ geometry, edge, surface, wire, line, position, rotation, scale }: HoloPartProps) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geometry} material={surface} />
      <mesh geometry={geometry} material={wire} renderOrder={3} />
      <lineSegments geometry={edge} material={line} scale={[1.003, 1.003, 1.003]} renderOrder={4} />
    </group>
  )
}

export default function HoloTurbine({ x, z, y, yawDeg, speed, servo }: {
  x: number; z: number; y: number; yawDeg: number; speed: number; servo: boolean
}) {
  const root = useRef<THREE.Group>(null!)
  const spin = useRef<THREE.Group>(null!)
  const geos = useMemo(() => getTurbineGeos(), [])
  const edges = useMemo(() => getTurbineEdges(geos), [geos])
  const mainSurface = useMemo(() => makeSurfaceMaterial(), [])
  const wire = useMemo(() => makeWireMaterial(), [])
  const mainEdge = useMemo(() => makeEdgeMaterial(), [])
  const surfaceRef = useRef(mainSurface)
  const edgeRef = useRef(mainEdge)

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    surfaceRef.current.uniforms.uTime.value = t
    edgeRef.current.opacity = 1.0
    if (spin.current) spin.current.rotation.z += dt * speed * 1.15
    if (root.current) {
      const target = D2R(yawDeg)
      root.current.rotation.y += (target - root.current.rotation.y) * Math.min(1, dt * 3)
    }
  })

  return (
    <group position={[x, y, z]}>
      {/* 数字孪生基座：黑色吸光盘与冰青能量环 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.55, 0]}>
        <circleGeometry args={[13, 48]} />
        <meshBasicMaterial color="#01070d" transparent opacity={0.72} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.9, 0]}>
        <ringGeometry args={[9.2, 10.4, 64]} />
        <meshBasicMaterial color={new THREE.Color(1.0, 1.0, 1.0)} transparent opacity={0.42} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.05, 0]}>
        <ringGeometry args={[4.0, 4.42, 56]} />
        <meshBasicMaterial color={new THREE.Color(1.0, 1.0, 1.0)} transparent opacity={0.60} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} />
      </mesh>
      {servo && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 2.0, 0]}>
          <ringGeometry args={[13.5, 14.7, 72]} />
          <meshBasicMaterial color={new THREE.Color(1.0, 1.0, 1.0)} transparent opacity={0.64} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} />
        </mesh>
      )}

      <group ref={root}>
        {/* 真实塔筒：保留 NREL 锥度、法兰、舱门等结构比例 */}
        <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.tower} edge={edges.tower} />
        <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.flange1} edge={edges.flange1} />
        <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.flange2} edge={edges.flange2} />
        <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.door} edge={edges.door} position={[0, 2.0, -2.92]} />

        <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.yawPlate} edge={edges.yawPlate} position={[0, S.towerTop + 0.5, S.nacelleZ * 0.4]} />
        <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.nacelle} edge={edges.nacelle} position={[0, S.hubY - 0.4, S.nacelleZ]} />
        <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.nacelleTail} edge={edges.nacelleTail} position={[0, S.hubY - 0.6, S.nacelleZ - 8.6]} />
        <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.door} edge={edges.door} position={[0, S.hubY - 0.5, S.nacelleZ - 10.6]} scale={[1.5, 1.1, 1]} />
        {[0, 1].map((i) => (
          <HoloPart surface={mainSurface} wire={wire} line={mainEdge} key={i} geometry={geos.fin} edge={edges.fin} position={[i ? 1.3 : -1.3, S.hubY + 2.15, S.nacelleZ - 1.5]} />
        ))}
        <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.anemo} edge={edges.anemo} position={[0, S.hubY + 3.1, S.nacelleZ - 0.2]} />
        <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.beacon} edge={edges.beacon} position={[0, S.hubY + 3.9, S.nacelleZ - 0.2]} />
        <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.yawFin} edge={edges.yawFin} position={[0, S.hubY + 1.4, S.nacelleZ - 9.2]} />

        <group position={[0, S.hubY, S.nacelleZ]} rotation={[-D2R(S.tiltDeg), 0, 0]}>
          <group ref={spin} position={[0, 0, 5.35]}>
            <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.hub} edge={edges.hub} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -1.4]} />
            {[0, 1, 2].map((i) => (
              <group key={i} rotation={[0, 0, (i * Math.PI * 2) / 3]}>
                <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.blade} edge={edges.blade} rotation={[D2R(S.coneDeg), 0, 0]} />
              </group>
            ))}
            <HoloPart surface={mainSurface} wire={wire} line={mainEdge} geometry={geos.spinner} edge={edges.spinner} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.4]} />
          </group>
        </group>
      </group>
    </group>
  )
}
