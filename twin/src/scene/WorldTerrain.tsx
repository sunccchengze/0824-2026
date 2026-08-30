import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainHeight } from './terrainUtil'
import { windAt } from '../data/farmSim'
import { useSim } from '../state/simStore'

// 朴素的地形表面：不再使用科技网格，也不使用泥土图片。
// 地面只保留墨青色磨砂材质、细腻程序微表面和极弱的静态等高线质感。
// 任务#11：碎晶"顺风流"层——逐面（aRnd）沿风向行波轻微起伏 + 波前增亮，
// 既是风场指示器又活跃画面；海浪基调：贴地 ±6.2m 主涌 + ±2.1m 侧波，周期 ~1s 级（放大后仍被 7.6km 地形稀释，不遮挡风机基座）。
const DETAIL_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
varying float vW;
attribute float aRnd;
uniform float uTime;
uniform vec2 uWind;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // 海浪式双列波：主涌顺风流推进（波长大、振幅 6.2m）+ 侧向中长波调制，
  // 波峰线在脊前翻卷增亮——远看是整片"结冰海面"在随风起伏
  float ph = dot(wp.xz, uWind) * 0.0105 - uTime * 2.15 + aRnd * 1.9;
  float wv = sin(ph) * 0.5 + 0.5;
  float ph2 = dot(wp.xz, vec2(uWind.y, -uWind.x)) * 0.0068 + uTime * 1.05 + aRnd * 4.7;
  float wv2 = sin(ph2) * 0.5 + 0.5;
  wp.y += (wv - 0.42) * 6.2 * (0.55 + aRnd * 0.9) + (wv2 - 0.5) * 2.1;
  vW = clamp(wv * 0.78 + wv2 * 0.22, 0.0, 1.0);
  vWorld = wp.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const DETAIL_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vN;
varying float vW;

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
  // 波前顺风流光（青白，单一色相）
  float flow = smoothstep(0.54, 0.985, vW);
  color += vec3(0.030, 0.105, 0.140) * flow;
  float alpha = (0.12 + macro * 0.12 + grazing * 0.05 + contour * 0.045 + flow * 0.10) * distanceFade;
  gl_FragColor = vec4(color, alpha);
}
`

// 任务#6 晶面地形：起伏仍由 terrainHeight 负责（物理/锚点口径不变），
// 渲染面在其上叠加"晶体刻面"语义：
//   · 高程按 26 m 台地量化(混合 0.42)——形成冰晶断台；
//   · 逐三角面 ±3.2 m 确定性小抬沉 + 平面法线（flat facets）；
//   · 面颜色按法线/随机做 ±12% 明度抖动（vertexColors），不引入新色相；
//   · 半透明晶感（opacity 0.9）+ 接收阴影（LightRig 主灯）。
// 微表面 detail 层保持原实现，贴合在同一量化面上。
function hash2(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453
  return n - Math.floor(n)
}

export default function WorldTerrain() {
  const { geo, detailGeo, detailMat } = useMemo(() => {
    const g = new THREE.PlaneGeometry(7600, 7600, 128, 128)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    // 台地量化（晶面基底）
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const h = terrainHeight(x, z)
      const terrace = Math.round(h / 26) * 26
      pos.setY(i, h * 0.58 + terrace * 0.42)
    }
    // 逐面抬沉 + 顶点色
    const ng = g.toNonIndexed()
    const np = ng.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(np.count * 3)
    const CELL = 7600 / 128
    for (let f = 0; f < np.count; f += 3) {
      const cx = (np.getX(f) + np.getX(f + 1) + np.getX(f + 2)) / 3
      const cz = (np.getZ(f) + np.getZ(f + 1) + np.getZ(f + 2)) / 3
      const h = hash2(Math.round(cx / CELL), Math.round(cz / CELL))
      const lift = (h - 0.5) * 6.4
      const shade = 0.88 + hash2(Math.round(cz / CELL) + 57, Math.round(cx / CELL) - 31) * 0.24
      for (let k = 0; k < 3; k++) {
        np.setY(f + k, np.getY(f + k) + lift)
        colors[(f + k) * 3] = shade
        colors[(f + k) * 3 + 1] = shade
        colors[(f + k) * 3 + 2] = shade
      }
    }
    ng.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    // 每三角面一个随机相位（贴面独立起伏；detail 层同源共享）
    const rnds = new Float32Array(np.count / 3 * 3)
    for (let f2 = 0; f2 < np.count / 3; f2++) {
      const rv = hash2(f2 * 7 + 13, (f2 * 31) % 191)
      for (let k = 0; k < 3; k++) rnds[f2 * 3 + k] = rv
    }
    ng.setAttribute('aRnd', new THREE.BufferAttribute(rnds, 1))
    ng.computeVertexNormals() // 非索引 → 平面法线，晶面高光由此而来

    // 微表面层贴合量化面（等高线按 vWorld.y，仍与台面/坡面自洽）。
    const dg = ng.clone()
    const dpos = dg.attributes.position
    for (let i = 0; i < dpos.count; i++) dpos.setY(i, dpos.getY(i) + 0.32)
    dg.setAttribute('aRnd', ng.getAttribute('aRnd'))
    const dm = new THREE.ShaderMaterial({
      vertexShader: DETAIL_VERT,
      fragmentShader: DETAIL_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(0, 1) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      fog: false,
    })

    return { geo: ng, detailGeo: dg, detailMat: dm }
  }, [])

  useFrame((state) => {
    const u = detailMat.uniforms
    u.uTime.value = state.clock.elapsedTime
    const { fromDeg } = windAt(useSim.getState().tHours)
    const th = (fromDeg * Math.PI) / 180
    u.uWind.value.set(Math.sin(th), Math.cos(th)) // 风的去向（北来→+z）
  })

  return (
    <group>
      <mesh geometry={geo} receiveShadow>
        <meshStandardMaterial
          color="#040911"
          vertexColors
          transparent
          opacity={0.9}
          roughness={0.86}
          metalness={0.06}
          envMapIntensity={0.14}
          flatShading
        />
      </mesh>
      <mesh geometry={detailGeo} material={detailMat} renderOrder={0} />
    </group>
  )
}
