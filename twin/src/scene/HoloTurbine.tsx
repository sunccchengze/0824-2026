import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getTurbineGeos, TURBINE_SPEC as S, type TurbineGeoSet } from './turbine/geometry'

// ============================================================================
// NREL 5MW 真实几何的全息化版本
//
// 不再使用一套“卡通全息风机”或白色 PBR 风机：这里直接复用真实机组的
// 塔筒、机舱、轮毂和 18 站位翼型叶片几何，再用透明扫描材质 + 线框 +
// 清晰边线重建成冰青色数字孪生。这样既保留真实风机的结构比例，也完全
// 融入原图的全息氛围。
// ============================================================================

const D2R = THREE.MathUtils.degToRad
// 刻意使用低于白色的冰青能量值：即使经过 Bloom，机组仍保持“蓝青线条”，
// 不会回到上一版刺眼的白色实体风机。
const HOLO_CYAN = new THREE.Color(0.025, 0.30, 0.50)
const HOLO_HI = new THREE.Color(0.075, 0.52, 0.72)

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
  float facing = max(dot(normalize(vNormal), normalize(vView)), 0.0);
  float fresnel = pow(1.0 - facing, 2.35);
  float scan = 0.5 + 0.5 * sin(vLocal.y * 0.32 - uTime * 2.2);
  float scanBand = smoothstep(0.80, 1.0, scan);
  vec3 color = uColor * (0.24 + fresnel * 1.08 + scanBand * 0.18);
  float alpha = 0.018 + fresnel * 0.060 + scanBand * 0.016;
  gl_FragColor = vec4(color, alpha);
}
`

function makeSurfaceMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: SURFACE_VERT,
    fragmentShader: SURFACE_FRAG,
    uniforms: {
      uColor: { value: HOLO_CYAN.clone() },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

function makeWireMaterial() {
  return new THREE.MeshBasicMaterial({
    color: HOLO_CYAN,
    transparent: true,
    opacity: 0.105,
    wireframe: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  })
}

function makeEdgeMaterial() {
  return new THREE.LineBasicMaterial({
    color: HOLO_HI,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
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

/** 柔和的径向光晕纹理：用于风机周围的弥散能量，不是白色实体灯。 */
let glowTexture: THREE.CanvasTexture | null = null
function getGlowTexture() {
  if (glowTexture) return glowTexture
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(150,245,255,0.48)')
  gradient.addColorStop(0.18, 'rgba(45,210,255,0.24)')
  gradient.addColorStop(0.52, 'rgba(25,145,220,0.09)')
  gradient.addColorStop(1, 'rgba(0,60,120,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  glowTexture = new THREE.CanvasTexture(canvas)
  glowTexture.colorSpace = THREE.SRGBColorSpace
  glowTexture.needsUpdate = true
  return glowTexture
}

function AuraSprite({ position, scale, opacity }: {
  position: [number, number, number]
  scale: [number, number, number]
  opacity: number
}) {
  const material = useMemo(() => new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color: new THREE.Color(0.018, 0.32, 0.54),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  }), [opacity])

  useEffect(() => () => material.dispose(), [material])
  return <sprite position={position} scale={scale} material={material} />
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

/** 透明实体 + 三角线框 + 清晰轮廓线，构成真实模型的全息层。 */
function HoloPart({ geometry, edge, surface, wire, line, position, rotation, scale }: HoloPartProps) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geometry} material={surface} />
      <mesh geometry={geometry} material={wire} />
      <lineSegments geometry={edge} material={line} scale={[1.003, 1.003, 1.003]} />
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
    edgeRef.current.opacity = 0.47 + Math.sin(t * 1.6 + x * 0.01 + z * 0.008) * 0.08
    if (spin.current) spin.current.rotation.z += dt * speed * 1.15
    if (root.current) {
      const target = D2R(yawDeg)
      root.current.rotation.y += (target - root.current.rotation.y) * Math.min(1, dt * 3)
    }
  })

  return (
    <group position={[x, y, z]}>
      {/* 两层弥散光晕：塔筒接地能量 + 轮毂周围的空气辉光 */}
      <AuraSprite position={[0, 44, 0]} scale={[54, 132, 1]} opacity={0.105} />
      <AuraSprite position={[0, 91, 5]} scale={[148, 112, 1]} opacity={0.075} />

      {/* 数字孪生基座：黑色吸光盘与冰青能量环 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.55, 0]}>
        <circleGeometry args={[13, 48]} />
        <meshBasicMaterial color="#01070d" transparent opacity={0.72} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.9, 0]}>
        <ringGeometry args={[9.2, 10.4, 64]} />
        <meshBasicMaterial color={new THREE.Color(0.015, 0.32, 0.50)} transparent opacity={0.38} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.05, 0]}>
        <ringGeometry args={[4.0, 4.42, 56]} />
        <meshBasicMaterial color={new THREE.Color(0.025, 0.55, 0.75)} transparent opacity={0.52} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} />
      </mesh>
      {servo && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 2.0, 0]}>
          <ringGeometry args={[13.5, 14.7, 72]} />
          <meshBasicMaterial color={new THREE.Color(0.035, 0.62, 0.82)} transparent opacity={0.56} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} />
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
