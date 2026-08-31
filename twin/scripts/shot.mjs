// ================================================================
// 场景截图（QA 用，可复现）
// 用法: node scripts/shot.mjs <url> <out.png> [settleMs]
// url 需含 ?debug=1&t=<h>&intro=0&cam=az,el,dist,tx,ty,tz
// ================================================================
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
const [url, out, settleArg] = process.argv.slice(2)
const settleMs = Number(settleArg || 9000)
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/nsslibs' },
  args: [...chromium.args, '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  headless: 'shell',
})
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)))
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 })
await new Promise((r) => setTimeout(r, settleMs))
// 异常系统兜底：锁时钟本就不触发，这里再确保无残留弹窗
await page.evaluate(() => {
  const S = window.__aeolus?.useSim
  if (S) { const s = S.getState(); if (s.anomalyActive || s.anomalyModal) S.setState({ anomalyActive: null, anomalyModal: null }) }
})
await page.screenshot({ path: out })
if (errs.length) console.log('ERRORS: ' + errs.join(' | '))
await browser.close()
console.log('SHOT-DONE ' + out)
