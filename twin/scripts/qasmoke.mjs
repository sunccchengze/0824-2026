import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
const browser=await puppeteer.launch({executablePath:await chromium.executablePath(),env:{...process.env,LD_LIBRARY_PATH:'/tmp/nsslibs'},args:[...chromium.args,'--no-sandbox','--disable-gpu-sandbox','--enable-unsafe-swiftshader'],defaultViewport:{width:480,height:270},headless:'shell'})
const page=await browser.newPage()
const errs=[];page.on('pageerror',e=>errs.push(String(e).slice(0,120)));page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,120))})
await page.goto('http://127.0.0.1:5173/?debug=1&introT=2.5',{waitUntil:'networkidle0',timeout:90000})
await new Promise(r=>setTimeout(r,3000))
const r=await page.evaluate(()=>({cam:!!window.__aeolus_cam, stats:!!window.__aeolus_stats}))
console.log(JSON.stringify(r),'errs:',errs.slice(0,3).join('|'))
await browser.close()
