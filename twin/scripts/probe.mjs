// 探测 window.__getRotorTips 数据（排查叶片投影总线是否写入）
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
const here = path.dirname(fileURLToPath(import.meta.url))
const repoLibs = path.join(here, '..', 'nsslibs')
const url = process.argv[2] || 'http://127.0.0.1:5173/?debug&intro=0'
const waitMs = Number(process.argv[3] || 6000)
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  env: { ...process.env, LD_LIBRARY_PATH: repoLibs + ':/tmp/nsslibs' },
  args: [...chromium.args, '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 800, height: 600, deviceScaleFactor: 1 },
  headless: 'shell',
})
const page = await browser.newPage()
await page.goto(url, { waitUntil: 'load', timeout: 60000 })
await new Promise((r) => setTimeout(r, waitMs))
const data = await page.evaluate(() => {
  const f = window.__getRotorTips
  if (typeof f !== 'function') return { hasFn: false }
  const out = {}
  for (let i = 0; i < 9; i++) {
    const s = f(i)
    out[i] = s
      ? {
          hub: [s.hub.x, s.hub.y, s.hub.z].map((v) => +v.toFixed(1)),
          tips: s.tips.map((t) => [t.x, t.y, t.z].map((v) => +v.toFixed(1))),
        }
      : null
  }
  return { hasFn: true, out }
})
console.log(JSON.stringify(data, null, 2))
try { await browser.close() } catch { /* ignore */ }
setTimeout(() => process.exit(0), 300)
process.exit(0)
