import { EffectComposer, Bloom, Vignette, Noise, SMAA, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'

// 后期链：SMAA + 受控 Bloom（避免远景风机被泛光吞没）+ 轻微色散 + 胶片噪点 + 暗角
export default function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      <Bloom intensity={0.55} luminanceThreshold={0.70} luminanceSmoothing={0.22} mipmapBlur radius={0.40} />
      <ChromaticAberration offset={[0.0011, 0.0007]} radialModulation modulationOffset={0.35} blendFunction={BlendFunction.NORMAL} />
      <Noise premultiply opacity={0.05} />
      <Vignette offset={0.22} darkness={0.78} eskil={false} />
    </EffectComposer>
  )
}
