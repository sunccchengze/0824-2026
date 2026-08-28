import { create } from 'zustand'

// ================================================================
// 模拟 SCADA 状态（浏览器内代理演示）
// 原图口径：全场功率 479,731 MWh / 扬频率 48.20 Hz / 无功平率功率 19 /
//          运行电机数 5 / NPI 70·99·92% / 导颈舵机1..5 = -10°
// 数值仅作大屏演示；真实值口径见 docs/03（FLORIS 3×3 → +24.04%）
// ================================================================

export interface AlarmItem {
  id: number
  kind: 'red' | 'cyan'
  zh: string
  en: string
  minutes: number
}

export interface SimState {
  // 5 路导颈舵机（原图 yaw=+/-10° 档），对应 turbine/SERVOS 索引
  servos: number[]
  setServo: (i: number, v: number) => void

  // 时间轴（24h 巡航）
  tHours: number
  playing: boolean
  togglePlay: () => void

  // 报警流水（分钟前，随时间递增）
  alarms: AlarmItem[]
  setAlarms: (a: AlarmItem[]) => void
  // 矩阵 2×6 状态位
  matrix: boolean[]
  setMatrix: (m: boolean[]) => void
}

const M0: number[] = [-10, -10, -10, -10, -10]
const ALARM_SEED: AlarmItem[] = [
  { id: 0, kind: 'red', zh: '过热预警', en: 'Overheat Alarm', minutes: 23 },
  { id: 1, kind: 'cyan', zh: '过热预警', en: 'Overheat Alarm', minutes: 22 },
  { id: 2, kind: 'red', zh: '过热预警', en: 'Overheat Alarm', minutes: 22 },
  { id: 3, kind: 'red', zh: '过热预警', en: 'Overheat Alarm', minutes: 23 },
  { id: 4, kind: 'cyan', zh: '过热预警', en: 'Overheat Alarm', minutes: 22 },
]

const MATRIX0: boolean[] = [true, true, false, true, true, false, true, false, true, true, false, true]

export const useSim = create<SimState>((set) => ({
  servos: [...M0],
  setServo: (i, v) =>
    set((s) => {
      const servos = [...s.servos]
      servos[i] = v
      return { servos }
    }),

  tHours: 10,
  playing: true,
  togglePlay: () => set((s) => ({ playing: !s.playing })),

  alarms: [...ALARM_SEED],
  setAlarms: (a) => set({ alarms: a }),
  matrix: [...MATRIX0],
  setMatrix: (m) => set({ matrix: m }),
}))

/** 舵机 → 机组索引映射：5 路对应画面中最显著的 5 台（见 terrainUtil.FARM） */
export const SERVO_TID = [0, 1, 4, 6, 8] as const
