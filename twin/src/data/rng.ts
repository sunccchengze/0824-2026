// ================================================================
// 确定性随机源（全工程唯一）
// ----------------------------------------------------------------
// 为什么存在：评审 D2/D3 指出旧版在 render/useMemo 里直接使用
// Math.random()，导致：① 每次 StrictMode 双调用/重建后画面不同，
// 无法做 A/B 帧差回归；② 截图 QA 不可复现。
// 这里提供 mulberry32 + 字符串哈希，任何"随机"都必须显式带 seed
// 走本模块（演示口径 = seed 42，与 docs/05 承诺一致）。
// ================================================================

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32：32 位状态的可复现 PRNG */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 项目钦定演示种子（docs/05：种子 42 可复现） */
export const DEMO_SEED = 42

/** 稳定噪声：给定 (a,b) 返回 [0,1)，纯函数、无状态、跨帧一致 */
export function noise1(a: number, b = 0): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** 平滑噪声：对 noise1 做三次插值，用于时变/展向连续扰动 */
export function smoothNoise(x: number, seed = 0): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  const a = noise1(i, seed)
  const b = noise1(i + 1, seed)
  return a + (b - a) * u
}

/**
 * 周期平滑噪声：与 smoothNoise 同构，但整数格点按 period 取模，
 * 因此 f(x) ≡ f(x + period)。用于任何"挂在 24h 时间轴上"的量
 * （风速/风向），否则 23:59→00:00 会出现整段噪声跳变。
 * period 必须为正整数格点数。
 */
export function periodicSmoothNoise(x: number, period: number, seed = 0): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  const m = (k: number) => ((k % period) + period) % period
  const a = noise1(m(i), seed)
  const b = noise1(m(i + 1), seed)
  return a + (b - a) * u
}
