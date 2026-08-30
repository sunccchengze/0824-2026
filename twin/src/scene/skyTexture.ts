/* 程序生成 2048×1024 equirectangular 夜空：种子化星野 + 银河带 + 暗星尘。
 * 取代旧 AI 位图资产（/sky-realistic-cyan.png，任务#6）：完全确定性
 * （mulberry32 种子），逐帧零成本，纹理仅构建一次。 */
import { mulberry32 } from '../data/rng.ts'

const TAU = Math.PI * 2

function gaussian(rnd: () => number): number {
  // Box-Muller，极坐标式
  const u = Math.max(rnd(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rnd())
}

export function makeSkyCanvas(): HTMLCanvasElement {
  const W = 2048
  const H = 1024
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  // 天底→地平线基础渐变
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#020a15')
  grad.addColorStop(0.42, '#04101d')
  grad.addColorStop(0.5, '#08202f')
  grad.addColorStop(0.56, '#040d16')
  grad.addColorStop(1, '#010509')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  const rnd = mulberry32(0x54E917)
  // 银河带：正弦脊线（在 equirect 上环绕一圈）
  const ridge = (u: number) => H * 0.315 + Math.sin(u * TAU + 0.9) * H * 0.145
  const sigma = H * 0.085
  // 暗星尘（沿带密度高）
  for (let i = 0; i < 5200; i++) {
    const u = rnd() * W
    const inBand = rnd() < 0.72
    const y = inBand ? ridge(u / W) + gaussian(rnd) * sigma : rnd() * H * 0.52
    const a = (inBand ? 0.10 + rnd() * 0.34 : 0.05 + rnd() * 0.16) * (1 - 0.55 * Math.abs(y / (H * 0.5) - 1))
    if (a <= 0.02) continue
    const s = rnd() < 0.08 ? 1.25 : 0.75
    ctx.fillStyle = `rgba(${200 + Math.floor(rnd() * 40)},${222 + Math.floor(rnd() * 28)},255,${a.toFixed(3)})`
    ctx.fillRect(u, y, s, s)
  }
  // 亮星 + 十字光芒
  for (let i = 0; i < 110; i++) {
    const u = rnd() * W
    const y = ridge(u / W) * (0.5 + rnd() * 0.75)
    const R = 0.8 + rnd() * (rnd() < 0.16 ? 2.2 : 0.9)
    const a = 0.5 + rnd() * 0.5
    const g2 = ctx.createRadialGradient(u, y, 0, u, y, R * 5)
    g2.addColorStop(0, `rgba(235,248,255,${a})`)
    g2.addColorStop(0.35, `rgba(180,225,250,${(a * 0.4).toFixed(3)})`)
    g2.addColorStop(1, 'rgba(120,180,220,0)')
    ctx.fillStyle = g2
    ctx.beginPath()
    ctx.arc(u, y, R * 5, 0, TAU)
    ctx.fill()
    if (R > 1.9) {
      ctx.strokeStyle = `rgba(220,240,255,${(a * 0.35).toFixed(3)})`
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(u - R * 6, y); ctx.lineTo(u + R * 6, y)
      ctx.moveTo(u, y - R * 6); ctx.lineTo(u, y + R * 6)
      ctx.stroke()
    }
  }
  // 星云暗涌（沿带的极淡团块，克制到近不可见）
  for (let i = 0; i < 26; i++) {
    const u = rnd() * W
    const y = ridge(u / W) + gaussian(rnd) * sigma * 0.8
    const R = 60 + rnd() * 180
    const g3 = ctx.createRadialGradient(u, y, 0, u, y, R)
    const a = 0.020 + rnd() * 0.03
    g3.addColorStop(0, `rgba(150,205,235,${a.toFixed(3)})`)
    g3.addColorStop(1, 'rgba(120,180,220,0)')
    ctx.fillStyle = g3
    ctx.beginPath()
    ctx.ellipse(u, y, R, R * 0.5, rnd() * TAU, 0, TAU)
    ctx.fill()
  }
  return c
}
