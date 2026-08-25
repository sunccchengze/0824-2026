import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM } from './terrainUtil'

// ============================================================================
// 无人机航拍开场（按指定路线设计）
//
// 1 → 正上空俯瞰整个阵列
// 2 → 保持视线向下，竖直俯冲
// 3 → 镜头上抬并向后倒退，拉到全景
// 4 → 快速前推到 9 号风机
// 5 → 在 9 号处转头，对准 1-5-9 对角线
// 6 → 沿对角线穿过 5 号，飞向 1 号并停住
//
// 关键：相机位置、观察目标、视场都只沿一条连续曲线推进。没有两段式
// smoothstep、没有中间 reset、没有节点硬切，因此速度和视线在每个动作点
// 都连续衔接。9×3 阵列在世界中对应：789 / 456 / 123。
// ============================================================================

// 阵列编号映射：FARM 的行顺序是远 → 近，所以 FARM[2]=9、FARM[4]=5、FARM[6]=1。
const ONE = FARM[6]
const FIVE = FARM[4]
const NINE = FARM[2]

// 相机节点：大跨度是快速飞行，小跨度是俯冲缓冲、全景缓行和转头动作。
const CAMERA_NODES = [
  new THREE.Vector3(-100, 1720, -640), // 正上空起始点
  new THREE.Vector3(-100, 720, -640), // 竖直俯冲
  new THREE.Vector3(-100, 300, -640), // 俯冲最低点
  new THREE.Vector3(-100, 390, 250), // 上抬、向后倒退
  new THREE.Vector3(60, 480, 990), // 全景构图
  new THREE.Vector3(120, 470, 900), // 全景缓行，不停顿但放慢
  new THREE.Vector3(NINE.x + 145, 210, NINE.z - 160), // 快速前推至 9 号
  new THREE.Vector3(NINE.x + 160, 220, NINE.z - 110), // 9 号处转头
  new THREE.Vector3(FIVE.x + 100, 130, FIVE.z + 105), // 沿 9→5→1 对角线飞行
  new THREE.Vector3(ONE.x + 145, 86, ONE.z + 120), // 接近 1 号
  new THREE.Vector3(ONE.x + 76, 56, ONE.z + 168), // 1 号前低机位终点
]

const LOOK_NODES = [
  new THREE.Vector3(-100, 0, -640), // 正上空向下看阵列中心
  new THREE.Vector3(-100, 0, -640), // 俯冲保持垂直视线
  new THREE.Vector3(-100, 0, -640),
  new THREE.Vector3(-100, 150, -640), // 镜头上抬
  new THREE.Vector3(-100, 120, -640), // 全景看向场区
  new THREE.Vector3(-100, 120, -640),
  new THREE.Vector3(NINE.x, 96, NINE.z), // 锁定 9 号
  new THREE.Vector3(FIVE.x, 96, FIVE.z), // 转头朝 9→5→1 对角线
  new THREE.Vector3(ONE.x, 98, ONE.z), // 穿过 5 号飞向 1 号
  new THREE.Vector3(ONE.x, 96, ONE.z),
  new THREE.Vector3(ONE.x, 92, ONE.z), // 低机位轻微仰视
]

const CAMERA_PATH = new THREE.CatmullRomCurve3(CAMERA_NODES, false, 'centripetal', 0.38)
const LOOK_PATH = new THREE.CatmullRomCurve3(LOOK_NODES, false, 'centripetal', 0.38)
const START = 0
const INTRO_END = 34

// 整体只做一次缓入缓出；中途不重新 ease，避免镜头断裂。
const ease = (t: number) => t * t * (3 - 2 * t)

export default function CameraRig() {
  const controlsRef = useRef<any>(null)
  const { camera } = useThree()
  const finished = useRef(false)

  useFrame((state) => {
    if (finished.current) return

    const t0 = state.clock.elapsedTime
    if (t0 > INTRO_END) {
      finished.current = true
      return
    }

    if (!controlsRef.current) {
      controlsRef.current = (state.controls as any) || null
    }

    const progress = ease(Math.min(1, Math.max(0, (t0 - START) / INTRO_END)))
    const p = CAMERA_PATH.getPoint(progress)
    const tg = LOOK_PATH.getPoint(progress)

    camera.position.copy(p)
    camera.lookAt(tg)
    const ctl = controlsRef.current
    if (ctl) {
      ctl.target.copy(tg)
      ctl.update()
    }

    // 只保留真实无人机视线，不再人为侧倾，保证动作帅但不花哨。
    camera.lookAt(tg)
    const perspective = camera as THREE.PerspectiveCamera
    perspective.fov = THREE.MathUtils.lerp(54, 47, progress)
    perspective.updateProjectionMatrix()
  })

  return null
}
