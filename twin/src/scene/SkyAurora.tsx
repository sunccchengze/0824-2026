import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// R4/R5 真实天空层：AI 生成的本地 equirectangular 天空纹理提供真实云层、银河
// 和星点；程序化层只负责保留原图的冰青地平线、极光和动态微光，不改变整体色调。
const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform sampler2D uSkyTex;

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

  // 原图底色：地平线青霭 → 高天深蓝
  vec3 col = mix(vec3(0.062, 0.175, 0.230), vec3(0.010, 0.042, 0.075), smoothstep(0.0, 0.16, h));
  col = mix(col, vec3(0.002, 0.008, 0.018), smoothstep(0.12, 0.55, h));

  // 真实天空纹理：球面方向 → 2:1 equirectangular UV。
  // 只在上半球混入，地平线仍由原图冰青雾化层控制，保证色调不漂移。
  vec2 skyUv = vec2(0.5 + atan(d.x, -d.z) / 6.28318530718,
                    0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.14159265359);
  vec3 photoSky = texture2D(uSkyTex, skyUv).rgb;
  photoSky *= vec3(0.82, 0.91, 1.0);
  float photoMask = smoothstep(0.075, 0.30, h);
  col = mix(col, photoSky, photoMask * 0.86);

  // 地平线宽亮带（原图发光地平线：亮核 + 宽裙）
  col += vec3(0.16, 0.44, 0.55) * pow(clamp(1.0 - abs(h), 0.0, 1.0), 13.0) * 1.35;
  col += vec3(0.05, 0.16, 0.22) * pow(clamp(1.0 - abs(h), 0.0, 1.0), 5.0) * 0.55;

  // 左上冷光辉（基准图左侧天际亮斑，含月亮意象，克制）
  float glowL = exp(-pow((az + 0.42) * 3.4, 2.0)) * exp(-h * 14.0);
  col += vec3(0.55, 0.72, 0.85) * glowL * 0.14;

  // 顶部全宽柔光（原图标题后背景亮青雾）
  col += vec3(0.06, 0.17, 0.24) * pow(clamp(1.0 - abs(h), 0.0, 1.0), 3.0) * exp(-h * 2.4) * 0.38;

  // 极光带：保留原图方向与冰青色，只作为真实云银河纹理之上的动态叠层
  float sect = smoothstep(0.22, 0.86, cos(az - 0.72));
  float bandC = 0.08 + 0.036 * (az - 0.62);
  float band = smoothstep(0.075, 0.008, abs(h - bandC));
  float rays = fbm(vec2(az * 17.0, h * 42.0 - uTime * 0.06));
  float drift = fbm(vec2(az * 3.0 + uTime * 0.015, h * 4.0));
  float aur = band * sect * smoothstep(0.26, 0.70, drift) * (0.36 + 1.05 * rays);
  vec3 aurCol = mix(vec3(0.40, 0.84, 0.95), vec3(0.14, 0.48, 0.84), clamp((h - 0.02) * 10.0, 0.0, 1.0));
  col += aurCol * aur * 1.45;
  col += aurCol * sect * exp(-abs(h) * 11.0) * 0.16;

  // 纹理自带真实星场，保留少量动态星点让数字孪生画面仍有呼吸感
  vec2 sp = d.xz / max(0.18, d.y + 0.28);
  vec2 cell = floor(sp * 300.0);
  float star = step(0.9955, hash(cell));
  float tw = 0.55 + 0.45 * sin(uTime * 1.6 + hash(cell + 7.7) * 40.0);
  col += vec3(0.70, 0.86, 1.0) * star * tw * smoothstep(0.03, 0.22, h) * 0.20;

  gl_FragColor = vec4(col, 1.0);
}
`

export default function SkyAurora() {
  const mat = useRef<THREE.ShaderMaterial>(null!)
  const skyTexture = useLoader(THREE.TextureLoader, '/sky-realistic-cyan.png')
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uSkyTex: { value: skyTexture } }), [skyTexture])

  useEffect(() => {
    skyTexture.colorSpace = THREE.SRGBColorSpace
    skyTexture.anisotropy = 4
  }, [skyTexture])

  useFrame((state) => {
    if (mat.current) mat.current.uniforms.uTime.value = state.clock.elapsedTime
  })

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
