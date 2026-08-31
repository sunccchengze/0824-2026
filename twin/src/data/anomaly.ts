// ============================================================================
// 随机异常事件（演示口径）
// ----------------------------------------------------------------------------
// 需求：每 24 小时（模拟日）触发一次随机异常；等级/强度/发生时间/种类完全随机，
//       每次打开页面、每一天都不同。异常可由用户点击“修复异常情况”手动处理，
//       否则 10s 后自动修复；修复后弹窗给出操作步骤。
// 诚实边界：这是浏览器端确定性演示剧本（随页面加载随机生成），非真实 SCADA 事件。
// ============================================================================

import { FARM } from '../scene/terrainUtil'
import { FARM_RATED_MW, type FarmFrame, type UnitFrame } from './farmSim'

export type AnomalyKind = 'grid' | 'offline' | 'temp' | 'yaw' | 'pitch' | 'comm'
export type AnomalySeverity = 'warn' | 'crit'

export interface AnomalyPlan {
  id: string
  cycle: number
  triggerH: number
  kind: AnomalyKind
  severity: AnomalySeverity
  intensity: number // 0.25..0.95
  turbineIndex: number | null
  titleZh: string
  titleEn: string
  descZh: string
  parts: string[]
  steps: string[]
}

const KINDS: { kind: AnomalyKind; zh: string; en: string; desc: string; parts: string[] }[] = [
  { kind: 'offline', zh: '机组通信中断（掉线）', en: 'SCADA Communication Lost', desc: '机组主控 PLC 与 SCADA 心跳丢失，监控画面显示离线/停机，功率瞬时归零。', parts: ['SCADA 通信', '主控 PLC', '并网断路器'] },
  { kind: 'temp', zh: '发电机绕组温度异常', en: 'Generator Winding Over-Temperature', desc: '发电机绕组温度越过告警阈值，机组已限功率运行并等待风冷散热确认。', parts: ['发电机绕组', '冷却风机', '温度传感器'] },
  { kind: 'yaw', zh: '偏航系统故障', en: 'Yaw Drive Fault', desc: '偏航驱动反馈异常，机舱无法跟踪风向，对风偏差持续增大。', parts: ['偏航驱动', '风向标', '偏航编码器'] },
  { kind: 'pitch', zh: '变桨系统故障', en: 'Pitch System Fault', desc: '变桨柜通讯告警，叶片角度反馈失真，机组进入保护性限功率。', parts: ['变桨柜', '桨叶驱动器', '超级电容'] },
  { kind: 'comm', zh: '光纤环网异常', en: 'Fibre Ring Anomaly', desc: '站内光纤环网 B 环丢包，机组远程监视数据闪断，本地控制仍正常。', parts: ['光纤环网', '交换机', '光模块'] },
  { kind: 'grid', zh: '并网点频率/电压异常', en: 'Grid Frequency/Voltage Anomaly', desc: '并网点电压波动且频率越限，全场按电网指令限功率参与一次调频。', parts: ['并网点', '无功补偿装置', 'AVC 子站'] },
]

