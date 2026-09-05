/* oxlint-disable react/immutability -- 帧循环内 mutate mat.userData/uniform 为 R3F 标准模式（docs/08 D2） */
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainSurfaceY, landMask, coastT, FARM_CENTER } from './terrainUtil'
import { skyState } from './lightState'
import { windAt } from '../data/farmSim'
import { useSim } from '../state/simStore'

// ============================================================
// 海洋地面（第 32 轮 A 重构 v4：六类生物群系 + 岩雪山体 + 海面克制化）
// ------------------------------------------------------------
// 诉求校正：
//   · 海陆交界要精细、陆地明显高于海 → 海盆半径扩大，海岸带陡升（terrainUtil）；
//   · 风机全在海中央、距海岸遥远   → 由 terrainUtil 地形函数保证；
//   · 海水不真实、格子重复感严重   → 顶点位移只留「大尺度涌浪」，所有细碎
//     波光由片元解析法线(waveHeight 梯度 + 分形噪声) + 片元浪尖层次生成，
//     不依赖网格分辨率 → 无格子；
//   · 太湛蓝刺眼 → 回到系统一贯「暗调冰青 + 低饱和莫兰迪灰调」，克制不惹眼。
//
// 保持：贴地基准 = terrainSurfaceY（风机/升压站/电缆/星光零回归），
//       波浪位移仅为顶点着色器运行时副作用。
// ============================================================

