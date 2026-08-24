import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import SkyAurora from './scene/SkyAurora'
import WorldTerrain from './scene/WorldTerrain'
import SparkleGround from './scene/SparkleGround'
import TurbineField from './scene/TurbineField'
import CableNetwork from './scene/CableNetwork'
import Substation from './scene/Substation'
import Effects from './scene/Effects'
import Hud from './hud/Hud'

export default function App() {
  return (
    <>
      <Canvas
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        camera={{ position: [480, 780, 920], fov: 40, near: 1, far: 9000 }}
      >
        <color attach="background" args={['#03080f']} />
        <fog attach="fog" args={['#081527', 1600, 5600]} />
        <hemisphereLight args={['#0e2b3f', '#010204', 0.55]} />
        <directionalLight position={[500, 700, -400]} intensity={0.5} color="#9fd8ff" />
        <SkyAurora />
        <WorldTerrain />
        <SparkleGround />
        <CableNetwork />
        <Substation />
        <TurbineField />
        <OrbitControls
          makeDefault
          target={[40, 20, 60]}
          maxPolarAngle={Math.PI / 2.12}
          minDistance={220}
          maxDistance={3200}
          enableDamping
          dampingFactor={0.06}
          autoRotate
          autoRotateSpeed={0.12}
        />
        <Effects />
      </Canvas>
      <Hud />
    </>
  )
}
