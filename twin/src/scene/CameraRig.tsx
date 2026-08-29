/* oxlint-disable react/immutability -- 帧循环内 mutate refs/camera 为 R3F 控制标准模式（docs/08 D2） */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM } from './terrainUtil'
import { useSim } from '../state/simStore'

// ============================================================================
// 开场巡航 + 机位书签 + 跳过（C5 修复）
// ----------------------------------------------------------------------------
//  · 34s 运镜保留（对位原宣传片），但：Esc/空格外的任意点击、"跳过"按钮、
//    键盘 'Y'、或 URL ?intro=0 均可立即结束进入自由轨道；
//  · 书签机位（Phase 4 最小集）：键 1/2/3 = 全景 / 近排 / 升压站；
//    平滑过渡 1.2s（缓入缓出），期间冻结巡航。
//  · ?cam=方位角,俯仰角,距离[,tx,ty,tz] 调试机位仅在 DEV 或 ?debug=1 生效
//    （D10 修复：生产路径不再暴露内部开关）。
// ============================================================================

const CAM_BOOKMARKS = [
  { pos: new THREE.Vector3(60, 430, 990), target: new THREE.Vector3(0, 22, -340) },
  { pos: new THREE.Vector3(FARM[6].x + 170, 150, FARM[6].z + 250), target: new THREE.Vector3(FARM[6].x, 74, FARM[6].z) },
  { pos: new THREE.Vector3(-340, 250, 760), target: new THREE.Vector3(300, 20, 300) },
] as const

const CAMERA_NODES = [
  new THREE.Vector3(-100, 1720, -640), // 正上空起始点
  new THREE.Vector3(-100, 720, -640), // 竖直俯冲
  new THREE.Vector3(-100, 300, -640), // 俯冲最低点
  new THREE.Vector3(-100, 300, -520), // 低位后退
  new THREE.Vector3(-100, 330, -200), // 微抬继续后退
  new THREE.Vector3(-100, 390, 250), // 抬头进入远景
  new THREE.Vector3(60, 480, 990), // 全景构图
  new THREE.Vector3(120, 470, 900), // 全景缓行
  new THREE.Vector3(FARM[2].x + 145, 210, FARM[2].z - 160), // 快速前推至 T03
  new THREE.Vector3(FARM[2].x + 160, 220, FARM[2].z - 110), // T03 处转头
  new THREE.Vector3(FARM[4].x + 100, 130, FARM[4].z + 105), // 沿对角线穿 T05
  new THREE.Vector3(FARM[6].x + 145, 86, FARM[6].z + 120), // 接近 T07
  new THREE.Vector3(FARM[6].x + 76, 56, FARM[6].z + 168), // T07 前低机位终点
]
const DIVE_TARGET = new THREE.Vector3(-100, 0, -690)
const LOOK_NODES = [
  DIVE_TARGET.clone(), DIVE_TARGET.clone(), DIVE_TARGET.clone(),
  new THREE.Vector3(-100, 15, -670),
  new THREE.Vector3(-100, 70, -650),
  new THREE.Vector3(-100, 110, -640),
  new THREE.Vector3(-100, 120, -640),
  new THREE.Vector3(-100, 120, -640),
  new THREE.Vector3(FARM[2].x, 96, FARM[2].z),
  new THREE.Vector3(FARM[4].x, 96, FARM[4].z),
  new THREE.Vector3(FARM[6].x, 98, FARM[6].z),
  new THREE.Vector3(FARM[6].x, 96, FARM[6].z),
  new THREE.Vector3(FARM[6].x, 92, FARM[6].z),
]

const CAMERA_PATH = new THREE.CatmullRomCurve3(CAMERA_NODES, false, 'centripetal', 0.38)
const LOOK_PATH = new THREE.CatmullRomCurve3(LOOK_NODES, false, 'centripetal', 0.38)
const INTRO_END = 34

const ease = (t: number) => t * t * (3 - 2 * t)

const DEBUG_ALLOWED = (typeof import.meta !== 'undefined' && import.meta.env?.DEV === true)
  || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug'))

