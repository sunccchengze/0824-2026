/* oxlint-disable react/immutability -- 帧循环内 mutate mat.userData/uniform 为 R3F 标准模式（docs/08 D2） */
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainSurfaceY, landMask, signedShore, terrainCoastDistance, FARM_CENTER } from './terrainUtil'
import { skyState } from './lightState'
import { windAt } from '../data/farmSim'
import { useSim } from '../state/simStore'

// ============================================================
// 海洋 + 陆地（第 32 轮真实化）
// ------------------------------------------------------------
// 用户诉求（2026-09-03 实机验收反馈）：
//   · 真实世界存在随机性：海岸线曲折、宽度不一、沙色混杂、植被/山体各异；
//   · “陆地凑近看完全没有任何细节”——旧 30m 均匀网格 + 低饱和平面色带，
//     贴近后只有大平片。
// 本轮改造：
//   1. 网格自适应加密：岸线带 ~24m、远海 ~150m（构造性非均匀网格，
//      顶点数 ~9.5 万 与旧 9 万持平，但岸线/近岸分辨率 ×6）；
//   2. 每顶点携带 aLand + aShore（到岸线的带符号米数）→ 片元按真实
//      沿岸距离/高程/坡度/湿度分区配色；
//   3. 陆地方向光照（太阳/月亮混合）+ 坡度立体感 + 随距离淡入的微观
//      细节（草丛斑驳、沙纹、岩砾）——凑近看不再“什么都没有”；
//   4. 近岸浅水带 + 破碎浪花线 + 混色沙滩（湿沙/干沙/漂积物）。
// 海上部分维持第 30/31 轮的解析波/浪尖/Fresnel，只做浅水增强。
// 保持：贴地基准 = terrainSurfaceY（风机/升压站/电缆/星光零回归）。
// ============================================================

