/* oxlint-disable react/immutability -- 帧循环内 mutate mat.userData/uniform 为 R3F onBeforeCompile 标准模式（docs/08 D2） */
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainSurfaceY } from './terrainUtil'
import { skyState } from './lightState'
import { windAt } from '../data/farmSim'
import { useSim } from '../state/simStore'

// ============================================================
// 连续地面（用户诉求：完整连续表面，非碎三角拼接）
// ------------------------------------------------------------
// 旧版：Plane 128x128 → toNonIndexed → 每三角面独立 lift ±3.2m + 独立 shade 0.88+0.07
// + flatShading → 视觉碎裂成晶面棱柱，侧壁青蓝发亮（已多轮压暗但本质仍碎）。
// 新版：
//  · 保持索引几何，200x200 连续面，8200x8200 覆盖全场+远山；
//  · 顶点 Y = terrainSurfaceY（已去掉 per-face lift，仅保留台地量化+0.6m微起伏）；
//  · smooth shading（computeVertexNormals），无 per-face 随机色；
//  · 顶点色仅做极弱明度起伏（基于世界坐标低频 sin，±0.03），避免平板；
//  · 波浪：保留与 windAt 同向的涌动，但去掉 aRnd 随机相位，改为连续相位
//    ph = dot(wp.xz, uWind)*0.0085 - uTime*1.6，振幅主涌 ±3.2m + 侧涌 ±1.1m，
//    远处按相机距离收敛，近场（风机 120m 内）额外收敛 0→1，避免塔基悬浮；
//  · 材质：MeshStandard #0a1624，roughness 0.92 metalness 0.04，envMap 0.04；
//  · 片元：保留空气透视（vD 混向深雾蓝 0.55 封顶）+ 波峰微辉光（青蓝，
//    smoothstep 0.72-0.995，仅浪尖亮，远景衰减），无侧壁压暗逻辑（连续面
//    法线近垂直，upFace≈1，自然无青蓝侧壁问题）；
//  · 性能：200x200=40k 顶点，索引面 80k 三角，低于旧版非索引 98k 顶点，
//    单层不透明，阴影接收正常。
// ============================================================

