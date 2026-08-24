import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import SkyAurora from './scene/SkyAurora'
import WorldTerrain from './scene/WorldTerrain'
import SparkleGround from './scene/SparkleGround'
import TurbineField from './scene/TurbineField'
import Effects from './scene/Effects'
import Hud from './hud/Hud'

export default function App() {
  return (
    <>
      <Canvas
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        camera={{ position: [430, 300, 690], fov: 42, near: 1, far: 9000 }}
      >
        <color attach="background" args={['#03080f']} />
        <fog attach="fog" args={['#071322', 1100, 4200]} />
        <hemisphereLight args={['#0e2b3f', '#010204', 0.55]} />
        <directionalLight position={[500, 700, -400]} intensity={0.5} color="#9fd8ff" />
        <SkyAurora />
        <WorldTerrain />
        <SparkleGround />
        <TurbineField />
        <OrbitControls
          makeDefault
          target={[30, 40, -40]}
          maxPolarAngle={Math.PI / 2.08}
          minDistance={120}
          maxDistance={2400}
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
