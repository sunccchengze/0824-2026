import { Html } from '@react-three/drei'
import { ANCHOR } from './terrainUtil'

// ================================================================
// 世界标注（DOM 引线标签）
// 文案 = 订正后的工程真值（A1/A6：不再抄写原图乱码、不再使用
// 「Total Power Pool / Cable Landing」等误用术语）；
// 锚点 = 真实结构物/流场位置（terrainUtil.ANCHOR，全部贴附对象不悬空）。
// ================================================================
const ITEMS: {
  at: { x: number; y: number; z: number }
  side: 'l' | 'r'
  zh: string
  en: string
  line?: number
}[] = [
  { at: ANCHOR.power,      side: 'r', zh: '全场功率总览', en: 'Farm Total Power',   line: 58 },
  { at: ANCHOR.wake,       side: 'l', zh: '风能资源场',   en: 'Wind Resource',      line: 46 },
  { at: ANCHOR.turbine,    side: 'r', zh: '风机',         en: 'NREL 5MW Turbine',   line: 42 },
  { at: ANCHOR.cable,      side: 'r', zh: '集电线路',     en: 'Collector Cables',   line: 40 },
  { at: ANCHOR.substation, side: 'l', zh: '升压站',       en: 'Substation 220kV',   line: 48 },
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
