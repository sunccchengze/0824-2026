import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import SkyAurora from './scene/SkyAurora'
import WorldTerrain from './scene/WorldTerrain'
import SparkleGround from './scene/SparkleGround'
import WindVeil from './scene/WindVeil'
import TurbineField from './scene/TurbineField'
import CableNetwork from './scene/CableNetwork'
import Substation from './scene/Substation'
import Callouts from './scene/Callouts'
import Effects from './scene/Effects'
import EnvSetup from './scene/EnvSetup'
import CameraRig from './scene/CameraRig'
import Hud from './hud/Hud'
import { CAM } from './scene/terrainUtil'

export default function App() {
  return (
    <>
      <Canvas
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        dpr={[1, 2.5]}
        camera={{ position: [-100, 1720, -640], fov: 54, near: 1, far: 18000 }}
        onCreated={({ gl, scene }) => {
          gl.toneMappingExposure = 1.0
          // 当前世界坐标以千米级铺开，使用按尺度换算后的指数雾，
          // 避免直接套用 0.015 将整片风场吞成纯黑。
          scene.fog = new THREE.FogExp2('#040911', 0.00022)
        }}
      >
        <color attach="background" args={['#010305']} />
        <hemisphereLight args={['#123448', '#010408', 0.42]} />
        <directionalLight position={[700, 900, -500]} intensity={0.32} color="#a8d9ff" />
        <directionalLight position={[-600, 500, 900]} intensity={0.16} color="#3f88b8" />
        <directionalLight position={[-750, 1250, -650]} intensity={0.85} color="#d6e6ff" />
        <directionalLight position={[500, 420, 1150]} intensity={0.26} color="#86b8dc" />
        <EnvSetup />
        <SkyAurora />
        <WorldTerrain />
        <SparkleGround count={4600} />
        <WindVeil />
        <CableNetwork />
        <Substation />
        <TurbineField />
        <Callouts />
        <CameraRig />
        <OrbitControls
          makeDefault
          target={CAM.target}
          maxPolarAngle={Math.PI / 2.06}
          minDistance={120}
          maxDistance={4600}
          enableDamping
          dampingFactor={0.06}
        />
        <Effects />
      </Canvas>
      <Hud />
    </>
  )
}
