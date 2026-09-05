// R32 临时截图：复用现有 shot.mjs 但用系统 Chrome（无需 NSS）
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const url = process.argv[2] || 'http://127.0.0.1:5173/'
const out = process.argv[3] || 'shot.png'
const waitMs = Number(process.argv[4] || 6000)
const w = Number(process.argv[5] || 1920)
const h = Number(process.argv[6] || 1080)
const exe = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const browser = await puppeteer.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
  defaultViewport: { width: w, height: h, deviceScaleFactor: 1 },
  headless: 'shell',
})
const page = await browser.newPage()
const logs = []
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[err] ${m.text().slice(0, 200)}`) })
page.on('pageerror', (e) => logs.push(`[pe] ${String(e).slice(0, 300)}`))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise((r) => setTimeout(r, waitMs))
// 跳过开场运镜（如果还在 intro 期间）
await page.evaluate(() => {
  const w = window
  if (w.__aeolus?.sim?.getState) {
    w.__aeolus.sim.getState().skipIntro?.()
  }
})
await new Promise((r) => setTimeout(r, 1500))
await page.screenshot({ path: out, type: 'png' })
console.log('OK', out, w + 'x' + h, 'logs=' + logs.length)
logs.slice(0, 8).forEach((l) => console.log(l))
await browser.close()
