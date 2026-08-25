import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// R2 冰青夜空：天际线辉光 + 右上极光带（基准图 W1/W2，极光仅在东北扇区、贴地一线）
const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.52; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;                       // 仰角 sin
  float az = atan(d.x, -d.z);          // 方位：北=0、东=+π/2（屏幕右）

  // 夜空纵向渐变：地平线青霭 → 高天黑蓝
  vec3 col = mix(vec3(0.062, 0.175, 0.230), vec3(0.010, 0.042, 0.075), smoothstep(0.0, 0.16, h));
  col = mix(col, vec3(0.002, 0.008, 0.018), smoothstep(0.12, 0.55, h));

  // 地平线宽亮带（原图发光地平线：亮核 + 宽裙）
  col += vec3(0.16, 0.44, 0.55) * pow(clamp(1.0 - abs(h), 0.0, 1.0), 13.0) * 1.35;
  col += vec3(0.05, 0.16, 0.22) * pow(clamp(1.0 - abs(h), 0.0, 1.0), 5.0) * 0.55;

  // 左上冷光辉（基准图左侧天际亮斑，含月亮意象，克制）
  float glowL = exp(-pow((az + 0.42) * 3.4, 2.0)) * exp(-h * 14.0);
  col += vec3(0.55, 0.72, 0.85) * glowL * 0.14;

  // 顶部全宽柔光（原图标题后背景亮青雾）
  col += vec3(0.06, 0.17, 0.24) * pow(clamp(1.0 - abs(h), 0.0, 1.0), 3.0) * exp(-h * 2.4) * 0.38;

  // 极光带：宽扇区细光柱，白青色调（原图极光洒落上缘左中）
  float sect = smoothstep(0.22, 0.86, cos(az - 0.72));
  float bandC = 0.08 + 0.036 * (az - 0.62);                       // 带中心随方位缓升
  float band = smoothstep(0.075, 0.008, abs(h - bandC));
  float rays = fbm(vec2(az * 17.0, h * 42.0 - uTime * 0.06));     // 竖向光柱
  float drift = fbm(vec2(az * 3.0 + uTime * 0.015, h * 4.0));
  float aur = band * sect * smoothstep(0.26, 0.70, drift) * (0.36 + 1.05 * rays);
  vec3 aurCol = mix(vec3(0.40, 0.84, 0.95), vec3(0.14, 0.48, 0.84), clamp((h - 0.02) * 10.0, 0.0, 1.0));
  col += aurCol * aur * 1.45;
  // 极光带的地面漫射微光
  col += aurCol * sect * exp(-abs(h) * 11.0) * 0.16;

  // 星场：稀疏、近地平线淡出
  vec2 sp = d.xz / max(0.18, d.y + 0.28);
  vec2 cell = floor(sp * 300.0);
  float star = step(0.9955, hash(cell));
  float tw = 0.55 + 0.45 * sin(uTime * 1.6 + hash(cell + 7.7) * 40.0);
  col += vec3(0.70, 0.86, 1.0) * star * tw * smoothstep(0.03, 0.22, h) * 0.8;

  gl_FragColor = vec4(col, 1.0);
}
`

export default function SkyAurora() {
  const mat = useRef<THREE.ShaderMaterial>(null!)
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), [])
  useFrame((state) => { if (mat.current) mat.current.uniforms.uTime.value = state.clock.elapsedTime })
  return (
    <mesh frustumCulled={false}>
      <sphereGeometry args={[6800, 48, 28]} />
      <shaderMaterial
        ref={mat}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  )
}
