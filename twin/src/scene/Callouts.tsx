import { Html } from '@react-three/drei'
import { ANCHOR } from './terrainUtil'

// ================================================================
// 世界标注（DOM 引线标签）
// 文案 = 用户原图原文（像素级还原口径）
// 每个锚点按语义放置，标签与设备保持可读间距。
// ================================================================
const ITEMS: {
  at: { x: number; y: number; z: number }
  side: 'l' | 'r'
  zh: string
  en: string
  line?: number
}[] = [
  { at: ANCHOR.power,      side: 'r', zh: '全场功率总览', en: 'Total Power Pool',        line: 58 },
  { at: ANCHOR.wake,       side: 'l', zh: '风能资源场',   en: 'Wind speed',               line: 46 },
  { at: ANCHOR.turbine,    side: 'r', zh: '风机',     en: 'Turbine Group',            line: 42 },
  { at: ANCHOR.cable,      side: 'r', zh: '集电线路',     en: 'Electrical Cable Landing', line: 40 },
  { at: ANCHOR.substation, side: 'l', zh: '升压站',     en: 'Substation',               line: 48 },
]

export default function Callouts() {
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
          <div className={`wcall ${it.side}`}>
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
