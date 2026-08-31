// FLORIS 3D 速度场数据件类型声明（数据体见 floris3dData.mjs）
import type { RealField } from './florisData'
declare const data: Partial<Record<'+00' | '+15' | '+30' | '-15' | '-30', RealField>>
export default data
