import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainHeight } from './terrainUtil'
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
      const shade = 0.88 + hash2(Math.round(cz / CELL) + 57, Math.round(cx / CELL) - 31) * 0.24
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

    const u = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0, 1) } }
    const m = new THREE.MeshStandardMaterial({
      color: '#040a12',
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.02,
      envMapIntensity: 0.1,
      flatShading: true,
    })
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = u.uTime
      shader.uniforms.uWind = u.uWind
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'attribute float aRnd;\nvarying float vW;\nuniform float uTime;\nuniform vec2 uWind;\nvoid main() {')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  float ph = dot(wp.xz, uWind) * 0.0105 - uTime * 2.15 + aRnd * 1.9;
  float wv = sin(ph) * 0.5 + 0.5;
  float ph2 = dot(wp.xz, vec2(uWind.y, -uWind.x)) * 0.0068 + uTime * 1.05 + aRnd * 4.7;
  float wv2 = sin(ph2) * 0.5 + 0.5;
  transformed.y += (wv - 0.42) * 6.6 * (0.55 + aRnd * 0.9) + (wv2 - 0.5) * 2.3;
  vW = clamp(wv * 0.78 + wv2 * 0.22, 0.0, 1.0);`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying float vW;\nvoid main() {')
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
  float flow = smoothstep(0.50, 0.985, vW);
  totalEmissiveRadiance += vec3(0.05, 0.155, 0.205) * flow;`,
        )
    }
    m.customProgramCacheKey = () => 'terrain-wave-v3'
    m.userData.u = u
    return { geo: ng, mat: m }
  }, [])

  useFrame((state) => {
    const uu = mat.userData.u as { uTime: { value: number }; uWind: { value: THREE.Vector2 } }
    uu.uTime.value = state.clock.elapsedTime
    const { fromDeg } = windAt(useSim.getState().tHours)
    const th = (fromDeg * Math.PI) / 180
    uu.uWind.value.set(Math.sin(th), Math.cos(th)) // 风的去向（北来→+z）
  })

  return <mesh geometry={geo} material={mat} receiveShadow />
}
