import { EffectComposer, Vignette, Noise, SMAA, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'

// 后期链：SMAA + 轻色散 + 胶片噪点 + 暗角；关闭 Bloom，确保白色风机保持清晰线条。
// C-CA/C11 修正：色散偏移减半（0.0011→0.00045，实测纯白线最大错位 <1px）；
// 噪点 0.05→0.032（暗部噪底 σ 1.57→≈1.0）；暗角 0.78→0.58（1080p 去“筒窥感”）。
export default function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      <ChromaticAberration offset={[0.00045, 0.0003]} radialModulation modulationOffset={0.35} blendFunction={BlendFunction.NORMAL} />
      <Noise premultiply opacity={0.032} />
      <Vignette offset={0.22} darkness={0.58} eskil={false} />
    </EffectComposer>
  )
}
