import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainSurfaceY, landMask, biomeWeights, mulberry32 } from './terrainUtil'

// ============================================================
// 草地系统真实核心（第 32 轮 A 新建：暂不挂载，Step A 只做"有"，看数、看线框）
// ------------------------------------------------------------
//  · 6 万实例 blade 交叉面片：草原带 4 万 + 林下 2 万（拒绝采样，按 biomeWeights 落位）；
//  · 顶点摆动（正弦风场 + 相位抖动，攒动感来自相位差而非大幅位移）；
//  · 干湿分区染色（世界坐标噪声：干黄 ↔ 湿绿；林下偏暗黄绿）；
//  · 光照只做「方向光漫反射近似 + 高度渐变 + 指数雾」，不吃 PBR、不吃阴影；
//  · 挂载前需在 TwinScene 中 <GrassField/>（当前未挂载，R32 不进入渲染帧）。
// 注意：本文件只消费 terrainUtil 纯函数（terrainSurfaceY/landMask/biomeWeights），
//       不反向影响地形 mesh 与贴地基准。
// ============================================================

const GRASS_COUNT = 40000
const FLOOR_COUNT = 20000

const VERT = /* glsl */ `
attribute vec3 aOffset;   // 世界落位（根部）
attribute vec3 aParam;    // x: 缩放 s, y: 相位, z: 朝向角
attribute float aKind;    // 0 草原 blade, 1 林下 blade
uniform float uTime;
uniform vec2 uWind;
varying float vShade;
varying float vKind;
varying float vFogDepth;
varying float vDry;

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }

void main() {
  float s = aParam.x;
  float phase = aParam.y;
  float ang = aParam.z;
  float c = cos(ang), si = sin(ang);
  // 局部 blade：position.x ∈ [-0.5,0.5]（宽）, position.y ∈ [0,1]（高，基底已抬到 0）
  vec3 p = position;
  p.x *= (1.0 - uv.y * 0.85);          // 向上收窄成 blade
  p = vec3(p.x * c, p.y, -p.x * si + p.z * c);
  // 风摆：顶部摆幅大、根部不动；相位差制造攒动
  float sway = sin(uTime * 1.35 + phase + dot(aOffset.xz, uWind) * 0.02);
  float sway2 = sin(uTime * 2.30 + phase * 1.7);
  float bendAmt = uv.y * uv.y * s;
  p.x += (sway * 0.35 + sway2 * 0.08) * bendAmt;
  p.z += (sway * 0.22 - sway2 * 0.06) * bendAmt;
  vec3 world = aOffset + p * vec3(s * 0.55, s, s * 0.55);
  // 干湿分区（与片元同式，各自算一份避免 varying 精度问题可接受，此处只做明暗）
  float dry = hash21(floor(aOffset.xz * 0.05));
  vDry = dry;
  vKind = aKind;
  // 高度渐变：根暗、梢亮；叠加摆动微光
  vShade = (0.45 + 0.55 * uv.y) * (0.92 + 0.08 * sway);
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`

const FRAG = /* glsl */ `
precision highp float;
varying float vShade;
varying float vKind;
varying float vFogDepth;
varying float vDry;
uniform float uDayF;
uniform vec3 uFogColor;
uniform float uFogDensity;

void main() {
  // 干(黄) ↔ 湿(绿)；林下整体压暗偏黄
  vec3 dryCol = mix(vec3(0.30, 0.26, 0.10), vec3(0.20, 0.17, 0.07), vKind);
  vec3 wetCol = mix(vec3(0.10, 0.24, 0.08), vec3(0.07, 0.15, 0.07), vKind);
  vec3 col = mix(wetCol, dryCol, smoothstep(0.35, 0.75, vDry));
  col *= vShade;
  // 昼夜：只保留方向光漫反射近似的明暗比例
  col *= mix(vec3(0.16, 0.18, 0.24), vec3(1.0), uDayF);
  // 指数雾（与场景雾同式）
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`

