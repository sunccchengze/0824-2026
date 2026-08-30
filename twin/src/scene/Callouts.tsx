import { Html } from '@react-three/drei'
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ANCHOR } from './terrainUtil'

// ================================================================
// 世界标注（DOM 引线标签）v2
// ----------------------------------------------------------------
//  · A6/A1 修复：文案 = 工程正确术语（英文不再沿用原图乱码）；
//    锚点由 terrainUtil 挂到被指物体（见 ANCHOR 注释）。
//  · C9 修复：按相机距离淡出 + 屏幕空间纵向避让（重叠时下沉错峰），
//    远处自动隐藏，不再"五个标签永远朝屏互压"。
// ================================================================

const ITEMS: {
  at: { x: number; y: number; z: number }
  side: 'l' | 'r'
  zh: string
  en: string
  line?: number
}[] = [
  { at: ANCHOR.power, side: 'r', zh: '全场功率总览', en: 'Farm Power Overview', line: 58 },
  { at: ANCHOR.wake, side: 'l', zh: '风能资源场', en: 'Wind Resource / Wake Field', line: 46 },
  { at: ANCHOR.turbine, side: 'r', zh: '风机 · NREL 5MW 级', en: 'Turbine (5MW-class, holographic)', line: 42 },
  { at: ANCHOR.cable, side: 'r', zh: '集电线路 · 35 kV', en: 'Array Cable Circuit', line: 40 },
  { at: ANCHOR.substation, side: 'l', zh: '升压站 · 220 kV', en: 'Step-up Substation', line: 48 },
]

const v = new THREE.Vector3()

export default function Callouts() {
  const { camera } = useThree()
  const refs = useRef<(HTMLDivElement | null)[]>([])
  const states = useRef(
    ITEMS.map(() => ({ y: 0, x: 0, dist: 0, visible: true, shift: 0, opacity: 1 })),
  )
  const wv = useRef(new THREE.Vector3())

  useFrame(() => {
    const st = states.current
    const camPos = camera.position
    for (let i = 0; i < ITEMS.length; i++) {
      const a = ITEMS[i].at
      v.set(a.x, a.y, a.z).project(camera)
      const behind = v.z > 1
      const W = window.innerWidth
      const sx = (v.x * 0.5 + 0.5) * W
      const sy = (-v.y * 0.5 + 0.5) * window.innerHeight
      const dist = camPos.distanceTo(wv.current.set(a.x, a.y, a.z))
      // HUD 左右栏像素区（1920 舞台等比映射到当前窗口）
      const stageScale = Math.min(W / 1920, window.innerHeight / 1080)
      // 面板宽 + 标签自身可向右延展约 210px，双重余量避免文字压在玻璃面板上
      const leftEdge = (16 + 330 + 14) * stageScale
      const rightEdge = W - (16 + 306 + 370) * stageScale
      st[i].x = sx
      st[i].y = sy
      st[i].dist = dist
      st[i].visible = !behind && sx > leftEdge && sx < rightEdge
    }
    // 距离淡出：1500m 起渐隐，2600m 全隐
    for (let i = 0; i < st.length; i++) {
      const fade = 1 - Math.min(1, Math.max(0, (st[i].dist - 1500) / 1100))
      st[i].opacity = st[i].visible ? fade : 0
    }
    // 纵向避让：按屏幕 y 排序，间距 < 34px 则下方元素下沉
    const order = [...st.keys()].sort((a, b) => st[a].y - st[b].y)
    let prevY = -Infinity
    let prevX = -Infinity
    for (const i of order) {
      let y = st[i].y
      if (y - prevY < 34 && Math.abs(st[i].x - prevX) < 260) y = prevY + 34
      st[i].shift = y - st[i].y
      prevY = y
      prevX = st[i].x
    }
    // 直写 DOM（不进 React 渲染，零重排成本）
    for (let i = 0; i < ITEMS.length; i++) {
      const el = refs.current[i]
      if (!el) continue
      el.style.opacity = String(st[i].opacity ?? 0)
      el.style.transform = `translateY(${st[i].shift}px)`
    }
  })

  return (
    <>
      {ITEMS.map((it, i) => (
        <Html
          key={i}
          position={[it.at.x, it.at.y, it.at.z]}
          zIndexRange={[6, 0]}
          style={{ pointerEvents: 'none' }}
          wrapperClass="wcall-wrap"
        >
          <div ref={(el) => { refs.current[i] = el }} className={`wcall ${it.side}`}>
            <i className="wdot" />
            <span className="wline" style={{ width: it.line ?? 44 }} />
            <span className="wtext">
              <b>{it.zh}</b>
              <em>{it.en}</em>
            </span>
          </div>
        </Html>
      ))}
    </>
  )
}
