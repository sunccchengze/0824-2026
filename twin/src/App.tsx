import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import SkyAurora from './scene/SkyAurora'
import WorldTerrain from './scene/WorldTerrain'
import SparkleGround from './scene/SparkleGround'
import WindVeil from './scene/WindVeil'
import TurbineField from './scene/TurbineField'
import CableNetwork from './scene/CableNetwork'
import Substation from './scene/Substation'
import Callouts from './scene/Callouts'
import Effects from './scene/Effects'
import Hud from './hud/Hud'
import { CAM } from './scene/terrainUtil'

export default function App() {
  return (
    <>
      <Canvas
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        camera={{ position: CAM.pos, fov: CAM.fov, near: 1, far: 16000 }}
      >
        <color attach="background" args={['#02070d']} />
        <fog attach="fog" args={['#0a1a28', 2400, 8200]} />
        <hemisphereLight args={['#1a4a63', '#020509', 0.85]} />
        <directionalLight position={[700, 900, -500]} intensity={0.55} color="#a8d9ff" />
        <directionalLight position={[-600, 500, 900]} intensity={0.22} color="#3f88b8" />
        <SkyAurora />
        <WorldTerrain />
        <SparkleGround />
        <WindVeil />
        <CableNetwork />
        <Substation />
        <TurbineField />
        <Callouts />
        <OrbitControls
          makeDefault
          target={CAM.target}
          maxPolarAngle={Math.PI / 2.06}
          minDistance={260}
          maxDistance={4200}
          enableDamping
          dampingFactor={0.06}
        />
        <Effects />
      </Canvas>
      <Hud />
    </>
  )
}
