import { EffectComposer, Vignette, Noise, SMAA, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'

// 后期链：SMAA + 轻微色散 + 胶片噪点 + 暗角；关闭 Bloom，确保白色风机保持清晰线条。
export default function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      <ChromaticAberration offset={[0.0011, 0.0007]} radialModulation modulationOffset={0.35} blendFunction={BlendFunction.NORMAL} />
      <Noise premultiply opacity={0.05} />
      <Vignette offset={0.22} darkness={0.78} eskil={false} />
    </EffectComposer>
  )
}
