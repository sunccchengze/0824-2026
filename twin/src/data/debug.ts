// ================================================================
// 调试开关（D10 修复：统一入口 + 生产路径收敛）
// ----------------------------------------------------------------
// ?cam= / ?noveil / ?intro=0 / ?q= 只在 DEV 构建或显式 ?debug=1 时生效；
// 普通观众访问生产站点时这些内部开关一律不可见、不起作用。
// ================================================================
export function debugEnabled(): boolean {
  const dev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true
  return dev || hasFlag('debug')
}
export function hasFlag(name: string): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has(name)
}
export function queryVal(name: string): string | null {
  return typeof location === 'undefined' ? null : new URLSearchParams(location.search).get(name)
}
