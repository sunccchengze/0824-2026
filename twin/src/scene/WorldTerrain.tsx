import { useMemo } from 'react'
import * as THREE from 'three'
import { terrainHeight } from './terrainUtil'

// 朴素的地形表面：不再使用科技网格，也不使用泥土图片。
// 地面只保留墨青色磨砂材质、细腻程序微表面和极弱的静态等高线质感。
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

  // 很淡的静态等高线：沿真实 terrainHeight 生成，不是科技网格，不会移动。
  float contour = 1.0 - smoothstep(0.0, 0.16, abs(fract(vWorld.y / 28.0) - 0.5));
  contour *= smoothstep(0.02, 0.16, grazing);

  vec3 dark = vec3(0.006, 0.016, 0.023);
  vec3 coolRock = vec3(0.018, 0.065, 0.078);
  vec3 color = mix(dark, coolRock, macro * 0.72 + fine * 0.18);
  color += vec3(0.015, 0.055, 0.070) * crack * 0.35;
  color += vec3(0.008, 0.028, 0.038) * micro * 0.28;
  color += vec3(0.012, 0.042, 0.050) * contour * 0.22;
  float alpha = (0.12 + macro * 0.12 + grazing * 0.05 + contour * 0.045) * distanceFade;
  gl_FragColor = vec4(color, alpha);
}
`

// W4/W5 真实地形表面：起伏由 terrainHeight 负责，表面由暗色 PBR + 程序微表面负责。
export default function WorldTerrain() {
  const { geo, detailGeo, detailMat } = useMemo(() => {
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
      fog: false,
    })

    return { geo: g, detailGeo: dg, detailMat: dm }
  }, [])

  return (
    <group>
      <mesh geometry={geo}>
        <meshStandardMaterial
          color="#040911"
          transparent
          opacity={0.94}
          roughness={0.98}
          metalness={0.02}
          envMapIntensity={0.10}
        />
      </mesh>
      <mesh geometry={detailGeo} material={detailMat} renderOrder={0} />
    </group>
  )
}
