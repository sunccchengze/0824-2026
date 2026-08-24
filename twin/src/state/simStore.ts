import { create } from 'zustand'

// 模拟 SCADA 状态（浏览器内代理演示，非 PPO 推理；功率为双线性/抛物代理，显示口径见 docs/03）
// 钦定真值：3×3 基线 8095.15 kW → 逐排贪心 [30, 20, 0]° → 10041.46 kW（+24.04%）
export const P_BASE = 8095.15
export const P_OPT = 10041.46
export const YAW_OPT: [number, number, number] = [30, 20, 0]

interface SimState {
  yawRows: [number, number, number]
  playing: boolean
  setYawRow: (i: number, v: number) => void
  togglePlay: () => void
}
export const useSim = create<SimState>((set) => ({
  yawRows: [...YAW_OPT] as [number, number, number],
  playing: true,
  setYawRow: (i, v) =>
    set((s) => {
      const yawRows = [...s.yawRows] as [number, number, number]
      yawRows[i] = v
      return { yawRows }
    }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
}))

// 抛物代理：偏离钦定点按排系数扣减（演示用，标注【模拟】）
const K: [number, number, number] = [0.31, 0.24, 0.36] // kW / deg²
export function proxyPower(yaw: [number, number, number]): number {
  let p = P_OPT
  for (let i = 0; i < 3; i++) p -= K[i] * (yaw[i] - YAW_OPT[i]) ** 2
  return Math.max(P_BASE * 0.9, p)
}
