import { create } from 'zustand'

/**
 * 浏览器内确定性演示数据，不代表实时 SCADA 或 FLORIS 计算结果。
 * 所有 HUD 数值都从同一时间轴和偏航输入推导，避免面板之间互相矛盾。
 */
export interface AlarmItem {
  id: number
  turbine: string
  severity: 'high' | 'medium' | 'info'
  zh: string
  en: string
  minutes: number
}

export interface Telemetry {
  totalPower: number
  frequency: number
  reactivePower: number
  runningUnits: number
  npi: [number, number, number]
  windSpeed: number
}

export function getTelemetry(tHours: number, servos: number[]): Telemetry {
  const daylight = Math.max(0, Math.sin(((tHours - 5) / 14) * Math.PI))
  const wind = 7.2 + 2.1 * daylight + 0.35 * Math.sin(tHours * 0.7)
  const yawLoss = servos.reduce((sum, value) => sum + Math.min(1, Math.abs(value) / 30) ** 2, 0) / Math.max(1, servos.length)
  const available = 0.76 + daylight * 0.18
  const totalPower = Math.round(9 * 5.0 * available * (1 - yawLoss * 0.12) * 10) / 10
  return {
    totalPower,
    frequency: Math.round((50 + (totalPower - 30) * 0.004) * 100) / 100,
    reactivePower: Math.round((12 + totalPower * 0.22) * 10) / 10,
    runningUnits: daylight > 0.08 ? 9 : 8,
    npi: [Math.round(70 + daylight * 18), Math.round(96 + daylight * 3), Math.round(88 + daylight * 7)],
    windSpeed: Math.round(wind * 10) / 10,
  }
}

export interface SimState {
  servos: number[]
  setServo: (i: number, v: number) => void
  tHours: number
  setTime: (hours: number) => void
  playing: boolean
  togglePlay: () => void
  alarms: AlarmItem[]
  setAlarms: (a: AlarmItem[]) => void
  matrix: boolean[]
  setMatrix: (m: boolean[]) => void
}

const M0 = [-10, -10, -10, -10, -10]
const ALARM_SEED: AlarmItem[] = [
  { id: 0, turbine: 'T01', severity: 'high', zh: '偏航误差', en: 'Yaw deviation', minutes: 3 },
  { id: 1, turbine: 'T04', severity: 'medium', zh: '齿轮箱温升', en: 'Gearbox temperature', minutes: 8 },
  { id: 2, turbine: 'T06', severity: 'info', zh: '通信恢复', en: 'Link recovered', minutes: 12 },
  { id: 3, turbine: 'T08', severity: 'medium', zh: '风速突变', en: 'Wind ramp', minutes: 18 },
  { id: 4, turbine: 'T09', severity: 'info', zh: '维护确认', en: 'Maintenance acknowledged', minutes: 23 },
]
const MATRIX0 = Array.from({ length: 9 }, () => true)

export const useSim = create<SimState>((set) => ({
  servos: [...M0],
  setServo: (i, v) => set((s) => {
    const servos = [...s.servos]
    servos[i] = Math.max(-30, Math.min(30, v))
    return { servos }
  }),
  tHours: 10,
  setTime: (hours) => set({ tHours: ((hours % 24) + 24) % 24 }),
  playing: true,
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  alarms: [...ALARM_SEED],
  setAlarms: (a) => set({ alarms: a }),
  matrix: [...MATRIX0],
  setMatrix: (m) => set({ matrix: m }),
}))

/** 舵机 → 机组索引映射：5 路对应画面中最显著的 5 台。 */
export const SERVO_TID = [0, 1, 4, 6, 8] as const
