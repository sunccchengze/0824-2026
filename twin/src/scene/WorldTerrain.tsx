/* oxlint-disable react/immutability -- 帧循环内 mutate mat.userData/uniform 为 R3F onBeforeCompile 标准模式（docs/08 D2） */
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainSurfaceY } from './terrainUtil'
import { skyState } from './lightState'
import { windAt } from '../data/farmSim'
import { useSim } from '../state/simStore'

// ============================================================
// 海洋地面（用户诉求：这是一片「海」，不是碎三角 / 灰色噪声平板）
// ------------------------------------------------------------
// 目标：白天湛蓝、波涛汹涌；夜间漆黑如墨、暗潮涌动。全程连续曲面。
//
// 方案：保留「世界真值源」terrainSurfaceY 作为海底基底（风机/升压站/电缆
// 全部贴它定位，零回归），着色器把它渲染成一片真实海洋——
//   · 基底高度 mask：盆地（surfaceY 低，≈风机区）判为「海水」；
//     远山（surfaceY 高，>~90m）判为「海岸陆地剪影」，二者自然过渡。
//   · 顶点：多方向 Gerstner 波动叠加（经典海洋 shader，同 Sean-Bradley
//     three.js ocean 思路），形成汹涌波浪；近场按离场心距离收敛振幅，
//     避免塔基悬浮。
//   · 片元：真实的海洋光照——
//       - Fresnel 菲涅尔：低角度反射天空色（白天=湛蓝天色，夜间=暗色）
//         水才「透亮」；
//       - 深度/浪高配色：浪谷深蓝、浪尖浅蓝；
//       - 太阳/月亮镜面高光（uSunDir 白天=太阳、夜间=月亮，LightRig 已混合）；
//       - 波峰泡沫（白色/夜间幽蓝）；
//       - 微法线扰动（程序噪声）制造「波光粼粼」；
//       - 指数雾（FogExp2）空气透视。
//   · 昼夜：uDayF 白天→湛蓝强光；夜晚→漆黑如墨 + 微弱青蓝暗潮微光。
//   · 材质：ShaderMaterial（完全自控光照），depthWrite 不透明，单面。
//   · 性能：200x200 顶点的连续索引面（40k 顶点/80k 三角），GPU 单层。
// ============================================================

