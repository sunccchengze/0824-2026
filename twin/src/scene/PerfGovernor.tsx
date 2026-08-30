import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useSim } from '../state/simStore'

// ============================================================================
// 自适应画质调节器（D5 修复）
// ----------------------------------------------------------------------------
// · 以帧时 EMA 判断 GPU 档位：持续 >22ms 降档，持续 <13ms 且自动模式升档；
// · 档位联动：dpr（Canvas 侧）+ Effects（后期链）；
// · 提供 ?q=low|medium|high 手动锁档（QA/低配答辩现场兜底）。
// · 启动保护：首个稳定画面后的短暂预热期不切画质，避免 EffectComposer/
//   render target 在开场前几秒重建，造成黑帧和相机看似闪跳。
// ============================================================================

const ORDER = ['low', 'medium', 'high'] as const
const STARTUP_GUARD_MS = 6500

export default function PerfGovernor() {
  const { gl } = useThree()
  const ema = useRef(16)
  const acc = useRef(0)
  const bootAt = useRef<number | null>(null)
  const lock = useRef<string | null>(
    typeof location !== 'undefined'
      ? (new URLSearchParams(location.search).get('q') as 'low' | 'medium' | 'high' | null)
      : null,
  )

  useFrame((_, dt) => {
    if (bootAt.current === null) bootAt.current = performance.now()

    if (lock.current) {
      // 锁档一次性生效
      const q = lock.current as 'low' | 'medium' | 'high'
      lock.current = null
      if (ORDER.includes(q)) useSim.getState().setQuality(q)
    }
    const d = Math.min(100, dt * 1000)
    ema.current = ema.current * 0.95 + d * 0.05
    acc.current += dt
    if (acc.current < 2) return
    acc.current = 0

    // 启动阶段可能同时发生 shader 编译、PMREM 和第一轮 postprocessing
    // 建立；任何自动降档都会卸载/重建渲染链。让首屏至少稳定一小段时间，
    // 也避免第一段开场运镜把一次性编译开销误判为持续低性能。
    if (performance.now() - bootAt.current < STARTUP_GUARD_MS) return

    const s = useSim.getState()
    if (!s.qualityAuto) return
    const cur = ORDER.indexOf(s.quality)
    if (ema.current > 22 && cur > 0) {
      s.setQuality(ORDER[cur - 1] as 'low' | 'medium' | 'high')
    } else if (ema.current < 13 && cur < 2) {
      s.setQuality(ORDER[cur + 1] as 'medium' | 'high')
    }
  })

  // dpr 由 App 侧 <Canvas dpr=...> 与 quality 联动（避免与 R3F 的像素比管理打架）
  void gl
  return null
}
