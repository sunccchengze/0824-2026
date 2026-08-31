/* oxlint-disable react/immutability -- 帧循环内 mutate 网格属性/材质透明度为 R3F 既定模式（docs/08 D2） */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, terrainSurfaceY } from './terrainUtil'
import { skyState } from './lightState'
import { getFarmFrame } from './frameBus'
import { debugEnabled, hasFlag } from '../data/debug'

/** A/B QA 开关（仅 debug 生效）：?shoff=1 强制关闭影带，用于帧差定位 */
const SHADOW_OFF = debugEnabled() && hasFlag('shoff')

// ============================================================================
// 风机地面投影（3A 画面 · 第 28 轮 B1，确定性方案 v2）
// ----------------------------------------------------------------------------
// 用户诉求：白天任何角度都能看到风机在地面上的【明显】投影。
// 根因（round28 已确认）：
//   ① 真实 shadow-map 管线在自定义 shader 地面 + 强补光下不可靠（测试柱无影）；
//   ② 普通 alpha 混合的"近黑影片"在本场景失效——地面 albedo 本身很暗，
//      再叠加近黑贴片后对比度趋零（v1 全帧截图不可见的直接原因）。
// 方案（确定性"接地影带"，零 shadow-map 依赖）：
//   · 方向 = 太阳水平方位的反方向（skyState.sunDir，与 LightRig 同口径）；
//   · 长度 = 150 / tan(太阳仰角)，钳 [150, 280]m——正午短、晨昏长，
//     下限 150m 为观感裁决：正午物理影长 ~110m 在低机位被塔身遮住大半，
//     用户要求"任何角度都能看到明显投影"，正午也保留 1.5× 塔高的可读影带；
//   · 形状 = 塔影窄条 + 轮毂高度处的风轮弥散光斑 + 三道叶影细线（随各机 rpm 慢转）；
//   · 深度 = 【乘法混合】(MultiplyBlending)：result = dst·(src.rgb + 1−a)，
//     src 近黑 → 地面被"相对压暗 (1−a)"，与地面明度解耦——近处暗地、
//     远处雾亮地、起伏亮棱面，影带对比一致且纹理/雾色自然保留（无黑补丁感）；
//   · 贴地 = 逐顶点采样 terrainSurfaceY（地形静态，每帧 ~1.2k 次纯数学调用），
//     影带严格贴着起伏走，杜绝 v1"悬浮三角块"；depthTest 关闭仅作保险
//     （抬升量 LIFT 远小于地形起伏，避免掠射角处地形反压盖影带边缘）；
//   · 可见性只由 dayF 驱动（不随仰角衰减）→ 全天清晰，入夜淡出；
//   · 顶点 4 分量颜色（USE_COLOR_ALPHA）做沿程/横向柔边；
//   · 9 机各一份几何（~1.2k 顶点/机），新增 18 个 draw call，无后期成本。
// ============================================================================

const D2R = Math.PI / 180
const SHADOW_COL: [number, number, number] = [0.005, 0.009, 0.016] // 近黑（乘法混合下颜色≈0，仅贡献≈0项）
const HUB_H_M = 90 // 轮毂高（几何真值 turbine/geometry）
const TIP_H_M = 150 // 叶尖投影基准高（90 + 61.6 叶长 ≈ 150m）
const HUB_FRAC = HUB_H_M / TIP_H_M // 轮毂投影点在影带上的相对位置

const ROWS = 24 // 沿程分段（24 段柔化 alpha 台阶，消除 v1"块状感"）
const COLS = 9 // 横向分段（端点 alpha=0 柔边）
const LIFT = 2.2 // 影带抬离地形（视觉贴地量，远机位不可感知）
const FAN_LIFT = 1.2 // 叶影扇贴地量（略低于影带，叠在轮毂光斑核心上）

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
/** 影带 alpha 沿程分布：塔基最浓（低机位最可读段）→ 中段收 → 轮毂处风轮光斑浓 → 叶尖柔化归零 */
function stripAlpha(s: number): number {
  if (s < 0.35) return 1.0 - (1.0 - 0.68) * (s / 0.35)
  if (s < HUB_FRAC) return 0.68 + (1.0 - 0.68) * ((s - 0.35) / (HUB_FRAC - 0.35))
  return (1 - (s - HUB_FRAC) / (1 - HUB_FRAC)) ** 1.15
}
/** 影带半宽（相对长度 L）：塔影条 → 轮毂处张到风轮量级（根部加宽保证低仰角可读） */
function stripHalfW(s: number): number {
  return 0.07 + 0.30 * smoothstep(0.35, 0.62, s)
}