const DEBUG_CAM = (() => {
  if (!DEBUG_ALLOWED || typeof location === 'undefined') return null
  const q = new URLSearchParams(location.search).get('cam')
  if (!q) return null
  const v = q.split(',').map(Number)
  if (v.length < 3 || v.slice(0, 3).some((x) => !Number.isFinite(x))) return null
  return {
    az: v[0], el: v[1], dist: v[2],
    target: new THREE.Vector3(v[3] ?? 0, v[4] ?? 22, v[5] ?? -340),
  }
})()

const NO_INTRO = typeof location !== 'undefined'
  && (new URLSearchParams(location.search).has('intro0') || (DEBUG_ALLOWED && new URLSearchParams(location.search).get('intro') === '0'))

export default function CameraRig() {
  const controlsRef = useRef<any>(null)
  const { camera } = useThree()
  const introStart = useRef<number | null>(null)
  const bookmark = useRef<{ from: THREE.Vector3; fromT: THREE.Vector3; to: THREE.Vector3; toT: THREE.Vector3; t0: number } | null>(null)

  // 全局快捷键：Esc 跳过 / 1-3 书签
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useSim.getState()
      if (e.key === 'Escape' || e.key === ' ' || e.key.toLowerCase() === 'y') {
        if (!s.introDone) s.skipIntro()
      }
      const n = Number(e.key)
      if (n >= 1 && n <= CAM_BOOKMARKS.length) {
        const b = CAM_BOOKMARKS[n - 1]
        const p = camera.position.clone()
        const ctl = controlsRef.current
        bookmark.current = {
          from: p, fromT: ctl ? ctl.target.clone() : new THREE.Vector3(0, 22, -340),
          to: b.pos.clone(), toT: b.target.clone(), t0: performance.now(),
        }
        useSim.getState().skipIntro()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera])

  useFrame((state) => {
    if (!controlsRef.current) controlsRef.current = (state.controls as any) || null

    if (DEBUG_CAM) {
      const a = THREE.MathUtils.degToRad(DEBUG_CAM.az)
      const e = THREE.MathUtils.degToRad(DEBUG_CAM.el)
      const { dist, target } = DEBUG_CAM
      camera.position.set(
        target.x + dist * Math.cos(e) * Math.sin(a),
        target.y + dist * Math.sin(e),
        target.z + dist * Math.cos(e) * Math.cos(a),
      )
      camera.lookAt(target)
      const ctl0 = (state.controls as any) || controlsRef.current
      if (ctl0) { ctl0.target.copy(target); ctl0.update() }
      const p0 = camera as THREE.PerspectiveCamera
      p0.fov = 47
      p0.updateProjectionMatrix()
      if (!useSim.getState().introDone) useSim.getState().skipIntro()
      return
    }

    // 书签过渡
    const bm = bookmark.current
    if (bm) {
      const k = Math.min(1, (performance.now() - bm.t0) / 1200)
      const s = ease(k)
      camera.position.lerpVectors(bm.from, bm.to, s)
      const tg = bm.fromT.clone().lerp(bm.toT, s)
      camera.lookAt(tg)
      const ctl = controlsRef.current
      if (ctl) { ctl.target.copy(tg); ctl.update() }
      if (k >= 1) bookmark.current = null
      return
    }

    const s = useSim.getState()
    if (NO_INTRO && !s.introDone) {
      s.skipIntro()
      return
    }
    if (s.introDone) return

    const t0 = state.clock.elapsedTime
    if (introStart.current === null) introStart.current = 0
    const progress = ease(Math.min(1, (t0 - introStart.current) / INTRO_END))
    const p = CAMERA_PATH.getPoint(progress)
    const tg = LOOK_PATH.getPoint(progress)
    camera.position.copy(p)
    camera.lookAt(tg)
    const ctl = controlsRef.current
    if (ctl) {
      ctl.target.copy(tg)
      ctl.update()
    }
    const perspective = camera as THREE.PerspectiveCamera
    perspective.fov = THREE.MathUtils.lerp(54, 47, progress)
    perspective.updateProjectionMatrix()
    if (progress >= 1 && !useSim.getState().introDone) useSim.getState().skipIntro()
  })

  return null
}
