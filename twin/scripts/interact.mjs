// 交互联动取证：关 AUTO → 拖目标功率滑杆 → 确认跟随/报警忽略 → 连拍两帧
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/nsslibs' },
  args: [...chromium.args, '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  headless: 'shell',
})
const page = await browser.newPage()
await page.goto('http://127.0.0.1:5173/?cam=2.6,17,1393', { waitUntil: 'networkidle0', timeout: 60000 })
await new Promise((r) => setTimeout(r, 4000))

// 1) 关闭 AUTO（接管中按钮）
await page.click('.auto-btn')
await new Promise((r) => setTimeout(r, 600))

// 2) 读滑杆当前值并改到 18MW，派发 input 事件驱动 React 受控组件
const before = await page.evaluate(() => {
  const s = document.querySelector('.target-zone input[type=range]')
  return s ? s.value : null
})
await page.evaluate(() => {
  const s = document.querySelector('.target-zone input[type=range]')
  if (!s) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(s, '18')
  s.dispatchEvent(new Event('input', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 2500))

// 3) 忽略第一条报警
await page.click('.ait:first-child')
await new Promise((r) => setTimeout(r, 800))

// 4) 播放/暂停：暂停后时钟文本应在两次采样间保持不变
const clockBefore = await page.evaluate(() => document.querySelector('.clock')?.textContent)
await page.click('.play')
await new Promise((r) => setTimeout(r, 1600))
const clockPaused1 = await page.evaluate(() => document.querySelector('.clock')?.textContent)
await new Promise((r) => setTimeout(r, 1200))
const clockPaused2 = await page.evaluate(() => document.querySelector('.clock')?.textContent)
await page.click('.play')
await new Promise((r) => setTimeout(r, 1600))
const clockResumed = await page.evaluate(() => document.querySelector('.clock')?.textContent)

// 5) 恢复自动模式 + 拖动滑杆回 34，恢复 hero 默认态
await page.click('.auto-btn')

const state = await page.evaluate(() => {
  const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null
  return {
    kpiMain: txt('.kpi-xl'),
    target: (document.querySelector('.target-zone input[type=range]') || {}).value,
    trackNote: txt('.track-note'),
    autoBtn: txt('.auto-btn'),
    firstAlarmDim: !!document.querySelector('.ait.acked'),
  }
})
console.log(JSON.stringify({ before, ...state, clockBefore, clockPaused1, clockPaused2, clockResumed }, null, 2))
await page.screenshot({ path: process.argv[2] || '../docs/research/shots/final/after_interact.png' })
await browser.close()
console.log('shot saved')
