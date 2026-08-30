// 运行时探针：FPS / DrawCall / 三角面 / 控制台错误（无头 Chromium + SwiftShader）
// 用法: node scripts/probe.mjs <url> [settleMs] [fpsMs]
// 依赖沙箱 /tmp/nsslibs（真机无需）；url 需带 ?debug=1 以暴露 __aeolus_stats
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

const url = process.argv[2] || 'http://127.0.0.1:5173/?debug=1'
const settleMs = Number(process.argv[3] || 8000)
const fpsMs = Number(process.argv[4] || 5000)

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/nsslibs' },
  args: [...chromium.args, '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1920, height: 1200, deviceScaleFactor: 1 },
  headless: 'shell',
})
const page = await browser.newPage()
const errs = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)))
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 })
await new Promise((r) => setTimeout(r, settleMs))
const res = await page.evaluate((fpsMs) => new Promise((resolve) => {
  const t0 = performance.now()
  let frames = 0
  const tick = () => {
    frames++
    if (performance.now() - t0 < fpsMs) requestAnimationFrame(tick)
    else {
      let stats = null
      try { stats = window.__aeolus_stats ? window.__aeolus_stats() : { missing: true } } catch (e) { stats = { err: String(e) } }
      resolve({ fps: Math.round(frames / (fpsMs / 1000)), ...stats, dpr: window.devicePixelRatio })
    }
  }
  requestAnimationFrame(tick)
}), fpsMs)
console.log(JSON.stringify(res))
if (errs.length) console.log('CONSOLE: ' + errs.slice(0, 10).join(' | '))
await browser.close()
