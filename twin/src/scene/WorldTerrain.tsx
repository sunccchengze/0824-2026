import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainHeight } from './terrainUtil'
import { skyState } from './lightState'
import { windAt } from '../data/farmSim'
import { useSim } from '../state/simStore'

// ============================================================
// 晶面地形（第 12 轮 R3：单层化）
// 旧实现是两层：静止的不透明基底 + 上浮 0.32m 的半透明"波动罩"——
// 波动层 alpha 低，观感上"地面在静止的顶层下面动"，浪永远不明显。
// 现删掉独立波动层：海浪位移直接注入地形本体的 MeshStandardMaterial
// （onBeforeCompile），于是——
//   · 唯一一层，不透明，阴影照常接收（turbine 影随波面弯折）；
//   · flatShading 的法线由片元导数求得，波动后的晶面高光自动跟着涌起；
//   · 波前沿风流增亮写入 totalEmissiveRadiance（青白单色相，克制）；
//   · 振幅 ±6.6m 主涌 + ±2.3m 侧涌，传播方向与 windAt 同风源（地面=风向仪）。
// 高程语义不变：terrainHeight ×0.58 + 26m 台地量化 ×0.42 + 逐面 ±3.2m 抬沉。
// 第 23 轮（视觉精修 pass）：晶面明度收敛（逐面差 0.09→0.07、均值 −0.02）
// + 片元空气透视（随 vD 混向深雾蓝，封顶 55%）——只动视觉层，
// 高程/波浪位移/贴地基准/阴影接收全部原样。
// ============================================================

function hash2(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453
  return n - Math.floor(n)
}

