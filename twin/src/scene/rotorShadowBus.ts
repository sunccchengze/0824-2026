// 转子叶片尖端世界坐标总线（第 31 轮：叶片投影与真实叶片同步）
// ----------------------------------------------------------------------------
// 背景：GroundShadows 此前用手写简化三角函数推叶片投影，与 HoloTurbine 的真实
// 变换链（coneDeg / spinOffset / -tilt / yaw=π-yawDeg / spinRef 自 0 累积）不一致，
// 且相位不同步 → 投影的叶片与真实叶片对不上、形态错乱（用户判「叶片投影有问题」）。
// 本总线：HoloTurbine 每帧用 three 的 localToWorld（真实矩阵）把 3 个叶尖世界坐标
// 写入这里；GroundShadows 直接读取，用太阳方向把世界坐标投影到贴地平面。
// 叶尖世界坐标只用于「投影」，不参与物理——几何仍以 TURBINE_SPEC 为准。
// ----------------------------------------------------------------------------
import * as THREE from 'three'

export interface RotorTipSet {
  hub: THREE.Vector3
  tips: [THREE.Vector3, THREE.Vector3, THREE.Vector3]
  bladeLen: number
  hubY: number
}

// 单例挂到 window：杜绝 dev/HMR 下「同名模块两份实例」导致 push 与 get 各写各的。
// 生产构建 window 必存在（client-only 渲染循环内使用）。
const GLOBAL_KEY = '__aeolusRotorTips'
function store(): Record<number, RotorTipSet> {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : (globalThis as unknown as Record<string, unknown>)
  if (!w[GLOBAL_KEY]) w[GLOBAL_KEY] = {}
  return w[GLOBAL_KEY] as unknown as Record<number, RotorTipSet>
}

export function pushRotorTips(idx: number, set: RotorTipSet): void {
  store()[idx] = set
}

export function getRotorTips(idx: number): RotorTipSet | undefined {
  return store()[idx]
}

// 调试：暴露到 window，供无头排查叶片投影数据。
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__getRotorTips = getRotorTips
}
