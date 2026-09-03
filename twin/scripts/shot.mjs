// 无头截图工具：puppeteer-core + @sparticuz/chromium（沙箱可用的离线 Chromium）
// 用法: node scripts/shot.mjs <url> <out.png> [waitMs] [w] [h]
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

// 沙箱内 NSS/NSPR 库：优先仓库内持久副本（twin/nsslibs），回退 /tmp/nsslibs
const here = path.dirname(fileURLToPath(import.meta.url))
const repoLibs = path.join(here, '..', 'nsslibs')

const url = process.argv[2] || 'http://127.0.0.1:5173/'
const out = process.argv[3] || 'shot.png'
const waitMs = Number(process.argv[4] || 9000)
const w = Number(process.argv[5] || 1920)
const h = Number(process.argv[6] || 1080)

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  env: { ...process.env, LD_LIBRARY_PATH: repoLibs + ':/tmp/nsslibs' },
  args: [...chromium.args, '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: w, height: h, deviceScaleFactor: 1 },
  headless: 'shell',
})
const page = await browser.newPage()
const logs = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 400)}`))
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 })
if (process.env.SHOT_INIT) await page.evaluate(process.env.SHOT_INIT)
await new Promise((r) => setTimeout(r, waitMs))
if (process.env.SHOT_SEL) {
  const el = await page.$(process.env.SHOT_SEL)
  if (!el) throw new Error('selector not found: ' + process.env.SHOT_SEL)
  await el.screenshot({ path: out })
} else {
  await page.screenshot({ path: out })
}
console.log('saved', out)
if (logs.length) console.log('--- console ---\n' + logs.slice(0, 25).join('\n'))
await browser.close()