const VERT = /* glsl */ `
varying float vWater;
varying float vCrest;
varying vec3 vWPos;
varying vec3 vWN;
uniform float uTime;
uniform vec2 uWind;

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }

// —— Gerstner 波：经典深海波，steepness=波陡，wavelength=波长 ——
vec3 gerstner(vec2 pos, vec2 dir, float steepness, float wavelength, float time,
              inout vec3 tangent, inout vec3 binormal) {
  float k = 6.28318530718 / wavelength;
  float c = sqrt(9.8 / k);
  vec2 d = normalize(dir);
  float f = k * (dot(d, pos) - c * time);
  float a = steepness / k;
  tangent += vec3(
    -d.x * d.x * steepness * sin(f),
     d.x * steepness * cos(f),
    -d.x * d.y * steepness * sin(f));
  binormal += vec3(
    -d.x * d.y * steepness * sin(f),
     d.y * steepness * cos(f),
    -d.y * d.y * steepness * sin(f));
  return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;

  // 基底高度（海底）：position.y 来自 terrainSurfaceY（世界真值）
  float baseY = position.y;
  // 水陆 mask：基底低→水(1)，高→陆地(0)。收窄过渡带，避免泛白"湿岩"带
  float water = smoothstep(80.0, 50.0, baseY);
  vWater = water;

  // 近场收敛：离场心越近，波浪越收敛（避免塔基悬浮、风场稳定）
  float d = length(wp.xz - vec2(-100.0, -640.0));
  float amp = mix(0.42, 1.0, smoothstep(120.0, 1500.0, d));

  // 主涌方向：与来流一致（风从北来=+z，uWind=(sin,cos) of fromDeg）
  vec2 wdir = normalize(uWind + vec2(0.0001, 0.0));
  vec2 d2 = normalize(vec2(-uWind.y, uWind.x));
  vec2 d3 = normalize(uWind * 0.5 + vec2(0.6, -0.2));
  vec2 d4 = normalize(vec2(0.3, 0.9) * (uWind.y < 0.0 ? -1.0 : 1.0));

  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 disp = vec3(0.0);

  vec2 p = wp.xz;
  // 不同波长/方向叠加 → 汹涌、有层次
  disp += gerstner(p, wdir, 0.14, 420.0, uTime * 0.9, tangent, binormal);
  disp += gerstner(p, d2,   0.11, 260.0, uTime * 1.15 + 1.7, tangent, binormal);
  disp += gerstner(p, d3,   0.09, 150.0, uTime * 1.4 + 3.1, tangent, binormal);
  disp += gerstner(p, d4,   0.07, 86.0,  uTime * 1.7 + 5.3, tangent, binormal);
  disp *= amp;

  // 波浪只在海上位移；陆地保持原始剪影
  float lift = water;
  vec3 newPos = vec3(wp.x, baseY + disp.y * lift, wp.z);
  newPos.xz += disp.xz * lift * 0.9;

  // 波峰程度（用于泡沫 & 高光）
  float crestVal = clamp(disp.y / max(0.001, (0.14/ (6.28318/420.0)) * 4.0), -1.0, 1.0);
  vCrest = smoothstep(0.42, 0.96, crestVal);

  // 法线：混合 Gerstner 法线与原始上向法线，陆地用原始法线
  vec3 gNorm = normalize(cross(binormal, tangent));
  vec3 n = normalize(mix(vec3(0.0, 1.0, 0.0), gNorm, water));
  vWN = n;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;
varying float vWater;
varying float vCrest;
varying vec3 vWPos;
varying vec3 vWN;
uniform float uTime;
uniform float uDayF;
uniform float uGlow;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform float uFogDensity;

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1.0,0.0)), u.x),
             mix(hash21(i+vec2(0.0,1.0)), hash21(i+vec2(1.0,1.0)), u.x), u.y);
}

void main() {
  float night = 1.0 - uDayF;
  vec3 N = normalize(vWN);
  vec3 V = normalize(cameraPosition - vWPos);
  float ndv = max(dot(N, V), 0.0);

  // —— 微法线扰动：波光粼粼（细碎镜面）——
  float nA = vnoise(vWPos.xz * 0.055 + uTime * 0.18);
  float nB = vnoise(vWPos.xz * 0.022 - uTime * 0.11);
  vec3 micro = normalize(N + vec3((nA - 0.5) * 0.28, 0.0, (nB - 0.5) * 0.28));
  vec3 Ns = normalize(mix(N, micro, vWater * 0.55));

  // —— Fresnel 菲涅尔：越贴水面越反射天空 ——
  // 陡峭近岸坡面法线接近水平（N.y 小），掠射角反射会发白。
  // 用「面朝上程度」gate 掉坡面反射：只有近似水平的水面才反射天空。
  float upness = smoothstep(0.28, 0.62, N.y);
  float fres = pow(1.0 - ndv, 3.4) * upness;

  // —— 配色：昼=湛蓝，夜=漆黑如墨 ——
  // 白天的蓝要「湛蓝」：饱和、深邃，不泛白。抬蓝、压红绿 → 更纯净的蓝。
  vec3 deepCol  = mix(vec3(0.008, 0.026, 0.055), vec3(0.010, 0.14, 0.40), uDayF); // 浪谷
  vec3 shallowCol = mix(vec3(0.022, 0.060, 0.100), vec3(0.05, 0.40, 0.68), uDayF);  // 浪尖
  // 高度混合（vCrest 高 = 浅/亮）
  vec3 waterCol = mix(deepCol, shallowCol, vCrest * 0.70);

  // 天空反射色：白天是深邃的天蓝（贴晴朗海面），夜间近黑
  vec3 skyRef = mix(vec3(0.018, 0.040, 0.080), vec3(0.06, 0.36, 0.72), uDayF);
  waterCol = mix(waterCol, skyRef, clamp(fres, 0.0, 1.0) * (0.16 + 0.24 * uDayF));

  // —— 太阳/月亮镜面高光 ——
  // 近水面低角度会形成高光亮带（specular glitter path）。加大指数让亮斑
  // 收得更"碎"，乘上微法线噪声让波光闪烁，而不是连成一片白。
  vec3 halfV = normalize(V + uSunDir);
  float spec = pow(max(dot(Ns, halfV), 0.0), 300.0 + night * 160.0);
  // 用高频噪声打散高光，形成"碎金波光"
  float sparkle = 0.5 + 0.5 * sin(vWPos.x * 0.11 + vWPos.z * 0.07 + uTime * 2.3);
  spec *= (0.30 + 0.70 * sparkle);
  vec3 sunCol = mix(vec3(0.12, 0.26, 0.40), vec3(0.98, 0.96, 0.86), uDayF);
  waterCol += sunCol * spec * (uDayF * 1.2 + night * 0.20);

  // 波峰泡沫（昼=白，夜=幽蓝，克制）
  vec3 foam = mix(vec3(0.02, 0.06, 0.10), vec3(0.86, 0.96, 1.00), uDayF);
  float foamAmt = vCrest * vCrest;
  waterCol = mix(waterCol, foam, foamAmt * (0.14 + uDayF * 0.48));

  // 夜间暗潮微光：极弱青蓝，让「暗潮涌动」仍可辨认（月光方向的暗涌）
  // 用太阳方向的月光项，在夜间呈现一波波幽蓝涌动
  float moonSpec = pow(max(dot(Ns, halfV), 0.0), 200.0);
  waterCol += vec3(0.05, 0.14, 0.22) * moonSpec * night * uGlow * 0.35;
  waterCol += vec3(0.02, 0.07, 0.12) * vCrest * night * uGlow * 0.45;

  // —— 陆地（远山剪影）：深色 + 微弱程序斑驳，与海上区分 ——
  vec3 landCol = vec3(0.010, 0.026, 0.048) + vec3(0.010, 0.024, 0.046) * uDayF;
  float nm = vnoise(vWPos.xz * 0.0021);
  landCol += (nm - 0.5) * 0.05;
  landCol += vec3(0.014, 0.045, 0.065) * uDayF * 0.55;

  vec3 col = mix(landCol, waterCol, vWater);

  // —— 空气透视（指数雾）：削弱对海水的洗白，保「湛蓝」——
  float dist = length(cameraPosition - vWPos);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  // 陆地更吃雾（远山有空气感），海水稍轻（保住湛蓝；清晨/傍晚低角度加大雾感）
  float fogMix = mix(fogF, fogF * 0.40, vWater);
  col = mix(col, uFogColor, clamp(fogMix, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`

