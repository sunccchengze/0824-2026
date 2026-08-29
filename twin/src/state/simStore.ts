import { create } from 'zustand'

// ================================================================
// 演示状态总线（单一数据契约）
// HUD、3D 场景、告警、矩阵、曲线全部从这里取数；派生物理量在
// state/simCore.ts（确定性演示代理）里统一求解，禁止组件各自硬编码。
// ================================================================

export interface SimState {
  // 5 路偏航执行器（手动模式值；AUTO 时面板显示 simCore 求解输出）
  servos: number[]
  setServo: (i: number, v: number) => void

  // 偏航自优（目标功率 → 各机偏航角，申请书研究内容③的演示口径）
  auto: boolean
  targetMW: number
  setAuto: (b: boolean) => void
  setTargetMW: (v: number) => void

  // 时间轴（24h 巡航，50 分钟一昼夜）
  tHours: number
  playing: boolean
  togglePlay: () => void

  // 开场运镜状态（可跳过/可回放）
  introActive: boolean
  setIntroActive: (b: boolean) => void
}

const SERVO_INIT: number[] = [-10, -10, -10, -10, -10] // 原图初值口径

export const useSim = create<SimState>((set) => ({
  servos: [...SERVO_INIT],
  setServo: (i, v) =>
    set((s) => {
      const servos = [...s.servos]
      servos[i] = v
      return { servos }
    }),

  auto: true,
  targetMW: 34,
  setAuto: (b) => set({ auto: b }),
  setTargetMW: (v) => set({ targetMW: v }),

  tHours: 10,
  playing: true,
  togglePlay: () => set((s) => ({ playing: !s.playing })),

  introActive: true,
  setIntroActive: (b) => set({ introActive: b }),
}))

// 说明：旧的矩阵/报警假数据与 simStore.SERVO_TID 双映射均已删除（D7）。
// 机组唯一映射：terrainUtil.SERVOS（5 路执行器 → 机组索引）。