/**
 * 影带几何：局部 X=横向、Z=影向、s∈[0,1] 由塔基到叶尖影。
 * X/Z/Y 全部在帧循环中写入【世界米】（相对机组组原点），mesh 保持单位变换。
 */
function makeStripGeo(): THREE.BufferGeometry {
  const n = ROWS * COLS
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 4)
  for (let r = 0; r < ROWS; r++) {
    const s = r / (ROWS - 1)
    const a = stripAlpha(s)
    for (let c = 0; c < COLS; c++) {
      const t = (c / (COLS - 1)) * 2 - 1
      const i = r * COLS + c
      pos[i * 3] = 0
      pos[i * 3 + 1] = LIFT
      pos[i * 3 + 2] = 0
      const ef = (1 - t * t) ** 2 // 横向柔边（端点 alpha=0）
      col[i * 4] = SHADOW_COL[0]
      col[i * 4 + 1] = SHADOW_COL[1]
      col[i * 4 + 2] = SHADOW_COL[2]
      col[i * 4 + 3] = a * ef
    }
  }
  const idx: number[] = []
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const a0 = r * COLS + c
      const a1 = a0 + 1
      const a2 = a0 + COLS
      const a3 = a2 + 1
      idx.push(a0, a2, a1, a1, a2, a3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 4))
  g.setIndex(idx)
  // 手动大包围球：顶点逐帧更新，避免每帧 computeBoundingSphere 与视锥误裁
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 120), 460)
  return g
}

/** 叶影扇：3 道细线自轮毂投影点（局部原点）扇出 120°，长 0.42（×L 后 ≈ 风轮半径） */
function makeFanGeo(): THREE.BufferGeometry {
  const RAYS = 3
  const SEG = 4
  const LEN = 0.42
  const n = RAYS * (SEG + 1) * 3
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 4)
  for (let k = 0; k < RAYS; k++) {
    const phi = (k * Math.PI * 2) / RAYS + Math.PI / 2
    const dx = Math.sin(phi)
    const dz = Math.cos(phi)
    const px = -dz // 垂直（展向）
    const pz = dx
    for (let s = 0; s <= SEG; s++) {
      const q = s / SEG
      const len = q * LEN
      const hw = 0.03 * (1 - 0.35 * q)
      const a = 0.62 * (1 - q) ** 1.5
      for (let c = -1; c <= 1; c++) {
        const t = c // -1, 0, 1
        const ef = c === 0 ? 1 : 0.35
        const i = (k * (SEG + 1) + s) * 3 + (c + 1)
        pos[i * 3] = dx * len + px * t * hw
        pos[i * 3 + 1] = FAN_LIFT
        pos[i * 3 + 2] = dz * len + pz * t * hw
        col[i * 4] = SHADOW_COL[0]
        col[i * 4 + 1] = SHADOW_COL[1]
        col[i * 4 + 2] = SHADOW_COL[2]
        col[i * 4 + 3] = a * ef
      }
    }
  }
  const idx: number[] = []
  for (let k = 0; k < RAYS; k++) {
    const base = k * (SEG + 1) * 3
    for (let s = 0; s < SEG; s++) {
      const a0 = base + s * 3
      const a1 = a0 + 1
      const a2 = a0 + 2
      const b0 = a0 + 3
      const b1 = a1 + 3
      const b2 = a2 + 3
      idx.push(a0, b0, a1, a1, b0, b1, a1, b1, a2, a2, b1, b2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 4))
  g.setIndex(idx)
  // 叶影扇 Y 为地形跟随值（相对轮毂点 ±30m 量级），XZ 单位空间（×L 缩放）
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 40)
  return g
}

