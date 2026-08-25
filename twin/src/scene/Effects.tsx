import { EffectComposer, Bloom, Vignette, Noise, SMAA, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'

// 后期链：SMAA + 高动态 Bloom（吃满全息辉光）+ 轻微色散 + 胶片噪点 + 暗角
export default function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      <Bloom intensity={1.05} luminanceThreshold={0.34} luminanceSmoothing={0.28} mipmapBlur radius={0.78} />
      <ChromaticAberration offset={[0.0011, 0.0007]} radialModulation modulationOffset={0.35} blendFunction={BlendFunction.NORMAL} />
      <Noise premultiply opacity={0.05} />
      <Vignette offset={0.22} darkness={0.78} eskil={false} />
    </EffectComposer>
  )
}