function pick<T>(arr: T[], r: () => number): T {
  return arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))]
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 131 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** 生成一次完全随机的异常剧本 */
export function generateAnomalyPlan(cycle: number, _currentH: number): AnomalyPlan {
  const r = Math.random
  const meta = pick(KINDS, r)
  const severity: AnomalySeverity = r() < 0.3 ? 'crit' : 'warn'
  const intensity = 0.25 + r() * 0.7
  // 触发时刻完全随机：从“当前模拟时刻”起未来 24h 内均匀取一点，
  // 既满足每天一次、每次/每日不同，也保证首次加载就能在当日内等到。
  const triggerH = (_currentH + r() * 24) % 24
  const turbineIndex = meta.kind === 'grid' ? null : Math.floor(r() * FARM.length)
  const tid = turbineIndex === null ? null : FARM[turbineIndex].id
  const id = `anom-${cycle}-${hashStr(`${meta.kind}|${triggerH.toFixed(3)}|${intensity.toFixed(3)}|${tid ?? 'grid'}`)}`

  // 修复操作步骤（模拟运行人员处置流程，含复测闭环）
  const steps: string[] = [
    `SCADA 确认“${meta.zh}”告警${tid ? `，定位至 ${tid}` : '，定位至并网点'}。`,
  ]
  for (const part of meta.parts) {
    steps.push(`远程巡检 ${part}：指令下发成功，回传数据核对一致。`)
  }
  if (meta.kind === 'offline' || meta.kind === 'comm') {
    steps.push('切换冗余通信回路，重新建立主控心跳。')
  } else if (meta.kind === 'grid') {
    steps.push('投入无功补偿，AVC 子站电压/频率曲线恢复正常。')
  } else {
    steps.push(`复位保护逻辑并执行 ${meta.kind === 'yaw' ? '偏航' : meta.kind === 'pitch' ? '变桨' : '发电机组'}自检。`)
  }
  steps.push('下发“限功率解除”指令，恢复满发运行。')
  steps.push(`复测闭环：目标功率 ${FARM_RATED_MW.toFixed(0)} MW，机组转速回升，${tid ? tid : '全场'}运行正常。`)

  return {
    id, cycle, triggerH, kind: meta.kind, severity, intensity,
    turbineIndex,
    titleZh: meta.zh, titleEn: meta.en, descZh: meta.desc, parts: meta.parts, steps,
  }
}

/** 将异常应用到已求值的运行帧（仅演示数据层，不改物理内核）。 */
export function applyAnomalyToFrame(frame: FarmFrame, plan: AnomalyPlan | null): FarmFrame {
  if (!plan) return frame
  const units: UnitFrame[] = frame.units.map((u) => ({ ...u }))
  const loss = plan.intensity
  if (plan.kind === 'grid') {
    const f = 1 - loss * 0.42
    for (const u of units) u.powerKw *= f
  } else {
    const i = plan.turbineIndex
    if (i !== null && i >= 0 && i < units.length) {
      const u = units[i]
      if (plan.kind === 'offline' || plan.kind === 'comm') {
        u.status = 'idle'
        u.powerKw = 0
        u.rpm = 0
      } else if (plan.kind === 'temp') {
        u.status = 'alarm'
        u.tempC = 96 + loss * 6
        u.powerKw *= 1 - loss * 0.5
      } else if (plan.kind === 'yaw') {
        u.status = 'alarm'
        u.yawErrDeg = Math.max(u.yawErrDeg, 24 + loss * 8)
        u.powerKw *= 1 - loss * 0.42
      } else if (plan.kind === 'pitch') {
        u.status = 'alarm'
        u.powerKw *= 1 - loss * 0.55
      }
    }
  }
  const totalKw = units.reduce((s, u) => s + u.powerKw, 0)
  const runningCount = units.filter((u) => u.status !== 'idle').length
  const runRpm = units.filter((u) => u.status !== 'idle').reduce((s, u) => s + u.rpm, 0)
  const meanRpm = runningCount > 0 ? runRpm / runningCount : 0
  const totalMW = totalKw / 1000
  return {
    ...frame,
    units,
    totalMW,
    availMW: totalMW,
    runningCount,
    meanRpm,
    qMVar: 0.141 * totalMW,
  }
}

/** 供 UI 显示的事件触发时刻与强度描述 */
export function anomalyLabel(plan: AnomalyPlan): { time: string; level: string; gain: string } {
  const hh = String(Math.floor(plan.triggerH)).padStart(2, '0')
  const mm = String(Math.floor((plan.triggerH % 1) * 60)).padStart(2, '0')
  const level = plan.severity === 'crit' ? '严重' : '警告'
  return {
    time: `${hh}:${mm}`,
    level,
    gain: `${Math.round(plan.intensity * 100)}%`,
  }
}
