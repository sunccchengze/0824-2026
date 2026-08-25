import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM } from './terrainUtil'

// ============================================================================
// 炫技无人机开场：一条连续的三维航拍轨迹，而不是“远景 → 近景”的直线推镜。
//
// 轨迹依次经过：
// 1. 高空切入整个阵列的正上方俯瞰
// 2. 向远处侧绕，展示阵列的纵深和电缆网络
// 3. 从远处快速前推进入风机阵列
// 4. 在不同机组之间交叉穿梭，并带有轻微机身侧倾
// 5. 最后降到 T07 前方，以低机位轻微仰视停住
//
// 所有节点属于同一条 Catmull-Rom 曲线：中途不停刹、不跳切；节点之间的
// 距离差异自然制造快慢结合，再用连续的视线曲线和滚转角强化无人机感。
// ============================================================================

const FROM = new THREE.Vector3(1500, 1150, 2600)
const TARGET_FROM = new THREE.Vector3(-200, 0, -500)

const CLOSE_UNIT = FARM[6]
const CLOSE = new THREE.Vector3(CLOSE_UNIT.x + 76, 56, CLOSE_UNIT.z + 168)
const CLOSE_TARGET = new THREE.Vector3(CLOSE_UNIT.x, 92, CLOSE_UNIT.z)

// 相机节点：大间距段是快速航段，小间距段是穿梭段，形成明显的速度层次。
const CAMERA_NODES = [
  FROM,
  new THREE.Vector3(-110, 1550, -560), // 整个阵列正上方
  new THREE.Vector3(-110, 1230, -560), // 高空俯瞰缓冲，不急着离开
  new THREE.Vector3(-1560, 860, -1480), // 绕到西北远处
  new THREE.Vector3(1740, 760, -930), // 横跨远景，视角大幅扭转
  new THREE.Vector3(650, 315, -515), // 快速前推，切入风场
  new THREE.Vector3(300, 170, -255), // 掠过右侧机组
  new THREE.Vector3(-30, 112, -470), // 穿入中间机组之间
  new THREE.Vector3(-250, 82, -120), // 横切到近排左侧
  CLOSE,
]
const LOOK_NODES = [
  TARGET_FROM,
  new THREE.Vector3(-110, 0, -560),
  new THREE.Vector3(-110, 70, -560),
  new THREE.Vector3(-90, 85, -540),
  new THREE.Vector3(-90, 90, -480),
  new THREE.Vector3(-80, 92, -440),
  new THREE.Vector3(330, 90, -184), // 短暂锁定右侧机组
  new THREE.Vector3(-110, 98, -632), // 视线转向中排机组
  new THREE.Vector3(-500, 96, -200), // 最后锁定近排左侧机组
  CLOSE_TARGET,
]

const CAMERA_PATH = new THREE.CatmullRomCurve3(CAMERA_NODES, false, 'centripetal', 0.38)
const LOOK_PATH = new THREE.CatmullRomCurve3(LOOK_NODES, false, 'centripetal', 0.38)
const ROLL_PATH = new THREE.CatmullRomCurve3(
  [0, 0, 0, 18, -22, 15, -13, 12, -8, 0].map((v) => new THREE.Vector3(v, 0, 0)),
  false,
  'centripetal',
  0.38,
)

const START = 1.2
const INTRO_END = 34

// 整体缓入缓出，但不在中间节点重新 smoothstep，因此不会产生“两段式”停顿。
const ease = (t: number) => t * t * (3 - 2 * t)

export default function CameraRig() {
  const controlsRef = useRef<any>(null)
  const { camera } = useThree()
  const finished = useRef(false)

  useFrame((state) => {
    const el = state.gl.domElement
    if (finished.current) return

    const t0 = state.clock.elapsedTime
    if (t0 > INTRO_END) {
      finished.current = true
      return
    }
    if (t0 < START) return

    if (!controlsRef.current) {
      controlsRef.current = (state.controls as any) || null
    }

    const progress = ease(Math.min(1, (t0 - START) / (INTRO_END - START)))
    // 使用 getPoint（而不是 getPointAt）让节点本身成为真实航拍动作点；
    // Catmull-Rom 会在节点处保持连续切线，避免镜头方向突然折断。
    const p = CAMERA_PATH.getPoint(progress)
    const tg = LOOK_PATH.getPoint(progress)
    const roll = THREE.MathUtils.degToRad(ROLL_PATH.getPoint(progress).x)

    camera.position.copy(p)
    camera.lookAt(tg)
    const ctl2 = controlsRef.current
    if (ctl2) {
      ctl2.target.copy(tg)
      ctl2.update()
    }

    // 重新施加视线和滚转：OrbitControls 更新目标后，保留无人机机身侧倾。
    camera.lookAt(tg)
    camera.rotateZ(roll)

    // 高空段使用更宽的航拍视场，进入风机后收窄，增强速度感和主体尺度。
    const perspective = camera as THREE.PerspectiveCamera
    perspective.fov = THREE.MathUtils.lerp(62, 47, progress)
    perspective.updateProjectionMatrix()
    void el
  })

  return null
}