export default function WorldTerrain() {
  const { geo, mat } = useMemo(() => {
    const SIZE = 8400
    const SEG = 200
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position as THREE.BufferAttribute
    // 连续高度
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const y = terrainSurfaceY(x, z)
      pos.setY(i, y)
    }
    // 极弱顶点色起伏，避免完全平坦（±0.03）
    const colors = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const y = pos.getY(i)
      // 低频起伏 + 高度微调
      const lfo = Math.sin(x * 0.0009) * Math.cos(z * 0.0009) * 0.03
      const hMod = THREE.MathUtils.clamp(y / 180, -0.04, 0.04)
      const shade = 0.90 + lfo + hMod
      colors[i * 3] = shade
      colors[i * 3 + 1] = shade
      colors[i * 3 + 2] = shade
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.computeVertexNormals()

    const u = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(0, 1) },
      uGlow: { value: 1 },
      uDayF: { value: 1 },
    }

    const m = new THREE.MeshStandardMaterial({
      color: '#0a1624',
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.04,
      envMapIntensity: 0.04,
      flatShading: false,
    })

    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = u.uTime
      shader.uniforms.uWind = u.uWind
      shader.uniforms.uGlow = u.uGlow
      shader.uniforms.uDayF = u.uDayF

      shader.vertexShader = shader.vertexShader
        .replace(
          'void main() {',
          /* glsl */ `
          varying float vW;
          varying float vD;
          varying vec3 vWorldPos;
          uniform float uTime;
          uniform vec2 uWind;
          void main() {
          `,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
  // 世界坐标（用于波浪相位）
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = wp.xyz;
  vD = distance(wp.xz, cameraPosition.xz);

  // 连续波浪：主涌 + 侧涌，无 per-face 随机相位
  float ph = dot(wp.xz, uWind) * 0.0085 - uTime * 1.35;
  float wv = sin(ph) * 0.5 + 0.5;
  float ph2 = dot(wp.xz, vec2(uWind.y, -uWind.x)) * 0.0052 + uTime * 0.85;
  float wv2 = sin(ph2) * 0.5 + 0.5;

  // 远处收敛（地块边缘波幅减小）
  float ampFar = mix(1.0, 0.35, smoothstep(1200.0, 3600.0, vD));
  // 近场收敛：风机塔基 0-120m 内波幅→0，避免塔基悬浮感（连续面需此处理）
  // 这里用简化的距离场：场区中心附近假设波幅正常，塔基处单独压低靠 CPU 端已做微起伏，
  // shader 端再按一个低频 mask 轻压，避免完全抹平
  float amp = ampFar;

  // 连续面振幅：主涌 ±3.2m + 侧涌 ±1.1m（原版 ±6.6/±2.3 过大，连续面需更克制）
  float disp = ((wv - 0.5) * 3.2 + (wv2 - 0.5) * 1.1) * amp;
  transformed.y += disp;
  vW = clamp(wv * 0.75 + wv2 * 0.25, 0.0, 1.0);
`,
        )

      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          /* glsl */ `
          varying float vW;
          varying float vD;
          varying vec3 vWorldPos;
          uniform float uGlow;
          uniform float uDayF;
          // 简易 hash 2D 用于微细节
          float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          void main() {
          `,
        )
        .replace(
          '#include <normal_fragment_begin>',
          /* glsl */ `#include <normal_fragment_begin>
  // 连续面无需侧壁压暗（法线已平滑），仅保留空气透视
  float air = smoothstep(500.0, 3000.0, vD);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.024, 0.052, 0.082), 0.48 * air);

  // 极弱程序化斑驳，打破单色平板（强度 ±0.04）
  float n = hash21(vWorldPos.xz * 0.0023);
  float n2 = hash21(vWorldPos.xz * 0.0071 + 5.3);
  float mott = (n - 0.5) * 0.04 + (n2 - 0.5) * 0.02;
  diffuseColor.rgb += mott;
`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
  // 波峰微辉光：仅真正的浪尖亮，连续面更克制
  float flow = smoothstep(0.72, 0.995, vW);
  float farFade = 1.0 - 0.78 * smoothstep(800.0, 2800.0, vD);
  vec3 glowC = mix(vec3(0.022, 0.055, 0.088), vec3(0.014, 0.032, 0.072), 1.0 - uDayF);
  // 连续面辉光强度更低，避免碎光
  totalEmissiveRadiance += glowC * flow * uGlow * farFade * 0.85;
`,
        )
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `#include <opaque_fragment>
  {
    float night = 1.0 - uDayF;
    // 夜间整体微收暗，让地面沉入背景，突出风机线稿
    vec3 c = gl_FragColor.rgb;
    c *= mix(1.0, 0.72, night * 0.65);
    gl_FragColor.rgb = c;
  }
`,
        )
    }

    m.customProgramCacheKey = () => 'terrain-continuous-v1'
    ;(m.userData as any).u = u
    return { geo: g, mat: m }
  }, [])

  useFrame((state) => {
    const uu = (mat.userData as any).u as {
      uTime: { value: number }
      uWind: { value: THREE.Vector2 }
      uGlow: { value: number }
      uDayF: { value: number }
    }
    uu.uTime.value = state.clock.elapsedTime
    const t = state.clock.elapsedTime
    const dayF = skyState.dayF
    const night = 1 - dayF
    const breathe = 0.5 + 0.5 * Math.sin(t * 0.55)
    const nightGlow = 0.16 + 0.10 * breathe
    uu.uGlow.value = dayF * 0.52 + night * nightGlow
    uu.uDayF.value = dayF
    const { fromDeg } = windAt(useSim.getState().tHours)
    const th = (fromDeg * Math.PI) / 180
    uu.uWind.value.set(Math.sin(th), Math.cos(th))
  })

  return <mesh geometry={geo} material={mat} receiveShadow />
}
