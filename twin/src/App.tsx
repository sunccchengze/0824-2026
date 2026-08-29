import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
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
import ErrorBoundary from './hud/ErrorBoundary'
import { CAM } from './scene/terrainUtil'
import { syncLineRes } from './scene/turbine/holoParts'

/** D9：Line2 分辨率统一同步（所有以 registerLineRes 注册的线材质） */
function LineResSync() {
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  useFrame(() => syncLineRes(size.width * dpr, size.height * dpr))
  return null
}

/**
 * D5：自适应画质——2.5s 滚动窗测帧率，低于 42fps 逐级下调 DPR，
 * 连续 4 个窗口高于 57fps 才回升一级（防抖）。
 */
function PerfGovernor() {
  const setDpr = useThree((s) => s.setDpr)
  const cap = useRef<number | null>(null)
  const st = useRef({ acc: 0, frames: 0, step: 0, calm: 0 })
  useFrame((state, dt) => {
    if (cap.current === null) cap.current = state.viewport.dpr
    const r = st.current
    r.acc += dt
    r.frames++
    if (r.acc < 2.5) return
    const fps = r.frames / r.acc
    r.acc = 0
    r.frames = 0
    const c = cap.current ?? 2
    const steps = [c, c * 0.8, c * 0.62, c * 0.5, 1].filter((v, i, a) => i === 0 || v < a[i - 1] - 0.01)
    if (fps < 42 && r.step < steps.length - 1) {
      r.step++
      setDpr(Math.max(1, steps[r.step]))
      r.calm = 0
    } else if (fps > 57) {
      r.calm++
      if (r.calm >= 4 && r.step > 0) {
        r.step--
        setDpr(Math.max(1, steps[r.step]))
        r.calm = 0
      }
    } else {
      r.calm = 0
    }
  })
  return null
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [glLost, setGlLost] = useState(false)
  const [veilGone, setVeilGone] = useState(false)

  // 首帧就绪后淡出加载幕布
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => setVeilGone(true), 500)
    return () => clearTimeout(t)
  }, [ready])

  return (
    <ErrorBoundary>
      <Canvas
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false }}
        dpr={[1, 2.5]}
        camera={{ position: [-100, 1720, -640], fov: 54, near: 1, far: 18000 }}
        onCreated={({ gl, scene }) => {
          gl.toneMappingExposure = 1.0
          scene.fog = new THREE.FogExp2('#040911', 0.00022)
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault()
            setGlLost(true)
          })
          // QA 探针：无头脚本读取 renderer.info（draw calls / 三角形数）
          ;(window as unknown as Record<string, unknown>).__aeolus = { gl }
          setReady(true)
        }}
      >
        <color attach="background" args={['#010305']} />
        <hemisphereLight args={['#123448', '#010408', 0.42]} />
        <directionalLight position={[700, 900, -500]} intensity={0.32} color="#a8d9ff" />
        <directionalLight position={[-600, 500, 900]} intensity={0.16} color="#3f88b8" />
        <directionalLight position={[-750, 1250, -650]} intensity={0.85} color="#d6e6ff" />
        <directionalLight position={[500, 420, 1150]} intensity={0.26} color="#86b8dc" />
        <EnvSetup />
        <Suspense fallback={null}>
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
        <LineResSync />
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
      <Hud />

      {/* D6：加载幕布（天空纹理/首帧未就绪前） */}
      {!veilGone && (
        <div className={`boot-veil${ready ? ' fade' : ''}`}>
          <div className="boot-inner">
            <div className="boot-logo">AEOLUS</div>
            <div className="boot-sub">风电流场智能感知与调控 · 数字孪生加载中</div>
            <div className="boot-bar"><i /></div>
          </div>
        </div>
      )}

      {/* D6：WebGL 上下文丢失兜底 */}
      {glLost && (
        <div className="fatal">
          <div className="fatal-card">
            <h2>图形上下文已丢失</h2>
            <p>GPU 资源被系统回收（多开 3D 页面或驱动重置时会发生）。</p>
            <button onClick={() => location.reload()}>重新加载</button>
          </div>
        </div>
      )}
    </ErrorBoundary>
  )
}