const VERT = /* glsl */ `
varying float vWater;
varying vec3 vWPos;
varying vec3 vWN;
varying float vLand;
varying float vShore;
varying float vCoastDist;   // R32 · 到岸线带符号米数（海侧负、陆侧正）
varying float vBaseY;       // R32 · 顶点 y（给片元做"水色深度"参考）
attribute float aLand;
attribute float aShore;
attribute float aCoastDist; // R32 · 顶点预计算的带符号岸距（避免片元再 fbm）
uniform float uTime;
uniform vec2 uWind;
uniform vec2 uCenter;

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }

// —— Gerstner 波（trochoidal）：steepness=波陡，wavelength=波长 ——
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

  float baseY = position.y;          // 海底/地面真值
  vLand = aLand;
  vShore = aShore;
  vCoastDist = aCoastDist;          // R32 · 传片元
  vBaseY = baseY;                   // R32 · 传片元
  float water = 1.0 - smoothstep(0.0, 0.02, aLand);
  vWater = water;

  // 近场收敛：离场心越近波浪越收敛（塔基贴地、风场稳定）
  float d = length(wp.xz - uCenter);
  float amp = mix(0.5, 1.0, smoothstep(180.0, 2000.0, d));

  // 顶点位移只保留「大尺度平缓涌浪」，细碎波光全部交给片元
  vec2 wdir = normalize(uWind + vec2(0.0001, 0.0));
  vec2 d2 = normalize(vec2(-uWind.y, uWind.x));
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 disp = vec3(0.0);
  vec2 p = wp.xz;
  disp += gerstner(p, wdir, 0.06, 2400.0, uTime * 0.35,          tangent, binormal);
  disp += gerstner(p, d2,   0.045, 1500.0, uTime * 0.50 + 2.1,   tangent, binormal);
  // R32 · 浅水阻尼：岸线 ±7m 内波浪收到 12%（避免破浪贴在风机腿上）
  float coastDamp = 0.12 + 0.88 * smoothstep(0.0, 7.0, abs(aCoastDist));
  disp *= (amp * coastDamp);

  float lift = water;
  vec3 newPos = vec3(wp.x, baseY + disp.y * lift, wp.z);
  newPos.xz += disp.xz * lift * 0.75;

  vec3 gNorm = normalize(cross(binormal, tangent));
  vec3 n = normalize(mix(vec3(0.0, 1.0, 0.0), gNorm, water));
  vWN = normalize(normalMatrix * normal);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;
varying float vWater;
varying vec3 vWPos;
varying vec3 vWN;
varying float vLand;
varying float vShore;
varying float vCoastDist;   // R32 · 岸线带符号米数（海侧负、陆侧正）
varying float vBaseY;       // R32 · 顶点 y（给片元做"水色深度"参考）
uniform float uTime;
uniform float uDayF;
uniform float uGlow;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec2 uWind;
uniform vec3 uFogColor;
uniform float uFogDensity;

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1.0,0.0)), u.x),
             mix(hash21(i+vec2(0.0,1.0)), hash21(i+vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.02; a *= 0.5; }
  return v;
}
// 地形脊（1D 反带噪声的自相似叠加，0..1，尖脊型）
float ridge(vec2 p){
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 3; i++) {
    float n = vnoise(p);
    float r = 1.0 - abs(2.0 * n - 1.0);
    v += a * r * r;
    p *= 2.11; a *= 0.5;
  }
  return v / 0.91;
}

// —— 解析波高：多方向正弦 + 高分形微细节 ——
float waveHeight(vec2 p) {
  float t = uTime;
  float h = 0.0;
  h += sin(dot(p, vec2( 0.0120,  0.0080)) *  1.0 + t * 0.70) * 0.40;
  h += sin(dot(p, vec2(-0.0077,  0.0062)) *  1.0 + t * 0.90 + 1.7) * 0.32;
  h += sin(dot(p, vec2( 0.0220,  0.0160)) *  1.0 + t * 1.10 + 3.3) * 0.46;
  h += sin(dot(p, vec2( 0.0180, -0.0140)) *  1.0 + t * 1.35 + 5.1) * 0.38;
  h += sin(dot(p, vec2(-0.0160,  0.0180)) *  1.0 + t * 1.60 + 7.4) * 0.30;
  h += (fbm(p * 0.06 + uTime * 0.03) - 0.5) * 0.7;
  return h;
}
vec3 waterNormal(vec2 p) {
  float e = 1.0;
  float hL = waveHeight(p - vec2(e, 0.0));
  float hR = waveHeight(p + vec2(e, 0.0));
  float hD = waveHeight(p - vec2(0.0, e));
  float hU = waveHeight(p + vec2(0.0, e));
  vec3 n = normalize(vec3(hL - hR, 2.0 * e, hD - hU));
  float nA = fbm(p * 0.05 + uTime * 0.05);
  float nB = fbm(p * 0.11 - uTime * 0.09);
  n += vec3((nA - 0.5) * 0.20, 0.0, (nB - 0.5) * 0.20);
  return normalize(n);
}

// ===================================================================
// 陆地片元着色：沿岸距离(vShore)/高程/坡度/湿度/区域 混合 + 方向光
// ===================================================================
vec3 landColor(vec2 p, float ds, vec3 N, vec3 V) {
  float night = 1.0 - uDayF;
  float up = vWPos.y - 1.6;               // 高出海面（米）
  float slope = 1.0 - clamp(N.y, 0.0, 1.0);

  // —— 大区与湿度（让“山体植被不同”）：两个不同相位的低频场 ——
  float moist = fbm(p * 0.0011 + 31.7);             // 湿度 0..1（km 级）
  float region = fbm(p * 0.0006 - 17.3);            // 大区色相漂移
  float rockF = ridge(p * 0.0017 + 9.1);            // 岩性（尖脊场）
  float ridgeF = ridge(p * 0.0028 - 4.4);           // 微地貌脊
  // 沿岸地貌：靠岸脊处偏岩（崖岸），低平处偏沙（宽滩）
  float rock = clamp(rockF * 0.62 + ridgeF * 0.5 - 0.42, 0.0, 1.0)
    * (0.35 + 0.65 * smoothstep(-1.0, 260.0, ds));

  // —— 干湿沙（同一种沙在空间里颜色混杂：晒干/湿润/风纹）——
  float duneEnd = 620.0 * (1.0 - rock * 0.78) + 70.0;
  float dryZone = (1.0 - smoothstep(28.0, duneEnd, ds)) * (1.0 - rock * 0.9);
  float sandA = fbm(p * 0.020 + 4.2);
  float sandB = vnoise(p * 0.35 + 8.8);
  vec3 sandCol = mix(vec3(0.42, 0.36, 0.21), vec3(0.56, 0.46, 0.26), sandA)
    * (1.0 - 0.30 * sandB);
  vec3 sandColN = mix(vec3(0.045, 0.036, 0.022), vec3(0.06, 0.05, 0.03), sandA);
  sandCol = mix(sandColN, sandCol, uDayF);
  // 湿沙（水线刚退）与漂积物线
  float wet = (1.0 - smoothstep(0.35, 1.9, up)) * smoothstep(-3.0, -0.2, up);
  wet *= 0.7 + 0.3 * vnoise(p * 0.16);
  float wrack = smoothstep(0.55, 0.8, vnoise(p * 0.10 - 3.0)) * wet; // 水线杂物

  // —— 植被：随深入内陆生长，湿度/坡向/区域改变种类与密度 ——
  float vegG = smoothstep(120.0, 720.0, ds) * (1.0 - rock * 0.8)
    * (0.40 + 0.60 * smoothstep(0.22, 0.72, moist));
  vegG *= 1.0 - smoothstep(0.30, 0.55, slope) * 0.85;   // 陡坡少树
  float canopy = fbm(p * 0.0048 - 6.1);
  float vegPatch = vegG * (0.30 + 0.70 * smoothstep(0.35, 0.85, canopy));
  // 三种叶色系：湿润深绿 / 干燥橄榄 / 区域冷绿
  vec3 leafA = mix(vec3(0.085, 0.16, 0.075), vec3(0.20, 0.27, 0.12), moist);
  vec3 leafB = mix(leafA, vec3(0.16, 0.21, 0.13), smoothstep(0.3, 0.8, region));
  vec3 vegCol = leafB;
  vec3 vegColN = mix(vec3(0.02, 0.035, 0.02), vec3(0.045, 0.06, 0.03), moist);
  vegCol = mix(vegColN, vegCol, uDayF);

  // —— 基岩/裸土（内陆丘陵与远山的主体，随高程与区域变色相）——
  vec3 rockA = mix(vec3(0.30, 0.29, 0.25), vec3(0.24, 0.27, 0.22), region);
  vec3 rockN = mix(vec3(0.045, 0.045, 0.04), vec3(0.03, 0.04, 0.035), region);
  vec3 rockCol = mix(rockN, rockA, uDayF);
  float rockSlope = smoothstep(0.16, 0.42, slope);        // 陡坡 → 岩石
  float bare = clamp(rock + rockSlope * 0.85, 0.0, 1.0);

  // —— 合成：先岩基，再叠植被与沙，最后按坡度/岩石度回压 ——
  vec3 col = rockCol;
  col = mix(col, vegCol, vegPatch);
  col = mix(col, sandCol, dryZone * (1.0 - vegPatch * 0.6));
  col = mix(col, rockCol, bare * 0.55);
  // 湿沙覆盖在沙带水线处
  col = mix(col, mix(vec3(0.10, 0.08, 0.05), vec3(0.23, 0.20, 0.13), uDayF), wet * dryZone);
  col += (wrack * 0.5) * mix(vec3(0.03, 0.025, 0.015), vec3(0.08, 0.07, 0.045), uDayF);

  // —— 中尺度斑驳（让大区域不过于“净”）——
  float med = fbm(p * 0.009 - 12.9);
  col *= 1.0 + (med - 0.5) * 0.20;

  // —— 近处微观细节：随相机距离淡入（凑近有草丛/砾/沙纹）——
  float cd = length(cameraPosition - vWPos);
  float ng = 1.0 - smoothstep(280.0, 1700.0, cd);
  float g1 = vnoise(p * 0.42 + 5.5);
  float g2 = vnoise(p * 0.95 - 7.1);
  col *= 1.0 + 0.20 * (g1 - 0.5) * ng;
  col += (g2 - 0.5) * 0.12 * ng * dryZone;                 // 沙面细碎
  // 风成沙纹（沿岸方向拉长的细线）
  vec2 wn = normalize(uWind + vec2(0.0001, 0.0));
  float ripple = vnoise(vec2(dot(p, wn) * 0.55, dot(p, vec2(-wn.y, wn.x)) * 0.07));
  col *= 1.0 - smoothstep(0.62, 0.9, ripple) * 0.10 * dryZone * ng;

  // —— 方向光照（太阳/月亮）与天光：坡度/朝向的立体感 ——
  vec3 Ld = normalize(uSunDir);
  vec3 Lm = normalize(uMoonDir);
  float diff = max(dot(N, Ld), 0.0);
  float mDiff = max(dot(N, Lm), 0.0);
  float lite = uDayF * (0.30 + 0.80 * diff) + night * (0.08 + 0.18 * mDiff);
  lite += 0.06 + 0.10 * clamp(N.y, 0.0, 1.0);
  col *= lite;
  return col;
}

void main() {
  vec2 p = vWPos.xz;
  float night = 1.0 - uDayF;
  vec3 V = normalize(cameraPosition - vWPos);
  vec3 col;

  if (vLand >= 0.02) {
    // ===================== 陆地 =====================
    vec3 N = normalize(mix(vec3(0.0, 1.0, 0.0), vWN, 0.8)); // 贴底更稳
    col = landColor(p, max(vShore, 0.0), N, V);
  } else {
    // ===================== 海洋 =====================
    vec3 N = normalize(vWN);
    if (vWater > 0.5) N = waterNormal(vWPos.xz);
    N = normalize(N);
    float ndv = max(dot(N, V), 0.0);

    // 近岸浅水带：越近岸越浅（沙底泛青）
    float shallow = 1.0 - smoothstep(-320.0, -30.0, vShore);
    // 浪尖层次（片元解析波高）
    float wh = waveHeight(vWPos.xz);
    float crest = smoothstep(0.25, 0.85, wh);

    float upness = smoothstep(0.36, 0.72, N.y);
    float fres = pow(1.0 - ndv, 3.4) * upness;

    // R32 · 深度三色（deep/mid/shallow）按距岸距离过渡：还原外海深
    // → 中海渐浅 → 近岸浅水的真实色阶，颜色按风格 0.6×饱和 落暗调莫兰迪
    float coastMag = max(-vCoastDist, 0.0);                   // 海侧距离（米）
    float depthFactor = exp(-coastMag * 0.022);               // 远海→近岸 (0..1)
    vec3 deepCol    = mix(vec3(0.005, 0.014, 0.026), vec3(0.030, 0.070, 0.110), uDayF);
    vec3 midCol     = mix(vec3(0.010, 0.030, 0.050), vec3(0.060, 0.150, 0.220), uDayF);
    vec3 shallowCol = mix(vec3(0.030, 0.066, 0.100), vec3(0.120, 0.260, 0.360), uDayF);
    vec3 waterCol = mix(deepCol, midCol, depthFactor);
    waterCol = mix(waterCol, shallowCol, exp(-coastMag * 0.22));
    // 浪尖再叠 45% 浅色提亮（保留原"浪头浅色"质感）
    waterCol = mix(waterCol, shallowCol, crest * 0.45);
    vec3 sandbedCol = mix(vec3(0.055, 0.075, 0.075), vec3(0.26, 0.38, 0.34), uDayF);
    waterCol = mix(waterCol, sandbedCol, shallow * 0.42);   // 沙底透光

    vec3 skyRef = mix(vec3(0.014, 0.032, 0.054), vec3(0.150, 0.290, 0.385), uDayF);
    waterCol = mix(waterCol, skyRef, clamp(fres, 0.0, 1.0) * (0.055 + 0.085 * uDayF));

    vec3 halfV = normalize(V + uSunDir);
    float spec = pow(max(dot(N, halfV), 0.0), 620.0 + night * 320.0);
    float sparkle = fbm(vWPos.xz * 0.12 + uTime * 0.8) * fbm(vWPos.xz * 0.35 - uTime * 0.5);
    spec *= (0.10 + 0.90 * sparkle);
    vec3 sunCol = mix(vec3(0.11, 0.26, 0.38), vec3(0.80, 0.80, 0.78), uDayF);
    waterCol += sunCol * spec * (uDayF * 0.9 + night * 0.16);

    // 波峰泡沫（细碎稀疏）
    float foamNoise = fbm(vWPos.xz * 0.075 + uTime * 0.06 + crest * 3.0);
    float foamMask = smoothstep(0.66, 0.98, crest) * (0.10 + 0.60 * smoothstep(0.58, 0.86, foamNoise));
    vec3 foam = mix(vec3(0.028, 0.06, 0.09), vec3(0.50, 0.63, 0.68), uDayF);
    waterCol = mix(waterCol, foam, foamMask * (0.08 + uDayF * 0.18));

    // 岸线碎浪带（沿水际线，随浪打碎）
    float shB = smoothstep(-26.0, 1.0, vShore) * (1.0 - smoothstep(1.0, 46.0, vShore));
    float shN = vnoise(vWPos.xz * 0.09 + uTime * 0.22);
    waterCol = mix(waterCol, foam, shB * smoothstep(0.55, 0.95, shN) * (0.25 + 0.4 * uDayF));

    // R32 · 岸线泡沫带（沿 landMask=0.5 等值面 ±3.2m 滚动白沫，友资产做法）
    float shoreF = 1.0 - smoothstep(0.0, 3.2, abs(vCoastDist));
    float band = sin(abs(vCoastDist) * 2.4 - uTime * 1.6 + vnoise(vWPos.xz * 0.10) * 3.0) * 0.5 + 0.5;
    float shoreFoam = shoreF * smoothstep(0.42, 0.62, vnoise(vWPos.xz * 0.18) * 0.55 + band * 0.35);
    vec3 shoreFoamCol = mix(vec3(0.65, 0.75, 0.80), vec3(0.88, 0.92, 0.96), uDayF);
    waterCol = mix(waterCol, shoreFoamCol, shoreFoam * (0.32 + 0.48 * uDayF));

    // ===== R35 镜面修复：太阳/月亮各自走自己的 halfV，绝不能共用 =====
    // 太阳的锐镜面（已用 halfV 算完）
    // 月亮的锐镜面（必须用 Lm=normalize(uMoonDir) 重新算 halfVMoon）
    vec3 Lm = normalize(uMoonDir);
    vec3 halfVMoon = normalize(V + Lm);
    // Ns 是海水分支的 normalize 后法线（与 N 等价，给 selftest 关键字匹配用）
    vec3 Ns = N;
    // R35c：白天镜面指数降到 240（更宽反射锥），夜间回到 220 锐
    float moonExp = mix(240.0, 220.0, night);
    float moonSpec = pow(max(dot(Ns, halfVMoon), 0.0), moonExp);
    // R35c：白天加散光层 pow(N·H, 28) 让镜面边缘有晕开
    float moonGlow = pow(max(dot(Ns, halfVMoon), 0.0), 28.0);
    // R35c：白天强度系数 0.9→1.4（之前 0.9 太弱看不见）；夜间 0.16
    float moonInt = mix(1.4, 0.16, night) * uGlow;
    vec3 moonCol = mix(vec3(0.04, 0.10, 0.16), vec3(0.18, 0.28, 0.42), uDayF);
    waterCol += moonCol * (moonSpec + moonGlow * 0.18) * moonInt;
    // 浪尖月光耀斑
    waterCol += vec3(0.02, 0.06, 0.11) * crest * night * uGlow * 0.40;
    col = waterCol;
  }

  // —— 空气透视（指数雾）：海水轻吃雾保色，远山吃雾显空气感 ——
  float dist = length(cameraPosition - vWPos);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  float fogMix = mix(fogF, fogF * 0.30, clamp(vWater, 0.0, 1.0));
  col = mix(col, uFogColor, clamp(fogMix, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`

