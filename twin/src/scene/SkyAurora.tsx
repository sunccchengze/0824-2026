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

// 冰青夜空 + 地平极光带 + 星场（基准图 W1/W2）
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
  float h = clamp(d.y, -0.08, 1.0);

  // 夜空纵向渐变：近黑蓝 → 深靛
  vec3 col = mix(vec3(0.016, 0.05, 0.09), vec3(0.006, 0.016, 0.035), smoothstep(0.0, 0.55, h));

  // 地平附近青调雾辉
  col += vec3(0.03, 0.11, 0.14) * pow(1.0 - abs(h), 6.0) * 1.25;

  // 极光带：贴地平、随方位起伏、时变漂移（右上象限偏亮）
  float az = atan(d.z, d.x); // -PI..PI
  float band = smoothstep(0.16, 0.02, abs(h - 0.075 - 0.045 * sin(az * 1.6)));
  float drift = fbm(vec2(az * 2.2 + uTime * 0.02, h * 9.0 - uTime * 0.05));
  float rays = fbm(vec2(az * 9.0, h * 26.0 - uTime * 0.028));
  float aur = band * smoothstep(0.32, 0.75, drift) * (0.45 + 0.55 * rays);
  float azBoost = 0.55 + 0.45 * smoothstep(-0.4, 0.9, -cos(az - 0.65));
  vec3 auroraCol = mix(vec3(0.10, 0.85, 0.62), vec3(0.24, 0.72, 1.0), clamp(h * 6.0, 0.0, 1.0));
  col += auroraCol * aur * 0.9 * azBoost;

  // 星场（稀疏、轻微闪烁）
  vec2 sp = d.xz / max(0.18, d.y + 0.25);
  vec2 cell = floor(sp * 260.0);
  float star = step(0.9965, hash(cell));
  float tw = 0.6 + 0.4 * sin(uTime * 1.7 + hash(cell + 7.7) * 40.0);
  col += vec3(0.75, 0.9, 1.0) * star * tw * smoothstep(0.02, 0.24, h) * 0.85;

  gl_FragColor = vec4(col, 1.0);
}
`

export default function SkyAurora() {
  const mat = useRef<THREE.ShaderMaterial>(null!)
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), [])
  useFrame((state) => { if (mat.current) mat.current.uniforms.uTime.value = state.clock.elapsedTime })
  return (
    <mesh frustumCulled={false}>
      <sphereGeometry args={[4200, 32, 24]} />
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
