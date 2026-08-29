import { Component, Suspense, useState, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { debugEnabled } from './data/debug'
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
import PerfGovernor from './scene/PerfGovernor'
import Hud from './hud/Hud'
import { CAM } from './scene/terrainUtil'
import { useSim } from './state/simStore'

// ============================================================================
// 装配壳（v3）
//  · D6：ErrorBoundary（场景崩溃 → 品牌错误屏，不再整页白屏）；
//  · WebGL 上下文丢失 → 捕获、暂停仿真、给出恢复按钮；
//  · 首帧黑屏修复：品牌 Loading 屏在 Canvas onCreated + 首帧后淡出；
//  · 开场巡航期间：任意点击画布 = 跳过（C5）；
//  · dpr 与画质档联动（high ≤2 / medium ≤1.5 / low =1）。
// ============================================================================

class SceneBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? e.message : String(e) }
  }
  componentDidCatch(e: unknown) {
    console.error('[AEOLUS] scene error', e)
  }
  render() {
    if (this.state.err) {
      return (
        <div className="fatal-screen">
          <div className="fatal-card">
            <h2>渲染层异常</h2>
            <p>{this.state.err}</p>
            <button onClick={() => location.reload()}>重新载入</button>
            <em>AEOLUS TWIN · 错误已隔离在 3D 层，HUD 数值口径不受影响</em>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const quality = useSim((s) => s.quality)
  const setFatal = useSim((s) => s.setFatal)
  const fatal = useSim((s) => s.fatal)
  const skipIntro = useSim((s) => s.skipIntro)
  const [ready, setReady] = useState(false)

  return (
    <>
      <div
        className="canvas-wrap"
        onPointerDown={() => {
          if (!useSim.getState().introDone) skipIntro()
        }}
      >
        <SceneBoundary>
          <Canvas
            gl={{ antialias: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false }}
            dpr={quality === 'high' ? [1, 2] : quality === 'medium' ? [1, 1.5] : [1, 1]}
            camera={{ position: [-100, 1720, -640], fov: 54, near: 1, far: 18000 }}
            onCreated={({ gl, scene, camera }) => {
              gl.toneMapping = THREE.ACESFilmicToneMapping
              gl.toneMappingExposure = 1.0
              scene.fog = new THREE.FogExp2('#040911', 0.00022)
              const canvas = gl.domElement
              canvas.addEventListener('webglcontextlost', (e) => {
                e.preventDefault()
                setFatal('WebGL 上下文丢失（显卡驱动重置或显存不足）。')
              })
              canvas.addEventListener('webglcontextrestored', () => setFatal(null))
              requestAnimationFrame(() => setReady(true))
              if (debugEnabled()) {
                ;(window as unknown as Record<string, unknown>).__aeolus_stats = () => {
                  // 手动单帧渲染计数（EffectComposer 存在时 gl.info 只反映后期 pass）
                  const prevTone = gl.toneMapping
                  gl.toneMapping = THREE.NoToneMapping
                  gl.info.reset()
                  gl.render(scene, camera)
                  gl.toneMapping = prevTone
                  return {
                    calls: gl.info.render.calls, triangles: gl.info.render.triangles,
                    lines: gl.info.render.lines, geometries: gl.info.memory.geometries,
                    textures: gl.info.memory.textures,
                  }
                }
              }
            }}
          >
            <color attach="background" args={['#010305']} />
            <hemisphereLight args={['#123448', '#010408', 0.42]} />
            <directionalLight position={[700, 900, -500]} intensity={0.32} color="#a8d9ff" />
            <directionalLight position={[-600, 500, 900]} intensity={0.16} color="#3f88b8" />
            <directionalLight position={[-750, 1250, -650]} intensity={0.85} color="#d6e6ff" />
            <directionalLight position={[500, 420, 1150]} intensity={0.26} color="#86b8dc" />
            <Suspense fallback={null}>
              <EnvSetup />
              <SkyAurora />
              <WorldTerrain />
              <SparkleGround count={4600} />
              <WindVeil />
              <CableNetwork />
              <Substation />
              <TurbineField />
              <Callouts />
            </Suspense>
            <CameraRig />
            <PerfGovernor />
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
        </SceneBoundary>
        {!ready && !fatal && (
          <div className="splash">
            <div className="splash-logo">AEOLUS TWIN</div>
            <div className="splash-sub">风电场偏航优化 · 数字孪生系统</div>
            <div className="splash-bar"><i /></div>
            <em>正在装配全息场景 · 零外部请求</em>
          </div>
        )}
        {fatal && (
          <div className="fatal-screen">
            <div className="fatal-card">
              <h2>图形上下文丢失</h2>
              <p>{fatal}</p>
              <button onClick={() => location.reload()}>重新载入</button>
            </div>
          </div>
        )}
      </div>
      <Hud />
    </>
  )
}
