import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './styles/theme.css'
import { startSimClock, useSim, farmFrameNow } from './state/simStore'
import { pickSourceFromQuery } from './data/telemetry'
import { debugEnabled } from './data/debug'

// 全局仿真时钟（真实 50s = 模拟 24h）：时间轴真正驱动 HUD 与 3D
startSimClock()
// 遥测源装配：默认 DemoSource（本地确定性）；?ws= 显式开启实时源（v3 接口）
pickSourceFromQuery().start()
// 调试探针（仅 DEV/?debug=1）：供 QA 自动化注入指令、读取 store
if (debugEnabled()) {
  (window as unknown as Record<string, unknown>).__aeolus = { useSim, farmFrameNow }
  const tq = new URLSearchParams(location.search).get('t')
  if (tq && Number.isFinite(Number(tq))) useSim.setState({ tHours: Number(tq), playing: false })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