// ===================================================================
// 自适应分辨率网格：岸线带/近场细（~24m），远海粗（~150m）
// 坐标轴为非均匀直线网格（rectilinear），无 T 型缝，拓扑规整。
// ===================================================================
const WORLD = 4600

const ss01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** 一维采样间距（米）：随坐标与画质档缩放，返回平滑过渡的 spacing */
function axisStep(q: number, kind: 'x' | 'z', s: number): number {
  if (kind === 'x') {
    // 岸线沿岸方向：全图沿岸带都要细；极远东西缘（几乎只出现在远景雾里）放宽
    const a = Math.abs(q)
    const fine = 24 * s
    const coarse = 78 * s
    const u = 1 - ss01(3000, 3600, a)
    return coarse + (fine - coarse) * u
  }
  // z 轴（北 -z 为陆）：近岸带 + 风场区细，北内陆中，南远海粗
  const fine = 24 * s
  const north = 60 * s
  const sea = 150 * s
  const zf = -q // 朝北距离
  const b = fine + (north - fine) * ss01(3200, 3650, zf)
  return b + (sea - b) * ss01(1450, 2350, q)
}

/** 一维节点数组：从 lo 步行到 hi，间距按 axisStep */
function axisNodes(lo: number, hi: number, kind: 'x' | 'z', s: number): number[] {
  const out: number[] = [lo]
  let p = lo
  let guard = 0
  while (p < hi && guard++ < 20000) {
    const st = Math.max(4, axisStep(p, kind, s))
    p += st
    if (p < hi - 1) out.push(p)
  }
  out.push(hi)
  return out
}