export default function WorldTerrain() {
  const { geo, mat } = useMemo(() => {
    const SIZE = 8400
    const SEG = 200
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const y = terrainSurfaceY(x, z)
      pos.setY(i, y)
    }
    g.computeVertexNormals()

    const u = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(0, 1) },
      uDayF: { value: 1 },
      uGlow: { value: 1 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uFogColor: { value: new THREE.Color('#040911') },
      uFogDensity: { value: 0.00022 },
    }

    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: u,
      side: THREE.FrontSide,
      transparent: false,
      depthWrite: true,
      fog: false,
    })
    m.customProgramCacheKey = () => 'terrain-ocean-v2'
    ;(m.userData as any).u = u
    return { geo: g, mat: m }
  }, [])

  useFrame((state) => {
    const uu = (mat.userData as any).u as {
      uTime: { value: number }
      uWind: { value: THREE.Vector2 }
      uDayF: { value: number }
      uGlow: { value: number }
      uSunDir: { value: THREE.Vector3 }
      uFogColor: { value: THREE.Color }
      uFogDensity: { value: number }
    }
    uu.uTime.value = state.clock.elapsedTime
    const t = state.clock.elapsedTime
    const dayF = skyState.dayF
    const night = 1 - dayF
    const breathe = 0.5 + 0.5 * Math.sin(t * 0.55)
    const nightGlow = 0.14 + 0.10 * breathe
    uu.uGlow.value = dayF * 0.6 + night * nightGlow
    uu.uDayF.value = dayF
    uu.uSunDir.value.copy(skyState.sunDir)
    const { fromDeg } = windAt(useSim.getState().tHours)
    const th = (fromDeg * Math.PI) / 180
    uu.uWind.value.set(Math.sin(th), Math.cos(th))
    const scene = state.scene
    if (scene.fog && (scene.fog as THREE.FogExp2).isFogExp2) {
      uu.uFogColor.value.copy((scene.fog as THREE.FogExp2).color)
      uu.uFogDensity.value = (scene.fog as THREE.FogExp2).density
    }
  })

  return <mesh geometry={geo} material={mat} />
}
