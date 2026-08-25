import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CAM } from './terrainUtil'

// 开场巡航：从远高空推近到官方机位（12s，三次贝塞尔缓动）
// 之后回到自由轨道（OrbitControls）
const FROM = new THREE.Vector3(1500, 1150, 2600)
const TO = new THREE.Vector3(...CAM.pos)
const TARGET_FROM = new THREE.Vector3(-200, 0, -500)
const TARGET_TO = new THREE.Vector3(...CAM.target)

// 简易 smoothstep 缓动
const ease = (t: number) => t * t * (3 - 2 * t)

export default function CameraRig() {
  const controlsRef = useRef<any>(null)
  const { camera } = useThree()
  const finished = useRef(false)

  useFrame((state) => {
    // 从状态读取是否已交互（OrbitControls 的事件在 window 处理）
    const el = state.gl.domElement
    if (finished.current) return

    const t0 = state.clock.elapsedTime
    if (t0 > 12) {
      finished.current = true
      return
    }
    if (t0 < 1.2) return // 等待首帧

    const t = ease(Math.min(1, (t0 - 1.2) / 10))
    if (!controlsRef.current) {
      // 找到 OrbitControls（默认相机控制）
      const ctl = (state.controls as any) || null
      controlsRef.current = ctl
    }

    const p = FROM.clone().lerp(TO, t)
    const tg = TARGET_FROM.clone().lerp(TARGET_TO, t)
    camera.position.copy(p)
    camera.lookAt(tg)
    const ctl2 = controlsRef.current
    if (ctl2) {
      ctl2.target.copy(tg)
      ctl2.update()
    }
    void el
  })

  return null
}