export default function WorldTerrain() {
  const { geo, mat } = useMemo(() => {
    const g = new THREE.PlaneGeometry(7600, 7600, 128, 128)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      // 第 20 轮：台地量化并入 terrainSurfaceY（不含逐面 lift，lift 在下面按面加）
      const h = terrainHeight(x, z)
      const terrace = Math.round(h / 26) * 26
      pos.setY(i, h * 0.58 + terrace * 0.42)
    }
    const ng = g.toNonIndexed()
    const np = ng.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(np.count * 3)
    const CELL = 7600 / 128
    for (let f = 0; f < np.count; f += 3) {
      const cx = (np.getX(f) + np.getX(f + 1) + np.getX(f + 2)) / 3
      const cz = (np.getZ(f) + np.getZ(f + 1) + np.getZ(f + 2)) / 3
      const h = hash2(Math.round(cx / CELL), Math.round(cz / CELL))
      const lift = (h - 0.5) * 6.4
      // 第 19 轮：逐面明暗差 0.24→0.09，整体色彩变化变小（用户：地面颜色过于惹眼）
      // 第 23 轮：明暗带再收窄 0.09→0.07、均值再降 0.90→0.88——
      // 地面整体在明度层级里下沉，让出九机线稿的焦点权重
      const shade = 0.88 + hash2(Math.round(cz / CELL) + 57, Math.round(cx / CELL) - 31) * 0.07
      for (let k = 0; k < 3; k++) {
        np.setY(f + k, np.getY(f + k) + lift)
        colors[(f + k) * 3] = shade
        colors[(f + k) * 3 + 1] = shade
        colors[(f + k) * 3 + 2] = shade
      }
    }
    ng.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    // 每三角面一个随机相位（逐面独立涌动的种子）
    const rnds = new Float32Array(np.count)
    for (let f2 = 0; f2 < np.count / 3; f2++) {
      const rv = hash2(f2 * 7 + 13, (f2 * 31) % 191)
      for (let k = 0; k < 3; k++) rnds[f2 * 3 + k] = rv
    }
    ng.setAttribute('aRnd', new THREE.BufferAttribute(rnds, 1))
    ng.computeVertexNormals()
    g.dispose()

    const u = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0, 1) }, uGlow: { value: 1 } }
    const m = new THREE.MeshStandardMaterial({
      color: '#02060c',
      vertexColors: true,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0.03,
      flatShading: true,
    })
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = u.uTime
      shader.uniforms.uWind = u.uWind
      shader.uniforms.uGlow = u.uGlow
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'attribute float aRnd;\nvarying float vW;\nvarying float vD;\nuniform float uTime;\nuniform vec2 uWind;\nvoid main() {')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  float ph = dot(wp.xz, uWind) * 0.0105 - uTime * 2.15 + aRnd * 1.9;
  float wv = sin(ph) * 0.5 + 0.5;
  float ph2 = dot(wp.xz, vec2(uWind.y, -uWind.x)) * 0.0068 + uTime * 1.05 + aRnd * 4.7;
  float wv2 = sin(ph2) * 0.5 + 0.5;
  vD = distance(wp.xz, cameraPosition.xz);
  // 远处（趋近地块边缘）逐面起伏收敛：面法线抖动小了，月光下的碎高光就不再"杂乱"
  float amp = mix(1.0, 0.42, smoothstep(1100.0, 3400.0, vD));
  transformed.y += ((wv - 0.42) * 6.6 * (0.55 + aRnd * 0.9) + (wv2 - 0.5) * 2.3) * amp;
  vW = clamp(wv * 0.78 + wv2 * 0.22, 0.0, 1.0);`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying float vW;\nvarying float vD;\nuniform float uGlow;\nvoid main() {')
        // 第 21 轮：晶面"侧面"压暗。
        // flatShading 下每个三角面法线恒定，陡面法线更朝向光源 → 侧面比顶面亮，
        // 于是起伏处密布亮侧壁，画面显碎。这里按法线朝上程度衰减漫反射：
        // up=1（水平顶面）不变，up→0（垂直侧壁）降到 0.30。
        // 放在 normal_fragment_begin 之后（此处 normal 已就绪，光照尚未计算）。
        .replace(
          '#include <normal_fragment_begin>',
          /* glsl */ `#include <normal_fragment_begin>
  float upFace = abs(normal.y);
  diffuseColor.rgb *= mix(0.30, 1.0, smoothstep(0.0, 0.62, upFace));
  // 第 23 轮：空气透视（与场景 FogExp2 互补）。
  // 随相机水平距离把晶面漫反射混向深雾蓝色调：面间明暗台阶被抹平、
  // 中远景整体下沉——近排最亮、中排次之、远排收进雾色，
  // 九机阵列的纵深层次由地面明度梯度直接承担。
  // 混合目标非纯黑（保留西北远山剪影可读），权重 0.55 封顶。
  float air = smoothstep(420.0, 2800.0, vD);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.024, 0.052, 0.082), 0.55 * air);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
  // 第 19 轮：波峰辉光整体压暗（亮度约 −55%）、色相往青灰收（去蓝绿），
  // 且 smoothstep 上下沿抬高收窄 → 只有真正的浪尖才亮，面与面的明暗跳动变小。
  float flow = smoothstep(0.68, 0.995, vW);
  float far = 1.0 - 0.82 * smoothstep(700.0, 2600.0, vD); // 远景轮廓光衰减（加强）
  // 侧壁不吃波前辉光，否则刚压暗的侧面又被 emissive 点回来
  totalEmissiveRadiance += vec3(0.030, 0.070, 0.088) * flow * uGlow * far * mix(0.18, 1.0, smoothstep(0.0, 0.62, abs(normal.y)));`,
        )
    }
    m.customProgramCacheKey = () => 'terrain-wave-v7'
    m.userData.u = u
    return { geo: ng, mat: m }
  }, [])

  useFrame((state) => {
    const uu = mat.userData.u as { uTime: { value: number }; uWind: { value: THREE.Vector2 }; uGlow: { value: number } }
    uu.uTime.value = state.clock.elapsedTime
    // 夜间波前增亮收半（用户：夜里对比过高）；白天保持
    // 白天上限由 1.00 降到 0.72，夜间下限 0.45→0.34
    uu.uGlow.value = 0.34 + 0.38 * skyState.dayF
    const { fromDeg } = windAt(useSim.getState().tHours)
    const th = (fromDeg * Math.PI) / 180
    uu.uWind.value.set(Math.sin(th), Math.cos(th)) // 风的去向（北来→+z）
  })

  return <mesh geometry={geo} material={mat} receiveShadow />
}
