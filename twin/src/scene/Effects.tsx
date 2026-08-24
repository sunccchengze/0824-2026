import { EffectComposer, Bloom, Vignette, Noise, SMAA } from '@react-three/postprocessing'

// W12 后期链基础版（Phase 3 调优：N8AO/LUT/雾层）
export default function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      <Bloom intensity={0.9} luminanceThreshold={0.58} luminanceSmoothing={0.25} mipmapBlur radius={0.85} />
      <Noise opacity={0.03} />
      <Vignette offset={0.24} darkness={0.7} eskil={false} />
    </EffectComposer>
  )
}
