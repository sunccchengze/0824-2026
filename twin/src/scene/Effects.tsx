import { EffectComposer, Vignette, Noise, SMAA, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { useSim } from '../state/simStore'

// ============================================================================
// 后期链（v3：按画质档降级 + C 类观感修正）
// ----------------------------------------------------------------------------
//  · C-CA：色差偏移 0.0011→0.0005（docs/08 §1.6 裁决：白线撕裂证据不足，
//    但 0.0011 在 1080p ≈ 2.1px 边缘位移，对 0.85px 电缆/1px 白线是净风险，
//    减半保留胶片感；低档直接关闭）；
//  · C11/暗部噪声：Vignette darkness 0.78→0.52、Noise 0.05→0.02
//    （docs/07 实测暗部 σ=1.57，主要来自 Noise；0.02 下 σ≈0.6 接近黑场）。
//  · 画质档（PerfGovernor 驱动）：high 全链；medium 关 CA+Noise；
//    low 仅 SMAA+Vignette（软渲染/集显/低端移动 GPU 可用）。
//  · Bloom 保持关闭（docs/07 C 类 + 用户红线：泛光会糊白线）。
// ============================================================================

export default function Effects() {
  const quality = useSim((s) => s.quality)
  if (quality === 'low') {
    return (
      <EffectComposer multisampling={0}>
        <SMAA />
      </EffectComposer>
    )
  }
  if (quality === 'medium') {
    return (
      <EffectComposer multisampling={0}>
        <SMAA />
        <Vignette offset={0.24} darkness={0.52} eskil={false} />
      </EffectComposer>
    )
  }
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      <ChromaticAberration
        offset={[0.0005, 0.00032]}
        radialModulation
        modulationOffset={0.4}
        blendFunction={BlendFunction.NORMAL}
      />
      <Noise premultiply opacity={0.02} />
      <Vignette offset={0.24} darkness={0.52} eskil={false} />
    </EffectComposer>
  )
}
