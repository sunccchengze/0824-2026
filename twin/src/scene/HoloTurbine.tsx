import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// ================================================================
// 全息冰青风机（原图像素级还原）：发光塔筒 + 发光翼型三叶 + 能量核心
// 通过 fresnel 辉光 shader 出“冰雕通体发光”质感，配合后期 Bloom
// ================================================================

const HOLA_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vP = position;
  gl_Position = projectionMatrix * mv;
}
`
const HOLA_FRAG = /* glsl */ `
precision highp float;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
uniform vec3 uColor;      // 冰青主体
uniform vec3 uCore;       // 近白核心
uniform float uFresnel;
uniform float uHeight;    // 塔高渐变参考（发光沿高度分布）
uniform float uTime;
void main() {
  float ndv = max(dot(vN, vV), 0.0);
  float fres = pow(1.0 - ndv, 2.2);
  // 沿高度的渐变：底部微蓝、上部近白
  float g = clamp(vP.y / max(uHeight, 1.0), 0.0, 1.0);
  g = pow(g, 0.72);
  // 微呼吸
  float pulse = 0.92 + 0.08 * sin(uTime * 1.9 + vP.y * 0.13);
  vec3 base = mix(uColor * 0.55, uCore, g);
  vec3 col = base * (0.35 + 0.65 * fres) + uColor * fres * uFresnel;
  gl_FragColor = vec4(col * pulse, 1.0);
}
`

function makeHoloMat(color: string, core: string, fresnel: number, height: number) {
  return new THREE.ShaderMaterial({
    vertexShader: HOLA_VERT,
    fragmentShader: HOLA_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uCore: { value: new THREE.Color(core) },
      uFresnel: { value: fresnel },
      uHeight: { value: height },
      uTime: { value: 0 },
    },
  })
}

/** 冰霜翼型叶片：Extrude 平面轮廓（弦长沿展向收敛 + 后掠弧度） */
function buildHoloBlade(len = 58): THREE.BufferGeometry {
  const s = new THREE.Shape()
  const N = 14
  s.moveTo(0, 0)
  // 前缘（leading edge，先上后收）
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const chord = 4.1 * (1 - t * 0.87) * (1 - 0.10 * Math.sin(t * Math.PI))
    const sweep = t * t * 8.5
    s.lineTo(-sweep + chord * 0.5, t * len)
  }
  // 后缘（trailing edge，回收）
  for (let i = N; i >= 0; i--) {
    const t = i / N
    const chord = 4.1 * (1 - t * 0.87) * (1 - 0.10 * Math.sin(t * Math.PI))
    const sweep = t * t * 8.5
    s.lineTo(-sweep - chord * 0.5, t * len)
  }
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.05, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 2, steps: 1 })
  g.translate(0, 0, -0.52)
  return g
}

let holoGeo: {
  tower: THREE.BufferGeometry
  blades: THREE.BufferGeometry
  nacelle: THREE.BufferGeometry
  hub: THREE.BufferGeometry
} | null = null
function getHoloGeo() {
  if (holoGeo) return holoGeo
  const tower = new THREE.CylinderGeometry(0.5, 0.95, 92, 14, 1, true)
  tower.translate(0, 46, 0)
  const blades = buildHoloBlade(58)
  const nacelle = new THREE.SphereGeometry(2.6, 20, 14)
  nacelle.scale(1.55, 0.78, 1.05)
  const hub = new THREE.SphereGeometry(1.35, 16, 12)
  holoGeo = { tower, blades, nacelle, hub }
  return holoGeo
}

/** 通体发光能量核心（内芯）材质，Additive */
const CORE_MAT = new THREE.MeshBasicMaterial({
  color: new THREE.Color(0.9, 2.0, 2.55),
  transparent: true, opacity: 0.5,
  blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
})

export default function HoloTurbine({ x, z, y, yawDeg, speed, servo }: {
  x: number; z: number; y: number; yawDeg: number; speed: number; servo: boolean
}) {
  const root = useRef<THREE.Group>(null!)
  const spin = useRef<THREE.Group>(null!)
  const sheath = useMemo(() => makeHoloMat('#2ec8f8', '#f4ffff', 2.4, 92), [])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    sheath.uniforms.uTime.value = t
    if (spin.current) spin.current.rotation.z += dt * speed * 1.15 // ≈11 rpm 域
    if (root.current) {
      const target = THREE.MathUtils.degToRad(yawDeg)
      root.current.rotation.y += (target - root.current.rotation.y) * Math.min(1, dt * 3)
    }
  })

  const geo = getHoloGeo()
  return (
    <group position={[x, y, z]}>
      {/* 基座：接触光盘 + 同心光环 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.7, 0]}>
        <circleGeometry args={[11, 40]} />
        <meshBasicMaterial color="#02070d" transparent opacity={0.62} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.05, 0]}>
        <ringGeometry args={[7.4, 8.3, 56]} />
        <meshBasicMaterial color={new THREE.Color(0.5, 1.5, 1.9)} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.0, 0]}>
        <ringGeometry args={[4.0, 4.35, 48]} />
        <meshBasicMaterial color={new THREE.Color(0.85, 2.0, 2.5)} transparent opacity={0.75} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>

      <group ref={root} scale={1.12}>
        {/* 塔筒：外鞘 fresnel + 内芯发光 */}
        <mesh geometry={geo.tower} material={sheath} />
        <mesh geometry={geo.tower} material={CORE_MAT} scale={0.985} />

        {/* 机舱 + 轮毂 */}
        <mesh geometry={geo.nacelle} material={sheath} position={[0, 93.4, 1.6]} />
        <mesh geometry={geo.hub} material={sheath} position={[0, 93.4, 6.0]} />
        {/* 航空灯 */}
        <mesh position={[0, 95.6, 0.6]}>
          <sphereGeometry args={[0.5, 10, 10]} />
          <meshBasicMaterial color={new THREE.Color(0.8, 2.2, 2.6)} transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
        </mesh>

        {/* 三叶转子 */}
        <group position={[0, 93.4, 6.4]} rotation={[-THREE.MathUtils.degToRad(5), 0, 0]}>
          <group ref={spin}>
            {[0, 1, 2].map((i) => (
              <group key={i} rotation={[0, 0, (i * Math.PI * 2) / 3]}>
                <mesh geometry={geo.blades} material={sheath} position={[0, 27.5, -1.4]} rotation={[0, 0, -90]} />
                <mesh geometry={geo.blades} material={CORE_MAT} position={[0, 27.5, -1.4]} rotation={[0, 0, -90]} scale={0.965} />
              </group>
            ))}
            <mesh geometry={geo.hub} material={sheath} scale={1.5} />
          </group>
        </group>
      </group>

      {/* 舵机联动标记：目标机组的光环提升高度 */}
      {servo && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 2.0, 0]}>
          <ringGeometry args={[13.5, 14.6, 64]} />
          <meshBasicMaterial color={new THREE.Color(0.7, 1.8, 2.3)} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
        </mesh>
      )}
    </group>
  )
}
