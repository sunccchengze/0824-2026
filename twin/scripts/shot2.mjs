// 干净场景截图：?debug&intro=0 + 隐藏 HUD + 设置时刻 + 定位相机
// 用法: node scripts/shot2.mjs <url> <out.png> [waitMs]
//   url 形如: http://127.0.0.1:5173/?debug&intro=0&cam=az,el,dist,tx,ty,tz
//   env:
//     SHOT_TIME  -> 拍摄时刻(小时, 默认 12 正午)；-1 表示不设置
//     SHOT_W / SHOT_H -> 分辨率 (默认 1920x1080)
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoLibs = path.join(here, '..', 'nsslibs')
const url = process.argv[2]
const out = process.argv[3] || 'shot.png'
const waitMs = Number(process.argv[4] || 8000)
const W = Number(process.env.SHOT_W || 1920)
const H = Number(process.env.SHOT_H || 1080)

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  env: { ...process.env, LD_LIBRARY_PATH: repoLibs + ':/tmp/nsslibs' },
  args: [...chromium.args, '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  headless: 'shell',
})
const page = await browser.newPage()
const logs = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 400)}`))
await page.goto(url, { waitUntil: 'load', timeout: 60000 })

// 隐藏 HUD + 设置时刻
await page.evaluate((t) => {
  const hud = document.querySelector('.hud')
  if (hud) hud.style.display = 'none'
  const ld = document.querySelector('[class*="loading" i]')
  if (ld) ld.style.display = 'none'
  const a = window.__aeolus
  if (a && a.useSim && a.useSim.getState && t >= 0) a.useSim.getState().seek(t)
}, Number(process.env.SHOT_TIME !== undefined ? process.env.SHOT_TIME : 12))

await new Promise((r) => setTimeout(r, waitMs))
await page.screenshot({ path: out })
console.log('saved', out)
if (logs.length) console.log('--- console ---\n' + logs.slice(0, 25).join('\n'))
try { await browser.close() } catch { /* ignore */ }
// 强制退出：WebGL/动画流可能让事件循环挂着不结束
setTimeout(() => process.exit(0), 400)
process.exit(0)
