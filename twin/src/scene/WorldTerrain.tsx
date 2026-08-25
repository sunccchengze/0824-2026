import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainHeight } from './terrainUtil'

const GRID_VERT = /* glsl */ `
varying vec2 vUvW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vUvW = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

// 无限感科技网格：细网格、主网格和沿网格移动的数据流脉冲。
const GRID_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUvW;
uniform vec3 uColor;
uniform float uCell;
uniform float uSect;
uniform float uTime;

float gridLine(vec2 p, float w) {
  vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  return smoothstep(0.0, w, line);
}

void main() {
  float minor = gridLine(vUvW / uCell, 0.9);
  float major = gridLine(vUvW / uSect, 0.9);
  float line = max(minor, major);
  float fade = clamp(1.0 - length(vUvW) / 4300.0, 0.0, 1.0);

  // 两组沿 X/Z 方向奔跑的窄脉冲，表现数据在地面网格上传输。
  float pulseX = pow(max(0.0, sin(vUvW.x * 0.011 - uTime * 2.0)), 28.0);
  float pulseZ = pow(max(0.0, sin(vUvW.y * 0.014 - uTime * 1.55)), 28.0);
  float flow = max(pulseX, pulseZ) * line;

  vec3 flowColor = mix(uColor, vec3(0.04, 0.72, 0.86), flow);
  float alpha = (minor * 0.065 + major * 0.18 + flow * 0.30) * fade;
  gl_FragColor = vec4(flowColor, alpha);
}
`

// 非图片的微表面层：用多尺度程序噪声提供细腻岩面颗粒、裂隙和微弱湿润变化。
// 它不是泥土图片贴图，主体仍是 #040911 的暗色半透明科技地面。
const DETAIL_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const DETAIL_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vN;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amp * noise(p);
    p = p * 2.03 + 17.1;
    amp *= 0.5;
  }
  return value;
}

void main() {
  vec2 p = vWorld.xz;
  float macro = fbm(p * 0.0032);
  float fine = fbm(p * 0.026);
  float micro = noise(p * 0.16);
  float crack = smoothstep(0.68, 0.82, fine) * smoothstep(0.40, 0.62, noise(p * 0.012 + 4.0));
  float distanceFade = clamp(1.0 - length(p) / 3900.0, 0.0, 1.0);
  float grazing = 1.0 - max(dot(normalize(vN), vec3(0.0, 1.0, 0.0)), 0.0);

  vec3 dark = vec3(0.006, 0.016, 0.023);
  vec3 coolRock = vec3(0.018, 0.065, 0.078);
  vec3 color = mix(dark, coolRock, macro * 0.72 + fine * 0.18);
  color += vec3(0.015, 0.055, 0.070) * crack * 0.35;
  color += vec3(0.008, 0.028, 0.038) * micro * 0.28;
  float alpha = (0.12 + macro * 0.12 + grazing * 0.05) * distanceFade;
  gl_FragColor = vec4(color, alpha);
}
`

// W4/W5 真实地形表面：起伏由 terrainHeight 负责，表面由暗色 PBR + 程序微表面负责。
export default function WorldTerrain() {
  const { geo, detailGeo, gridGeo, detailMat, gridMat } = useMemo(() => {
    const g = new THREE.PlaneGeometry(7600, 7600, 220, 220)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)))
    }
    g.computeVertexNormals()

    // 微表面层略微抬高，避免与 PBR 基面 z-fighting。
    const dg = g.clone()
    const dpos = dg.attributes.position
    for (let i = 0; i < dpos.count; i++) dpos.setY(i, dpos.getY(i) + 0.32)
    dg.computeVertexNormals()
    const dm = new THREE.ShaderMaterial({
      vertexShader: DETAIL_VERT,
      fragmentShader: DETAIL_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      fog: true,
    })

    // 覆盖全场的科技地面网格，而不是只在中间铺一小块。
    const gg = new THREE.PlaneGeometry(7600, 7600, 180, 180)
    gg.rotateX(-Math.PI / 2)
    const gp = gg.attributes.position
    for (let i = 0; i < gp.count; i++) gp.setY(i, terrainHeight(gp.getX(i), gp.getZ(i)) + 0.70)
    const gm = new THREE.ShaderMaterial({
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color('#00a8c5') },
        uCell: { value: 96 },
        uSect: { value: 480 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: true,
    })
    return { geo: g, detailGeo: dg, gridGeo: gg, detailMat: dm, gridMat: gm }
  }, [])

  useFrame((state) => {
    gridMat.uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <group>
      <mesh geometry={geo}>
        <meshStandardMaterial
          color="#040911"
          transparent
          opacity={0.92}
          roughness={0.98}
          metalness={0.02}
          envMapIntensity={0.10}
        />
      </mesh>
      <mesh geometry={detailGeo} material={detailMat} renderOrder={0} />
      <mesh geometry={gridGeo} material={gridMat} renderOrder={1} />
    </group>
  )
}
