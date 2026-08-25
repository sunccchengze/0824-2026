import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CAM, FARM } from './terrainUtil'

// 开场巡航：先完成原图的大场景构图，再继续推近到中排中机组，
// 直到真实翼型、机舱和线框结构在画面中清晰可见（总计约 28s）。
// 之后回到自由轨道（OrbitControls）。
const FROM = new THREE.Vector3(1500, 1150, 2600)
const OVERVIEW = new THREE.Vector3(...CAM.pos)
const OVERVIEW_TARGET = new THREE.Vector3(...CAM.target)

// 近排左侧机组 T07 前方的近景终点：让真实翼型和线框占据画面，
// 同时保留后排机组、集电线和 HUD 的数字孪生叙事。
const CLOSE_UNIT = FARM[6]
const CLOSE = new THREE.Vector3(CLOSE_UNIT.x + 70, 132, CLOSE_UNIT.z + 145)
const CLOSE_TARGET = new THREE.Vector3(CLOSE_UNIT.x, 38, CLOSE_UNIT.z)
const TARGET_FROM = new THREE.Vector3(-200, 0, -500)

const START = 1.2
const OVERVIEW_END = 12
const CLOSE_END = 28

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
    if (t0 > CLOSE_END) {
      finished.current = true
      return
    }
    if (t0 < START) return // 等待首帧

    if (!controlsRef.current) {
      // 找到 OrbitControls（默认相机控制）
      const ctl = (state.controls as any) || null
      controlsRef.current = ctl
    }

    let p: THREE.Vector3
    let tg: THREE.Vector3
    if (t0 <= OVERVIEW_END) {
      const t = ease(Math.min(1, (t0 - START) / (OVERVIEW_END - START)))
      p = FROM.clone().lerp(OVERVIEW, t)
      tg = TARGET_FROM.clone().lerp(OVERVIEW_TARGET, t)
    } else {
      // 第二段不跳切：从全场官方机位继续滑轨推进到近景机组。
      const t = ease(Math.min(1, (t0 - OVERVIEW_END) / (CLOSE_END - OVERVIEW_END)))
      p = OVERVIEW.clone().lerp(CLOSE, t)
      tg = OVERVIEW_TARGET.clone().lerp(CLOSE_TARGET, t)
    }

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
