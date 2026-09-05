/* oxlint-disable react/immutability -- 纹理工件初始化与 uniforms 帧循环 mutate（docs/08 D2） */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeSkyCanvas } from './skyTexture'
import { skyState } from './lightState'

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// 任务#6 天空层：星野/银河由种子化程序纹理工件（skyTexture.ts，canvas 烘焙，
// 完全可复现，不再依赖位图资产）提供；着色器层负责地平线冰青、极光与昼夜过渡
// （uDay/uSunDir 由 LightRig 的 skyState 驱动：白天星光/极光淡出 + 日轮）。
const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform float uDay;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
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
  float photoMask = smoothstep(0.075, 0.30, h) * (1.0 - uDay * 0.78);
  col = mix(col, photoSky, photoMask * 0.86);

  // 地平线宽亮带（原图发光地平线：亮核 + 宽裙）
  col += vec3(0.16, 0.44, 0.55) * pow(clamp(1.0 - abs(h), 0.0, 1.0), 13.0) * 1.35;
  col += vec3(0.05, 0.16, 0.22) * pow(clamp(1.0 - abs(h), 0.0, 1.0), 5.0) * 0.55;

  // 左上冷光辉（基准图左侧天际亮斑，含月亮意象，克制）。
  // 必须限制在上半球：无人机俯冲时会看到天空球内侧的下半球，
  // 若直接 exp(-h) 会在 h<0 时指数爆炸，产生异常白色光团。
  float upperHemisphere = smoothstep(-0.04, 0.10, h);
  float glowL = exp(-pow((az + 0.42) * 3.4, 2.0)) * exp(-max(h, 0.0) * 14.0) * upperHemisphere;
  col += vec3(0.55, 0.72, 0.85) * glowL * 0.14;

  // 顶部全宽柔光（原图标题后背景亮青雾），同样只作用于上半球。
  col += vec3(0.06, 0.17, 0.24) * pow(clamp(1.0 - abs(h), 0.0, 1.0), 3.0) * exp(-max(h, 0.0) * 2.4) * upperHemisphere * 0.38;

  // 极光带：保留原图方向与冰青色，只作为真实云银河纹理之上的动态叠层
  // 夜间生机增强：极光随夜色呼吸，强度 ×(1-uDay)，并加入慢速正弦呼吸
  float night = 1.0 - uDay;
  float sect = smoothstep(0.22, 0.86, cos(az - 0.72));
  float bandC = 0.08 + 0.036 * (az - 0.62);
  float band = smoothstep(0.075, 0.008, abs(h - bandC));
  float rays = fbm(vec2(az * 17.0, h * 42.0 - uTime * 0.06));
  float drift = fbm(vec2(az * 3.0 + uTime * 0.015, h * 4.0));
  float breathe = 0.85 + 0.35 * sin(uTime * 0.08 + az * 2.3) + 0.15 * sin(uTime * 0.21 + az * 5.7);
  float aur = band * sect * smoothstep(0.26, 0.70, drift) * (0.36 + 1.05 * rays) * breathe;
  // 夜间极光强度提升，白天几乎消失
  aur *= (0.25 + 0.85 * night);
  vec3 aurCol = mix(vec3(0.40, 0.84, 0.95), vec3(0.14, 0.48, 0.84), clamp((h - 0.02) * 10.0, 0.0, 1.0));
  // 夜间再叠一层更冷的青白，呼吸感更强
  vec3 aurColNight = mix(aurCol, vec3(0.55, 0.92, 1.0), 0.35 * night * (0.6 + 0.4 * sin(uTime * 0.12)));
  col += aurColNight * aur * (1.45 + night * 0.9);
  col += aurCol * sect * exp(-abs(h) * 11.0) * (0.16 + night * 0.22) * breathe;

  // 纹理自带真实星场，保留少量动态星点让数字孪生画面仍有呼吸感
  // 夜间生机：星点闪烁更快、更多层次，且随夜色呼吸亮度
  vec2 sp = d.xz / max(0.18, d.y + 0.28);
  vec2 cell = floor(sp * 300.0);
  float star = step(0.9880, hash(cell));
  float tw = 0.55 + 0.45 * sin(uTime * (1.6 + night * 0.8) + hash(cell + 7.7) * 40.0);
  col += vec3(0.70, 0.86, 1.0) * star * tw * smoothstep(0.03, 0.22, h) * (0.20 + night * 0.18) * (1.0 - uDay * 0.3);
  // 第二层更密更暗的微星：夜空星辰数量增加，但单颗更弱，不抢线稿
  vec2 cell2 = floor(sp * 620.0 + 31.7);
  float star2 = step(0.9915, hash(cell2));
  float tw2 = 0.5 + 0.5 * sin(uTime * (1.1 + night * 0.7) + hash(cell2 + 3.3) * 55.0);
  col += vec3(0.66, 0.82, 1.0) * star2 * tw2 * smoothstep(0.02, 0.20, h) * (0.11 + night * 0.12) * (1.0 - uDay * 0.2);
  // 第三层：夜间极稀疏高亮星，偶发闪烁，增加“生机”
  vec2 cell3 = floor(sp * 180.0 + 9.3);
  float star3 = step(0.9965, hash(cell3));
  float tw3 = pow(0.5 + 0.5 * sin(uTime * 2.4 + hash(cell3 + 19.1) * 70.0), 3.0);
  col += vec3(0.85, 0.95, 1.0) * star3 * tw3 * smoothstep(0.04, 0.24, h) * 0.32 * night;

  // 极光带整体随白昼淡出（物理上不严格，但"克制"优先：白天不抢戏）
  col -= col * 0.0; // no-op 保持行号稳定
  // 白天：冰青天幕渐变 + 日轮与晕（不引入新色相）
  vec3 dayCol = mix(vec3(0.086, 0.165, 0.239), vec3(0.290, 0.451, 0.565), smoothstep(0.02, 0.55, h));
  col = mix(col, dayCol, uDay * 0.86);
  float sunDot = clamp(dot(d, normalize(uSunDir)), 0.0, 1.0);
  col += vec3(0.92, 0.97, 1.0) * pow(sunDot, 1400.0) * 1.35 * uDay;
  col += vec3(0.32, 0.46, 0.58) * pow(sunDot, 14.0) * 0.16 * uDay;

  // —— 明月（C3）：月轮 + 晕 + 远辉，随夜色渐显（night 门控，昼夜连续不断裂）——
  vec3 md = normalize(uMoonDir);
  float moonDot = clamp(dot(d, md), 0.0, 1.0);
  float mDisc = smoothstep(0.99980, 0.99995, moonDot); // 月面（~0.6°）
  float limb = 0.75 + 0.25 * smoothstep(0.99980, 1.0, moonDot); // 临边昏暗
  vec3 moonWhite = vec3(0.92, 0.96, 1.0);
  col += moonWhite * mDisc * limb * 2.4 * night; // 明盘
  // 月海：两块暗斑（程序写意，不求精确环形山）
  float maria = smoothstep(0.45, 0.9, fbm(d.xy * 900.0 + md.xy * 130.0));
  col -= moonWhite * mDisc * maria * 0.35 * night;
  col += vec3(0.55, 0.70, 0.85) * pow(moonDot, 900.0) * 0.9 * night; // 内晕
  col += vec3(0.35, 0.52, 0.68) * pow(moonDot, 90.0) * 0.22 * night; // 外晕
  col += vec3(0.20, 0.32, 0.44) * pow(moonDot, 9.0) * 0.10 * night; // 远辉（月出月落的地平气息）

  gl_FragColor = vec4(col, 1.0);
}
`

export default function SkyAurora() {
  const mat = useRef<THREE.ShaderMaterial>(null!)
  const skyTexture = useMemo(() => {
    const tx = new THREE.CanvasTexture(makeSkyCanvas())
    tx.colorSpace = THREE.SRGBColorSpace
    tx.anisotropy = 4
    tx.wrapS = THREE.RepeatWrapping
    return tx
  }, [])
  const uniforms = useMemo(() => ({
    uTime: { value: 0 }, uDay: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uSkyTex: { value: skyTexture },
  }), [skyTexture])

  useFrame((state) => {
    if (!mat.current) return
    const u = mat.current.uniforms
    u.uTime.value = state.clock.elapsedTime
    u.uDay.value = skyState.dayF
    u.uSunDir.value.copy(skyState.sunDir)
    u.uMoonDir.value.copy(skyState.moonDir)
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
