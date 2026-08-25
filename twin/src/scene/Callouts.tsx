import { Html } from '@react-three/drei'
import { ANCHOR } from './terrainUtil'

// ================================================================
// 世界标注（原图逐字）：DOM 引线标签 —— 像素级字体渲染
// 文案 = 用户原图原文（像素级还原口径）
// ================================================================
const ITEMS: {
  at: { x: number; y: number; z: number }
  side: 'l' | 'r'
  zh: string
  en: string
  line?: number
}[] = [
  { at: ANCHOR.power, side: 'r', zh: '全场功率总览', en: 'Total Powely Pool', line: 58 },
  { at: ANCHOR.wake, side: 'l', zh: '风况渔能场', en: 'Wind speed', line: 46 },
  { at: ANCHOR.turbine, side: 'r', zh: '风机分组', en: 'Enghinowr wind Loulide', line: 42 },
  { at: ANCHOR.cable, side: 'r', zh: '电缆落地', en: 'Electrical Raw for cpNact or cables', line: 40 },
  { at: ANCHOR.substation, side: 'l', zh: '连线站座', en: 'Substation Row', line: 48 },
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

      {/* 底部近景机组：虚线圈选 + 微型读数（原图 0.95,xx） */}
      <Html position={[ANCHOR.dot.x, ANCHOR.dot.y, ANCHOR.dot.z]} zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }} wrapperClass="wcall-wrap">
        <div className="wcall l">
          <i className="wdot" />
          <span className="wline" style={{ width: 26 }} />
          <span className="wtext">
            <b style={{ fontSize: 9, fontWeight: 500 }}>0.95,xx</b>
          </span>
        </div>
      </Html>
      {/* 圈选虚线环 */}

      <mesh position={[ANCHOR.dot.x, ANCHOR.dot.y, ANCHOR.dot.z]} rotation={[0, 0, 0]}>
        <torusGeometry args={[30, 0.45, 6, 72]} />
        <meshBasicMaterial color="#5fc8f0" transparent opacity={0.3} depthWrite={false} />
      </mesh>
    </>
  )
}
