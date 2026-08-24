import { EffectComposer, Bloom, Vignette, Noise, SMAA } from '@react-three/postprocessing'

// W12 后期链：SMAA + 阈值下调的辉光（吃满电缆河/极光/光盘）+ 胶片噪点 + 暗角
export default function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      <Bloom intensity={0.88} luminanceThreshold={0.44} luminanceSmoothing={0.3} mipmapBlur radius={0.72} />
      <Noise opacity={0.032} />
      <Vignette offset={0.26} darkness={0.72} eskil={false} />
    </EffectComposer>
  )
}