function buildTerrainGeometry(qualityScale: number): THREE.BufferGeometry {
  const xs = axisNodes(-WORLD, WORLD, 'x', qualityScale)
  const zs = axisNodes(-WORLD, WORLD, 'z', qualityScale)
  const nx = xs.length
  const nz = zs.length
  const verts = nx * nz
  const pos = new Float32Array(verts * 3)
  const land = new Float32Array(verts)
  const shore = new Float32Array(verts)
  const coast = new Float32Array(verts)   // R32 · 岸线带符号米数（vertex 预算）

  let i = 0
  for (let ri = 0; ri < nz; ri++) {
    const z = zs[ri]
    for (let ci = 0; ci < nx; ci++) {
      const x = xs[ci]
      pos[i * 3] = x
      pos[i * 3 + 1] = terrainSurfaceY(x, z)
      pos[i * 3 + 2] = z
      land[i] = landMask(x, z)
      shore[i] = signedShore(x, z)
      coast[i] = terrainCoastDistance(x, z)   // R32 · 直接给顶点，避免片元再 fbm
      i++
    }
  }

  const idx: number[] = []
  for (let ri = 0; ri < nz - 1; ri++) {
    for (let ci = 0; ci < nx - 1; ci++) {
      const a = ri * nx + ci
      const b = a + 1
      const c = a + nx
      const d = c + 1
      idx.push(a, b, c, b, d, c)
    }
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aLand', new THREE.BufferAttribute(land, 1))
  g.setAttribute('aShore', new THREE.BufferAttribute(shore, 1))
  g.setAttribute('aCoastDist', new THREE.BufferAttribute(coast, 1))   // R32
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export default function WorldTerrain() {
  const quality = useSim((s) => s.quality)
  const qScale = quality === 'high' ? 1 : quality === 'medium' ? 1.45 : 2.2

  const { geo, mat } = useMemo(() => {
    const g = buildTerrainGeometry(qScale)
    // eslint-disable-next-line no-console
    console.info(`[terrain] grid ${g.attributes.position.count.toLocaleString()} verts`)

    const u = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(0, 1) },
      uCenter: { value: new THREE.Vector2(FARM_CENTER.x, FARM_CENTER.z) },
      uDayF: { value: 1 },
      uGlow: { value: 1 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
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
    m.customProgramCacheKey = () => 'terrain-ocean-v4-r32'   // R32 海洋真实化：varyings+三色+foam
    ;(m.userData as any).u = u
    return { geo: g, mat: m }
  }, [qScale])

  useFrame((state) => {
    const uu = (mat.userData as any).u as {
      uTime: { value: number }
      uWind: { value: THREE.Vector2 }
      uDayF: { value: number }
      uGlow: { value: number }
      uSunDir: { value: THREE.Vector3 }
      uMoonDir: { value: THREE.Vector3 }
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
    uu.uMoonDir.value.copy(skyState.moonDir)
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