interface GrassSet {
  geo: THREE.InstancedBufferGeometry
  mat: THREE.ShaderMaterial
  count: number
}

function buildSet(kind: 0 | 1, count: number, seed: number): GrassSet {
  // 基底：两块交叉竖面（1×1，基底 y=0）
  const p1 = new THREE.PlaneGeometry(1, 1)
  p1.translate(0, 0.5, 0)
  const p2 = new THREE.PlaneGeometry(1, 1)
  p2.rotateY(Math.PI / 2)
  p2.translate(0, 0.5, 0)
  const base = new THREE.BufferGeometry()
  const posArr: number[] = []
  const uvArr: number[] = []
  const idxArr: number[] = []
  let vi = 0
  for (const p of [p1, p2]) {
    const pp = p.attributes.position as THREE.BufferAttribute
    const uu = p.attributes.uv as THREE.BufferAttribute
    const ii = p.index as THREE.BufferAttribute
    for (let i = 0; i < pp.count; i++) {
      posArr.push(pp.getX(i), pp.getY(i), pp.getZ(i))
      uvArr.push(uu.getX(i), uu.getY(i))
    }
    for (let i = 0; i < ii.count; i++) idxArr.push(ii.getX(i) + vi)
    vi += pp.count
  }
  base.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3))
  base.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2))
  base.setIndex(idxArr)

  const geo = new THREE.InstancedBufferGeometry()
  geo.attributes.position = base.attributes.position
  geo.attributes.uv = base.attributes.uv
  geo.setIndex(base.getIndex())
  geo.instanceCount = count

  const offsets = new Float32Array(count * 3)
  const params = new Float32Array(count * 3)
  const kinds = new Float32Array(count)
  const rnd = mulberry32(seed)
  let placed = 0
  let guard = 0
  while (placed < count && guard < count * 60) {
    guard++
    const x = (rnd() * 2 - 1) * 4550
    const z = (rnd() * 2 - 1) * 4550
    const L = landMask(x, z)
    if (L < 0.05) continue
    const w = biomeWeights(x, z)
    const key = kind === 0 ? w.grass : w.forest
    if (rnd() > key) continue
    const y = terrainSurfaceY(x, z)
    offsets[placed * 3] = x
    offsets[placed * 3 + 1] = y - 0.15 // 根部微埋，避免悬空
    offsets[placed * 3 + 2] = z
    const s = kind === 0 ? 1.1 + rnd() * 1.2 : 0.7 + rnd() * 0.8
    params[placed * 3] = s
    params[placed * 3 + 1] = rnd() * Math.PI * 2
    params[placed * 3 + 2] = rnd() * Math.PI
    kinds[placed] = kind
    placed++
  }
  geo.instanceCount = placed
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3))
  geo.setAttribute('aParam', new THREE.InstancedBufferAttribute(params, 3))
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1))

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(0.8, 0.6) },
      uDayF: { value: 1 },
      uFogColor: { value: new THREE.Color('#040911') },
      uFogDensity: { value: 0.00013 }, // C4：默认值随 App 场景雾
    },
    side: THREE.DoubleSide,
  })
  mat.customProgramCacheKey = () => 'grass-blade-v1'
  return { geo, mat, count: placed }
}

export default function GrassField() {
  const grass = useMemo(() => buildSet(0, GRASS_COUNT, 1337), [])
  const floor = useMemo(() => buildSet(1, FLOOR_COUNT, 7331), [])
  const ref = useRef<THREE.Group>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    for (const s of [grass, floor]) {
      const u = s.mat.uniforms as Record<string, { value: unknown }>
      ;(u.uTime as { value: number }).value = t
    }
  })

  // 未挂载验证用：如需看数可临时在 TwinScene 挂 <GrassField/>（R32 默认不挂）
  return (
    <group ref={ref}>
      <mesh geometry={grass.geo} material={grass.mat} frustumCulled={false} />
      <mesh geometry={floor.geo} material={floor.mat} frustumCulled={false} />
    </group>
  )
}