/**
 * 乘法混合材质：近黑 src + 顶点 alpha → 地面相对压暗 (1−a)；关雾保证影带强度与距离无关。
 * ⚠ r185 的 MultiplyBlending 要求 premultipliedAlpha:true（否则 WebGLState 静默回退
 * 到上一次混合状态=普通黑片叠加——round28 曾因此白调一轮，见 docs/research/round28）。
 * 开启后 shader 先 gl_FragColor.rgb *= a，混合式 result = dst·(src.rgb + 1−a) ≈ dst·(1−a)。
 */
function makeShadowMaterial(opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
    blending: THREE.MultiplyBlending,
    premultipliedAlpha: true,
  })
}

export default function GroundShadows() {
  const root = useRef<THREE.Group>(null!)
  const fanRefs = useRef<(THREE.Group | null)[]>([])
  const fanAngle = useRef<number[]>(FARM.map(() => 0))
  const tmp = useMemo(() => ({ rotY: 0, L: 150, alpha: 0, sinY: 0, cosY: 1 }), [])

  const assets = useMemo(() => {
    const stripGeos = FARM.map(() => makeStripGeo())
    const fanGeos = FARM.map(() => makeFanGeo())
    const stripMat = makeShadowMaterial(0)
    const fanMat = makeShadowMaterial(0)
    return { stripGeos, fanGeos, stripMat, fanMat }
  }, [])

  useEffect(() => {
    const a = assets
    return () => {
      a.stripGeos.forEach((g) => g.dispose())
      a.fanGeos.forEach((g) => g.dispose())
      a.stripMat.dispose()
      a.fanMat.dispose()
    }
  }, [assets])

  // QA 探针（仅 DEV/?debug=1）：影子几何/透明度状态，供无头验证
  useEffect(() => {
    if (!debugEnabled()) return
    ;(window as unknown as Record<string, unknown>).__aeolus_shadows = () => {
      return {
        dayF: +skyState.dayF.toFixed(3),
        sun: skyState.sunDir.toArray().map((v) => +v.toFixed(3)),
        rootVisible: root.current?.visible ?? null,
        L: +tmp.L.toFixed(1),
        rotY: +(tmp.rotY * 57.2958).toFixed(1),
        alpha: +tmp.alpha.toFixed(3),
        stripOpacity: +assets.stripMat.opacity.toFixed(3),
        fanOpacity: +assets.fanMat.opacity.toFixed(3),
        blending: 'multiply+terrainFollow',
      }
    }
  }, [assets, tmp])

  useFrame((_, dtRaw) => {
    if (!root.current) return
    if (SHADOW_OFF) {
      root.current.visible = false
      return
    }
    const dayF = skyState.dayF
    if (dayF < 0.012) {
      root.current.visible = false
      return
    }
    root.current.visible = true
    // —— 影向 = 太阳水平方位反方向（水平归一，正午指向正北 -z）——
    const sun = skyState.sunDir
    let dx = -sun.x
    let dz = -sun.z
    const hl = Math.hypot(dx, dz)
    if (hl < 1e-4) return // 太阳贴天顶（本场景仰角上限 54°，实际不会发生）
    dx /= hl
    dz /= hl
    const rotY = Math.atan2(dx, dz)
    const sinY = Math.sin(rotY)
    const cosY = Math.cos(rotY)
    // —— 影长 ∝ 1/tan(仰角)，钳 [150, 280]m（下限为观感裁决，见文件头）——
    const elDeg = Math.asin(THREE.MathUtils.clamp(sun.y, -1, 1)) / D2R
    const L = THREE.MathUtils.clamp(TIP_H_M / Math.max(Math.tan(elDeg * D2R), 0.05), 150, 280)
    // —— 全天清晰：透明度只跟 dayF；日出/日落贴地平线时快速淡入避免"贴地平线全宽黑影" ——
    const dawnFade = THREE.MathUtils.smoothstep(elDeg, 0.5, 4)
    const alpha = dayF * dawnFade
    // 乘法混合下 opacity 即"最大压暗比例"：0.58 = 塔基最浓处压到 42% 亮度
    // 乘法混合下 opacity 即"最大压暗比例"：0.72 = 塔基/轮毂最浓处压到 28% 亮度（3A 观感：明显但不死黑）
    assets.stripMat.opacity = 0.72 * alpha
    assets.fanMat.opacity = 0.55 * alpha
    tmp.rotY = rotY
    tmp.L = L
    tmp.alpha = alpha
    tmp.sinY = sinY
    tmp.cosY = cosY

    const fr = getFarmFrame()
    for (let i = 0; i < FARM.length; i++) {
      const u = FARM[i]
      const baseY = terrainSurfaceY(u.x, u.z)
      // —— 影带：逐顶点 XZ 旋转到影向、Y 贴 terrainSurfaceY ——
      const posAttr = assets.stripGeos[i].getAttribute('position') as THREE.BufferAttribute
      const arr = posAttr.array as Float32Array
      for (let r = 0; r < ROWS; r++) {
        const s = r / (ROWS - 1)
        const hw = stripHalfW(s) * L
        const lz = s * L
        for (let c = 0; c < COLS; c++) {
          const t = (c / (COLS - 1)) * 2 - 1
          const lx = t * hw
          // 局部 (lx,lz) 绕 Y 旋转 rotY → 世界偏移：局部 +Z → 影向 (sinY, cosY)，局部 +X → (cosY, −sinY)
          const wx = u.x + lx * cosY + lz * sinY
          const wz = u.z - lx * sinY + lz * cosY
          const p = (r * COLS + c) * 3
          arr[p] = wx - u.x
          arr[p + 1] = terrainSurfaceY(wx, wz) + LIFT - baseY
          arr[p + 2] = wz - u.z
        }
      }
      posAttr.needsUpdate = true
      // —— 叶影扇：轮毂投影点贴地 + 随 rpm 慢转（Y 同样逐顶点贴地，旋转绕 Y 不改 Y）——
      const fan = fanRefs.current[i]
      if (fan) {
        const hubX = u.x + sinY * HUB_FRAC * L
        const hubZ = u.z + cosY * HUB_FRAC * L
        const hubY = terrainSurfaceY(hubX, hubZ)
        fan.position.set(sinY * HUB_FRAC * L, hubY + FAN_LIFT - baseY - LIFT, cosY * HUB_FRAC * L)
        fan.scale.set(L, 1, L)
        const rpm = fr?.units[i]?.rpm ?? 0
        fanAngle.current[i] -= Math.min(0.05, dtRaw) * ((rpm * Math.PI) / 30)
        const th = rotY + fanAngle.current[i]
        const sinT = Math.sin(th)
        const cosT = Math.cos(th)
        fan.rotation.y = th
        const fPos = assets.fanGeos[i].getAttribute('position') as THREE.BufferAttribute
        const fArr = fPos.array as Float32Array
        for (let k = 0; k < 3; k++) {
          const phi = (k * Math.PI * 2) / 3 + Math.PI / 2
          const dxR = Math.sin(phi)
          const dzR = Math.cos(phi)
          const pxR = -dzR
          const pZR = dxR
          for (let s = 0; s <= 4; s++) {
            const q = s / 4
            const len = q * 0.42
            const hwF = 0.03 * (1 - 0.35 * q)
            for (let c = -1; c <= 1; c++) {
              // 单位空间 XZ（组缩放 ×L）；世界位置按 three.js rotation.y=th 约定求地形
              const fxU = dxR * len + pxR * c * hwF
              const fzU = dzR * len + pZR * c * hwF
              const wx2 = hubX + (fxU * L) * cosT + (fzU * L) * sinT
              const wz2 = hubZ - (fxU * L) * sinT + (fzU * L) * cosT
              const p = ((k * 5 + s) * 3 + (c + 1)) * 3
              fArr[p] = fxU
              fArr[p + 1] = terrainSurfaceY(wx2, wz2) - hubY
              fArr[p + 2] = fzU
            }
          }
        }
        fPos.needsUpdate = true
      }
    }
  })

  return (
    <group ref={root}>
      {FARM.map((u, i) => (
        <group key={u.id} position={[u.x, terrainSurfaceY(u.x, u.z) + LIFT, u.z]}>
          <mesh geometry={assets.stripGeos[i]} material={assets.stripMat} renderOrder={1} frustumCulled={false} />
          <group
            ref={(el) => {
              fanRefs.current[i] = el
            }}
          >
            <mesh geometry={assets.fanGeos[i]} material={assets.fanMat} renderOrder={1} frustumCulled={false} />
          </group>
        </group>
      ))}
    </group>
  )
}
