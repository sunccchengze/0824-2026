// 每帧契约帧总线：TurbineField 推一帧，9 台 HoloTurbine 读同一对象。
// （独立小模块：满足 Fast Refresh "文件只导出组件"约束，见 docs/08 D2）
import type { FarmFrame } from '../data/farmSim'
let _frame: FarmFrame | null = null
export function pushFarmFrame(f: FarmFrame) { _frame = f }
export function getFarmFrame(): FarmFrame | null { return _frame }
