import { Html } from '@react-three/drei'
import { ANCHOR } from './terrainUtil'

// W11 引线标注：世界锚点 + DOM 引线标签（基准图 L 形肘节引线）
// 文案 = 项目真值（docs/03），【】为诚信角标
const ITEMS: { at: { x: number; y: number; z: number }; side: 'l' | 'r'; zh: string; en: string }[] = [
  { at: ANCHOR.power, side: 'l', zh: '全场功率 10,041.46 kW【FLORIS 模拟】', en: 'TOTAL ARRAY POWER' },
  { at: ANCHOR.wake, side: 'r', zh: '尾流场重构 97.97%【离线评测】', en: 'WAKE FIELD · POD-ROM' },
  { at: ANCHOR.turbine, side: 'l', zh: '机组 3×3 · NREL 5MW 级【模拟】', en: 'TURBINE MATRIX' },
  { at: ANCHOR.cable, side: 'l', zh: '集电电缆走廊 9 回', en: 'COLLECTOR CABLES' },
  { at: ANCHOR.substation, side: 'l', zh: '110kV 升压站 · 并网外送【示意】', en: 'SUBSTATION & GRID' },
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
          wrapperClass="callout-wrap"
        >
          <div className={`callout ${it.side}`}>
            <i className="cdot" />
            <span className="cline" />
            <span className="ctext">
              <b>{it.zh}</b>
              <em>{it.en}</em>
            </span>
          </div>
        </Html>
      ))}
    </>
  )
}
