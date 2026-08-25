import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CAM, FARM } from './terrainUtil'

// 开场巡航使用一条连续的 Catmull-Rom 镜头轨迹：
// 远高空 → 全场构图节点 → 低机位近景。全景节点只是经过，不在中间刹停，
// 因此镜头方向、速度和景别会连续过渡，最后自然落到轻微仰视的风机特写。
const FROM = new THREE.Vector3(1500, 1150, 2600)
const OVERVIEW = new THREE.Vector3(...CAM.pos)
const OVERVIEW_TARGET = new THREE.Vector3(...CAM.target)

// 近排左侧机组 T07 前方的近景终点：
// 相机高度低于轮毂观察点，最后形成轻微仰视，而不是从塔顶向下俯看。
const CLOSE_UNIT = FARM[6]
const CLOSE = new THREE.Vector3(CLOSE_UNIT.x + 76, 56, CLOSE_UNIT.z + 168)
const CLOSE_TARGET = new THREE.Vector3(CLOSE_UNIT.x, 92, CLOSE_UNIT.z)
const TARGET_FROM = new THREE.Vector3(-200, 0, -500)

const CAMERA_PATH = new THREE.CatmullRomCurve3([FROM, OVERVIEW, CLOSE], false, 'centripetal', 0.5)
const LOOK_PATH = new THREE.CatmullRomCurve3([TARGET_FROM, OVERVIEW_TARGET, CLOSE_TARGET], false, 'centripetal', 0.5)
const START = 1.2
const INTRO_END = 28

// 简易 smoothstep 缓动（只包住整条轨迹，绝不在中间节点重新计时）
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
    if (t0 > INTRO_END) {
      finished.current = true
      return
    }
    if (t0 < START) return // 等待首帧

    if (!controlsRef.current) {
      // 找到 OrbitControls（默认相机控制）
      const ctl = (state.controls as any) || null
      controlsRef.current = ctl
    }

    const progress = ease(Math.min(1, (t0 - START) / (INTRO_END - START)))
    // getPointAt 按弧长取样，且穿过 OVERVIEW 节点时保持连续切线，避免“两段式”停顿。
    const p = CAMERA_PATH.getPointAt(progress)
    const tg = LOOK_PATH.getPointAt(progress)

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
