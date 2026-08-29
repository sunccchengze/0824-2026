// 渲染统计探针：读取 window.__aeolus.gl.info（draw calls / 三角形 / 帧率粗测）
// 用法: node scripts/info.mjs <url> [waitMs]
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

const url = process.argv[2] || 'http://127.0.0.1:5173/'
const waitMs = Number(process.argv[3] || 6000)

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/nsslibs' },
  args: [...chromium.args, '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  headless: 'shell',
})
const page = await browser.newPage()
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 })
await new Promise((r) => setTimeout(r, waitMs))
// 跨帧采样：关闭 autoReset，清空计数，让 rAF 数帧，读累计值除以帧数
await page.evaluate(() => {
  const p = globalThis.__aeolus
  if (!p?.gl) return false
  p.gl.info.autoReset = false
  p.gl.info.reset()
  p.__frames = 0
  const tick = () => { p.__frames++; p.__raf = requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  return true
})
const sampleMs = Number(process.argv[4] || 3000)
await new Promise((r) => setTimeout(r, sampleMs))
const info = await page.evaluate((ms) => {
  const p = globalThis.__aeolus
  if (!p?.gl) return null
  cancelAnimationFrame(p.__raf)
  const f = Math.max(1, p.__frames)
  const r = p.gl.info
  const out = {
    frames: f,
    callsPerFrame: Math.round(r.render.calls / f),
    trianglesPerFrame: Math.round(r.render.triangles / f),
    pointsPerFrame: Math.round(r.render.points / f),
    linesPerFrame: Math.round(r.render.lines / f),
    geometries: r.memory.geometries,
    textures: r.memory.textures,
    programs: r.programs?.length,
    fpsHeadless: Math.round((f / (ms / 1000)) * 10) / 10,
  }
  r.autoReset = true
  return out
}, sampleMs)
console.log(JSON.stringify(info, null, 2))
await browser.close()
