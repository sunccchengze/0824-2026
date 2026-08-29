// ================================================================
// QA2 证据注入器（docs/08 D2：联动/闭环截图的可复现工具）
// 通过 ?debug=1 暴露的 window.__aeolus 闭包读写 store —— 必须走该引用：
// vite dev 的 HMR 会给静态 import 加 ?t= 时间戳，页面里裸动态 import
// 模块会拿到"未挂时钟"的副本实例，读数失真（2026-08-28 踩坑记录）。
// 用法: node scripts/qa2.mjs <baseUrl含debug> <out_curtail.png> <out_optimize.png>
// ================================================================
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
const [urlBase, outCurtail, outOptimize] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/nsslibs' },
  args: [...chromium.args, '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  headless: 'shell',
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('[pageerror]', String(e).slice(0, 200)))
await page.goto(urlBase + '&cam=0,22,990,0,22,-340', { waitUntil: 'networkidle0', timeout: 60000 })
await sleep(7000)

// —— 场景1：调度限功率 12MW @ 04:30（研究内容③闭环：功率指令 → 全场降额）——
const r1 = await page.evaluate(async () => {
  const { useSim: S, farmFrameNow } = window.__aeolus
  S.setState({ targetMW: 12, tHours: 4.5, playing: false })
  await new Promise((r) => setTimeout(r, 600))
  const fr = farmFrameNow()
  return { t: S.getState().tHours, target: S.getState().targetMW, total: +fr.totalMW.toFixed(2),
    derate: +fr.derateFrac.toFixed(3), curtailUnits: fr.units.filter((u) => u.status === 'curtail').length }
})
console.log('CURTAIL', JSON.stringify(r1))
await sleep(500)
await page.screenshot({ path: outCurtail })

// —— 场景2：乱偏航 → 一键寻优（A6 联动 + 偏航增益）——
const r2 = await page.evaluate(async () => {
  const { useSim: S, farmFrameNow } = window.__aeolus
  S.setState({ targetMW: 45, tHours: 15 })
  for (let i = 0; i < 9; i++) S.getState().setUnitYaw(i, 25 - (i % 3) * 12)
  await new Promise((r) => setTimeout(r, 600))
  const fr = farmFrameNow()
  return { total: +fr.totalMW.toFixed(2), yaw: fr.units.map((u) => u.yawDeg).join('|'),
    wake: +fr.wakeLossPct.toFixed(1), prec: +fr.yawPrecPct.toFixed(1) }
})
console.log('BEFORE_OPT', JSON.stringify(r2))
await page.evaluate(() => window.__aeolus.useSim.getState().runOptimize())
await sleep(2600)
const r3 = await page.evaluate(() => {
  const { useSim: S, farmFrameNow } = window.__aeolus
  const fr = farmFrameNow()
  return { note: S.getState().optimizeNote, total: +fr.totalMW.toFixed(2),
    wake: +fr.wakeLossPct.toFixed(1), prec: +fr.yawPrecPct.toFixed(1) }
})
console.log('AFTER_OPT', JSON.stringify(r3))
await page.screenshot({ path: outOptimize })
await browser.close()
console.log('QA2-DONE')
