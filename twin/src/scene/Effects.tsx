import { EffectComposer, Bloom, Vignette, Noise, SMAA } from '@react-three/postprocessing'

// W12 后期链基础版（Phase 3 调优：N8AO/LUT/雾层）
export default function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      <Bloom intensity={1.05} luminanceThreshold={0.5} luminanceSmoothing={0.22} mipmapBlur radius={0.8} />
      <Noise opacity={0.035} />
      <Vignette offset={0.22} darkness={0.72} eskil={false} />
    </EffectComposer>
  )
}