const VERT = /* glsl */ `
varying float vWater;
varying vec3 vWPos;
varying vec3 vWN;
varying float vLand;
varying float vH;
varying float vCoast;
attribute float aLand;
attribute float aCoast;
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

  // 基底高度（海底）：position.y 来自 terrainSurfaceY（世界真值）
  float baseY = position.y;
  // 水陆 mask：aLand≈0 → 开放海(1)；aLand>0 → 陆地(0)。
  // 用 land 权重作主判据，避免「海岸低海拔沙带被误判为水」。
  float water = 1.0 - smoothstep(0.0, 0.02, aLand);
  vWater = water;
  vLand = aLand;
  vH = baseY;
  vCoast = aCoast;

  // 近场收敛：离场心越近波浪越收敛（塔基贴地、风场稳定）
  float d = length(wp.xz - uCenter);
  float amp = mix(0.5, 1.0, smoothstep(180.0, 2000.0, d));

  // 顶点位移只保留「大尺度平缓涌浪」（波长远大于网格 ~30m），
  // 短波细碎波光全部交给片元解析法线 → 粗网格无块状格子感。
  vec2 wdir = normalize(uWind + vec2(0.0001, 0.0));
  vec2 d2 = normalize(vec2(-uWind.y, uWind.x));
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 disp = vec3(0.0);
  vec2 p = wp.xz;
  disp += gerstner(p, wdir, 0.06, 2400.0, uTime * 0.35,          tangent, binormal);
  disp += gerstner(p, d2,   0.045, 1500.0, uTime * 0.50 + 2.1,   tangent, binormal);
  disp *= amp;

  // 波浪只在海上位移；陆地保持原始剪影
  float lift = water;
  vec3 newPos = vec3(wp.x, baseY + disp.y * lift, wp.z);
  newPos.xz += disp.xz * lift * 0.75;

  // 法线：海水用大尺度 Gerstner 法线；陆地用真实几何法线（computeVertexNormals），
  // 山体明暗/雪沟/裸岩全靠它 —— 此前陆地近似上向是“盐堆”感的根因（round4 修复）
  vec3 gNorm = normalize(cross(binormal, tangent));
  vec3 n = normalize(mix(normal, gNorm, water));
  vWN = n;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;
varying float vWater;
varying vec3 vWPos;
varying vec3 vWN;
varying float vLand;
varying float vH;
varying float vCoast;
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
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.02; a *= 0.5; }
  return v;
}

// —— 解析波高：多方向正弦 + 高分形微细节 → 细碎连绵涟漪（贴近原图质感）——
float waveHeight(vec2 p) {
  float t = uTime;
  float h = 0.0;
  // 大尺度涌（低振幅，平缓）
  h += sin(dot(p, vec2( 0.0120,  0.0080)) *  1.0 + t * 0.70) * 0.40;
  h += sin(dot(p, vec2(-0.0077,  0.0062)) *  1.0 + t * 0.90 + 1.7) * 0.32;
  // 中尺度波（主波纹）——加大振幅形成明显浪头
  h += sin(dot(p, vec2( 0.0220,  0.0160)) *  1.0 + t * 1.10 + 3.3) * 0.46;
  h += sin(dot(p, vec2( 0.0180, -0.0140)) *  1.0 + t * 1.35 + 5.1) * 0.38;
  h += sin(dot(p, vec2(-0.0160,  0.0180)) *  1.0 + t * 1.60 + 7.4) * 0.30;
  // 细碎噪声涟漪：分形 → 连绵、无重复
  h += (fbm(p * 0.06 + uTime * 0.03) - 0.5) * 0.7;
  return h;
}
// 解析法线：波高梯度（有限差分）+ 弱分形噪声微细节 → 平滑、细致、无格子
vec3 waterNormal(vec2 p) {
  float e = 1.0; // 差分步长（米）
  float hL = waveHeight(p - vec2(e, 0.0));
  float hR = waveHeight(p + vec2(e, 0.0));
  float hD = waveHeight(p - vec2(0.0, e));
  float hU = waveHeight(p + vec2(0.0, e));
  vec3 n = normalize(vec3(hL - hR, 2.0 * e, hD - hU));
  // 弱分形微细节：细碎波光、无格子（振幅压低，避免散射成灰雾）
  float nA = fbm(p * 0.05 + uTime * 0.05);
  float nB = fbm(p * 0.11 - uTime * 0.09);
  n += vec3((nA - 0.5) * 0.20, 0.0, (nB - 0.5) * 0.20);
  return normalize(n);
}

void main() {
  float night = 1.0 - uDayF;
  vec3 V = normalize(cameraPosition - vWPos);

  // 法线：海上用「解析程序法线」（平滑、细致、无格子）；陆上退回顶点法线
  vec3 N = mix(normalize(vWN), waterNormal(vWPos.xz), vWater);
  N = normalize(N);
  vec3 Ns = N;
  float ndv = max(dot(N, V), 0.0);

  // 浪尖层次：片元内用解析波高现算（摆脱顶点网格 → 消除条带/格子感）
  float wh = waveHeight(vWPos.xz);
  float crest = smoothstep(0.25, 0.85, wh); // 归一化波高 → 0..1 浪尖

  // —— Fresnel 菲涅尔：贴水面反射天空；用「面朝上」gate 掉陡岸坡发白 ——
  float upness = smoothstep(0.36, 0.72, N.y);
  float fres = pow(1.0 - ndv, 3.4) * upness;

  // —— 配色：系统一贯「暗调冰青 + 低饱和莫兰迪灰调」，克制不惹眼 ——
  // 参照用户原图：海底深青黑，浪尖点缀青白，整体暗、不刺眼。
  vec3 deepCol  = mix(vec3(0.008, 0.022, 0.038), vec3(0.050, 0.115, 0.185), uDayF); // 浪谷（深青黑）
  vec3 shallowCol = mix(vec3(0.024, 0.055, 0.082), vec3(0.150, 0.310, 0.420), uDayF); // 浪尖（低饱和青蓝）
  vec3 waterCol = mix(deepCol, shallowCol, crest * 0.55);

  // 天空反射：低饱和灰青蓝（白天）→ 近黑（夜），权重压低避免整片洗灰
  vec3 skyRef = mix(vec3(0.014, 0.032, 0.054), vec3(0.150, 0.290, 0.385), uDayF);
  waterCol = mix(waterCol, skyRef, clamp(fres, 0.0, 1.0) * (0.045 + 0.07 * uDayF));

  // —— 太阳/月亮镜面高光：细碎点状波光（点状，克制，不高亮成云斑）——
  vec3 halfV = normalize(V + uSunDir);
  float spec = pow(max(dot(Ns, halfV), 0.0), 620.0 + night * 320.0);
  float sparkle = fbm(vWPos.xz * 0.12 + uTime * 0.8) * fbm(vWPos.xz * 0.35 - uTime * 0.5);
  spec *= (0.10 + 0.90 * sparkle);
  vec3 sunCol = mix(vec3(0.11, 0.26, 0.38), vec3(0.80, 0.80, 0.78), uDayF);
  waterCol += sunCol * spec * (uDayF * 0.72 + night * 0.13);

  // —— 波峰泡沫：只在 crest，且提频打散成细碎稀疏浪花（克制；避免大块云斑）——
  float foamNoise = fbm(vWPos.xz * 0.16 + uTime * 0.06 + crest * 3.0);
  float foamMask = smoothstep(0.72, 0.98, crest) * (0.10 + 0.60 * smoothstep(0.58, 0.86, foamNoise));
  vec3 foam = mix(vec3(0.028, 0.06, 0.09), vec3(0.50, 0.63, 0.68), uDayF); // 更低饱淡青白
  waterCol = mix(waterCol, foam, foamMask * (0.05 + uDayF * 0.12));

  // —— 夜间暗潮微光：极弱青蓝涌动 ——
  float moonSpec = pow(max(dot(Ns, halfV), 0.0), 220.0);
  waterCol += vec3(0.05, 0.13, 0.20) * moonSpec * night * uGlow * 0.30;
  waterCol += vec3(0.02, 0.06, 0.11) * crest * night * uGlow * 0.40;

  // —— 陆地 v4（六类生物群系 + 岩雪山体，第 32 轮 A）——
  // 与 CPU 端 biomeWeights() 同式；L = vLand（0 海 → 1 内陆）。
  float L = vLand;
  // 岸线破碎（round5）：渲染级高频扰动，沙/潮带按扰动后的 Lp 落位，水线参差 ——
  // CPU 端 biomeWeights 仍用平滑 L（草地散布不需要 40m 级参差），此处分歧是渲染级细节。
  float shoreN = fbm(vWPos.xz * 0.025 + 11.3);
  float Lp = L + (shoreN - 0.5) * 0.16;
  float wSand   = 1.0 - smoothstep(0.06, 0.16, Lp);
  float wTidal  = smoothstep(0.05, 0.12, Lp) * (1.0 - smoothstep(0.16, 0.28, Lp));
  float wGrass  = smoothstep(0.14, 0.30, L) * (1.0 - smoothstep(0.45, 0.62, L));
  float wForest = smoothstep(0.38, 0.55, L) * (1.0 - smoothstep(0.68, 0.82, L));
  float wHill   = smoothstep(0.60, 0.75, L) * (1.0 - smoothstep(0.85, 0.95, L));
  float wMtn    = smoothstep(0.82, 0.93, L);
  float wSandE = pow(wSand, 1.25); float wTidalE = pow(wTidal, 1.25); float wGrassE = pow(wGrass, 1.25);
  float wForestE = pow(wForest, 1.25); float wHillE = pow(wHill, 1.25); float wMtnE = pow(wMtn, 1.25);
  float wSum = wSandE + wTidalE + wGrassE + wForestE + wHillE + wMtnE + 1e-5;
  wSand = wSandE / wSum; wTidal = wTidalE / wSum; wGrass = wGrassE / wSum;
  wForest = wForestE / wSum; wHill = wHillE / wSum; wMtn = wMtnE / wSum;

  // 日间群系色（A-round2：拉开色相/明度距离，分层可辨；仍压住饱和，克制不刺眼）
  vec3 cSand   = vec3(0.450, 0.360, 0.240); // 干沙（暖亮）
  vec3 cTidal  = vec3(0.160, 0.130, 0.090); // 潮间湿沙（深，湿润感）
  vec3 cGrass  = vec3(0.135, 0.235, 0.095); // 草原（压暗，远观不晃眼）
  vec3 cForest = vec3(0.070, 0.160, 0.100); // 林地（深绿）
  vec3 cHill   = vec3(0.230, 0.200, 0.130); // 缓丘（棕橄榄，与林地区分）
  vec3 cRock   = vec3(0.110, 0.120, 0.140); // 山岩（深灰）

  // 细节噪声：草原/林地高频斑驳、沙粒微粒、山岩分形
  float g1 = vnoise(vWPos.xz * 0.020);
  float g2 = vnoise(vWPos.xz * 0.055 + 7.3);
  float grassN = g1 * 0.65 + g2 * 0.35;
  float sandN = vnoise(vWPos.xz * 0.11 + 3.1);
  float rockN = fbm(vWPos.xz * 0.008 + 1.7);
  float ribs = fbm(vec2(vWPos.x * 0.020 + vWPos.z * 0.013, vWPos.z * 0.031 - vWPos.x * 0.007)); // 沟脊（雪沟/岩脊/AO共用）
  float crownN = g1 * 0.5 + fbm(vWPos.xz * 0.030) * 0.5;

  vec3 landDay = cSand * (0.92 + 0.16 * sandN) * wSand
               + cTidal * wTidal
               + cGrass * (0.78 + 0.44 * grassN) * wGrass
               + cForest * (0.78 + 0.44 * crownN) * wForest
               + cHill * (0.85 + 0.30 * rockN) * wHill
               + cRock * (0.80 + 0.40 * rockN) * wMtn;
  // 陆地起伏漫反射（只作用陆地；雪有自己的日光模型，不在此重复压暗）
  float landDiff = 0.70 + 0.30 * clamp(dot(N, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
  landDay *= mix(1.0, landDiff, 1.0 - vWater);
  // 湿沙带：紧贴水线压暗（退潮湿润感），只作用沙/潮带 —— 岸线“镶边”，破画笔渐变
  float wetBand = (1.0 - smoothstep(0.015, 0.10, Lp)) * clamp(wSand + wTidal, 0.0, 1.0);
  landDay *= 1.0 - wetBand * 0.45;

  // —— 细节法线（round4）：高频起伏扰动，只用于雪/岩光照，制造嶙峋光影 ——
  float eD = 6.0;
  float dHx = fbm(vWPos.xz * 0.045 + 3.7) - fbm(vWPos.xz * 0.045 - vec2(eD * 0.045, 0.0) + 3.7);
  float dHz = fbm(vWPos.xz * 0.045 + 3.7) - fbm(vWPos.xz * 0.045 - vec2(0.0, eD * 0.045) + 3.7);
  vec3 Ndet = normalize(N + vec3(-dHx * 2.2, 0.0, -dHz * 2.2));
  // 微起伏（round8）：米级地表凹凸进法线，近看有“颗粒”，远处衰减防闪烁
  float camDist = length(cameraPosition - vWPos);
  float microFade = exp(-camDist / 380.0);
  if (microFade > 0.01) {
    float m1 = fbm(vWPos.xz * 0.55 + 7.1);
    float m2 = fbm(vWPos.xz * 0.55 + vec2(2.5, 0.0) + 7.1);
    float m3 = fbm(vWPos.xz * 0.55 + vec2(0.0, 2.5) + 7.1);
    Ndet = normalize(Ndet + vec3((m1 - m2) * 1.6, 0.0, (m1 - m3) * 1.6) * microFade);
  }
  float fade2 = exp(-camDist / 500.0); // 反照率微细节衰减（比法线稍远）

  // 山脊裸岩：坡陡处露出山岩（细节法线让岩壁有明暗皴擦，谷地留绿）
  float steep = 1.0 - Ndet.y;
  float rockExp = smoothstep(0.42, 0.72, steep) * clamp(wHill + wMtn, 0.0, 1.0);
  landDay = mix(landDay, cRock * (0.85 + 0.30 * rockN), clamp(rockExp, 0.0, 1.0) * 0.85);

  // —— 雪冠 v2（round4）：岩脊雪沟 + 日光质感，告别“盐堆” ——
  // 沟留雪、脊露岩：高频脊线 + 雪线扰动打破“一刀切”（雪线 380/460，与 CPU SNOW_LINE 同值）
  float snow = smoothstep(380.0, 460.0, vH + (ribs - 0.5) * 90.0);
  float slopeGate = smoothstep(0.35, 0.70, Ndet.y); // 陡壁挂不住雪（窄脊主峰正需要）
  float ribGate = 0.50 + 0.50 * smoothstep(0.30, 0.70, ribs); // 沟雪脊岩
  snow *= (0.25 + 0.75 * slopeGate) * ribGate;
  snow *= 0.35 + 0.65 * wMtn;
  float snowM = clamp(snow, 0.0, 1.0);
  // 雪的日光：向阳暖白 / 背阴冷蓝（整块平板白的根因在此）
  float sunDiff = clamp(dot(Ndet, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
  vec3 snowCol = mix(vec3(0.42, 0.50, 0.66), vec3(1.02, 1.00, 0.97), sunDiff);
  // 风蚀纹（sastrugi）：拉伸条纹明暗，近看有“风雕”质感
  float sast = fbm(vec2((vWPos.x + vWPos.z) * 0.06, (vWPos.x - vWPos.z) * 0.012));
  snowCol *= 0.88 + 0.24 * sast;
  // 雪晶闪光：只在向阳面星星点点（白天反光强度的来源，克制）
  vec3 Vv = normalize(cameraPosition - vWPos);
  vec3 Hv = normalize(Vv + uSunDir);
  float glint = pow(max(dot(Ndet, Hv), 0.0), 60.0);
  float glintN = fbm(vWPos.xz * 0.12 + uTime * 0.05);
  snowCol += vec3(1.0, 0.98, 0.94) * glint * smoothstep(0.50, 0.9, glintN) * uDayF * 4.0 * sunDiff;
  landDay = mix(landDay, snowCol, snowM);
  // 岩石质感（round5）：层理 + 碎石颗粒 + 凹缝 AO，杀“塑料黏土”；
  // round10 起只给高山 + 陡壁（丘陵带保持干净植被，不再整片压灰）
  float strata = sin(vH * 0.33 + rockN * 5.0 + Ndet.x * 2.0);
  float rockGrain = vnoise(vWPos.xz * 0.06) * 0.6 + vnoise(vWPos.xz * 0.17 + 4.2) * 0.4;
  float crevAO = 0.70 + 0.30 * smoothstep(0.25, 0.75, ribs * 0.5 + rockGrain * 0.5);
  float rockZone = clamp(wMtn + rockExp, 0.0, 1.0);
  float rockTex = (0.88 + 0.12 * strata) * (0.78 + 0.44 * rockGrain) * crevAO;
  landDay *= mix(1.0, rockTex, (1.0 - snowM) * clamp(rockZone, 0.0, 1.0));
  // 微反照率（round8）：厘米~米级地表质感，放大看的本钱；植被（草/树）不管，只做地
  if (fade2 > 0.02) {
    // 沙：风成波纹（定向）+ 散布卵石
    float ripple = sin(dot(vWPos.xz, vec2(0.9, 0.45)) * 2.2 + fbm(vWPos.xz * 0.15) * 9.0);
    float pebble = step(0.965, hash21(floor(vWPos.xz * 2.6) + 1.0));
    float sandZone = clamp(wSand + wTidal, 0.0, 1.0);
    landDay *= 1.0 + (ripple * 0.10 + (fbm(vWPos.xz * 2.3) - 0.5) * 0.25) * sandZone * fade2;
    landDay *= 1.0 - pebble * 0.35 * sandZone * fade2;
    // 草地：丛块浓淡（不是草叶，是地被斑驳；种草另起）
    float tuft = fbm(vWPos.xz * 0.9 + 2.2);
    landDay *= 1.0 + (tuft - 0.5) * 0.35 * clamp(wGrass + wForest * 0.5, 0.0, 1.0) * fade2;
    // 岩：裂隙网（深色脉）+ 碎石灰点
    float crack = 1.0 - abs(2.0 * fbm(vWPos.xz * 0.33 + 5.5) - 1.0);
    crack = pow(crack, 3.0);
    float scree = step(0.975, hash21(floor(vWPos.xz * 3.1) + 7.0));
    float bareRock = clamp(rockZone, 0.0, 1.0) * (1.0 - snowM);
    landDay *= 1.0 - crack * 0.40 * bareRock * fade2;
    landDay *= 1.0 + scree * 0.30 * bareRock * fade2;
    // 水线：泡沫碎点（陆侧水线镶边，水体泡沫归 Step B）
    float foamDot = step(0.93, hash21(floor(vWPos.xz * 1.4) + 3.0)) * (1.0 - smoothstep(0.005, 0.05, Lp));
    landDay = mix(landDay, vec3(0.75, 0.82, 0.84), foamDot * 0.7 * fade2);
  }

  float lm = vnoise(vWPos.xz * 0.0021);
  lm += 0.5 * vnoise(vWPos.xz * 0.0055);

  // 昼夜：夜间统一压暗（保留冷调），白天补微弱冷光
  vec3 landCol = landDay * mix(vec3(0.19, 0.20, 0.23), vec3(1.0), uDayF);
  landCol += (lm - 0.5) * 0.04;                        // 微弱整体斑驳
  landCol += vec3(0.012, 0.040, 0.060) * uDayF * 0.45; // 白天冷调补光

  vec3 col = mix(landCol, waterCol, vWater);

  // —— 空气透视（指数雾）：海水轻吃雾保色，远山吃雾显空气感 ——
  float dist = length(cameraPosition - vWPos);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  float fogMix = mix(fogF, fogF * 0.30, vWater); // 海水更轻吃雾，保住水色
  col = mix(col, uFogColor, clamp(fogMix, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`

export default function WorldTerrain() {
  const { geo, mat } = useMemo(() => {
    const SIZE = 9200
    const SEG = 400 // round8：23m 单元（160k 顶点，启动多 ~2s，换近岸轮廓）
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position as THREE.BufferAttribute
    const land = new Float32Array(pos.count)
    const coast = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const y = terrainSurfaceY(x, z)
      pos.setY(i, y)
      land[i] = landMask(x, z)
      coast[i] = coastT(x, z)
    }
    g.setAttribute('aLand', new THREE.BufferAttribute(land, 1))
    g.setAttribute('aCoast', new THREE.BufferAttribute(coast, 1))
    g.computeVertexNormals()

    const u = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(0, 1) },
      uCenter: { value: new THREE.Vector2(FARM_CENTER.x, FARM_CENTER.z) },
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
    m.customProgramCacheKey = () => 'terrain-ocean-v4'
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
