import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getTelemetry, useSim } from '../state/simStore'

// ================================================================
// 未来能源数字孪生系统 —— 大屏 HUD（原图 1920×1080 像素级还原）
// 布局：顶部标题通栏 / 左列 6 面板 / 右列 3 面板 / 底部时间轴
// ================================================================

const SIZE = { w: 1920, h: 1080 }

function useStageScale() {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const onR = () => setScale(Math.min(window.innerWidth / SIZE.w, window.innerHeight / SIZE.h))
    onR()
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])
  return scale
}

/* ---------- 通用面板 ---------- */
function Panel({ title, en, children, tall }: { title: string; en?: string; children: ReactNode; tall?: boolean }) {
  return (
    <section className={`panel${tall ? ' tall' : ''}`}>
      <i className="c tl" /><i className="c tr" /><i className="c bl" /><i className="c br" />
      <i className="notch" />
      <header className="ptitle">
        <i className="sicon" />
        <span className="zh">{title}</span>
        {en && <span className="en">{en}</span>}
      </header>
      <div className="pbody">{children}</div>
    </section>
  )
}

/* ---------- 三环（电网功率 NPI） ---------- */
function NpiDonut({ pct, label }: { pct: number; label: string }) {
  const r = 24, c = 2 * Math.PI * r
  return (
    <div className="donut">
      <svg width="74" height="74" viewBox="0 0 74 74">
        <circle cx="37" cy="37" r={r} fill="rgba(8,26,40,.6)" stroke="rgba(70,130,170,.4)" strokeWidth="6" />
        <circle
          cx="37" cy="37" r={r} fill="none" stroke="url(#ndGrad)" strokeWidth="6"
          strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="butt"
          transform="rotate(-90 37 37)" className="ring-glow"
        />
        <text x="37" y="42" textAnchor="middle" className="donut-num">{pct}%</text>
      </svg>
      <div className="dl">{label}</div>
    </div>
  )
}

/* ---------- 机组状态矩阵 3×3 ---------- */
function Matrix() {
  const matrix = useSim((s) => s.matrix)
  const cells = matrix.map((on, i) => (
    <div key={i} className={`m${on ? ' on' : ' off'}`}>
      <i className={`dot${i % 4 === 1 ? ' amber' : ''}`} style={{ animationDelay: `${(i % 6) * 0.35}s` }} />
    </div>
  ))
  return <div className="matrix">{cells}</div>
}

/* ---------- 风况雷达（360° 花瓣 + 扫描线） ---------- */
const RADAR_DIRS = [
  { t: 'NW', a: -135 }, { t: 'N', a: -90 }, { t: 'NE', a: -45 },
  { t: 'E', a: 0 }, { t: 'SE', a: 45 }, { t: 'S', a: 90 },
  { t: 'SW', a: 135 }, { t: 'W', a: 180 },
]
const PETALS = [0.95, 0.5, 0.78, 0.86, 0.62, 0.9, 0.55, 0.72]
// 右侧竖排刻度（原图 1.8/0.6/0.2）
const RINGS = [18, 12, 6]

function Radar() {
  const C = 130, R = 92
  // 花瓣：从内半径沿方向延伸至外缘的径向椭圆（长轴对齐方位角）
  const petals = PETALS.map((v, i) => {
    const a = (RADAR_DIRS[i].a * Math.PI) / 180
    const len = R * 0.88 * v
    const inner = R * 0.16
    const mid = (inner + len) / 2
    const rx = (len - inner) / 2 + 6
    const x = C + Math.cos(a) * mid, y = C + Math.sin(a) * mid
    return <ellipse key={i} cx={x} cy={y} rx={rx} ry={12} fill="rgba(96,220,255,.5)" transform={`rotate(${RADAR_DIRS[i].a} ${x} ${y})`} className="petal" />
  })
  return (
    <div className="radar">
      <svg width="260" height="260" viewBox="0 0 260 260">
        <defs>
          <radialGradient id="radarBg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(20,70,110,.55)" />
            <stop offset="78%" stopColor="rgba(8,30,50,.4)" />
            <stop offset="100%" stopColor="rgba(4,16,28,0)" />
          </radialGradient>
        </defs>
        <circle cx={C} cy={C} r={R + 14} fill="url(#radarBg)" stroke="rgba(110,215,255,.35)" strokeWidth="1" />
        <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(110,215,255,.5)" strokeWidth="1.4" />
        {[0.25, 0.5, 0.75].map((f) => (
          <circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke="rgba(110,215,255,.20)" strokeWidth="0.8" />
        ))}
        {RADAR_DIRS.map((d) => {
          const a = (d.a * Math.PI) / 180
          return (
            <line key={d.t} x1={C} y1={C}
              x2={C + Math.cos(a) * R} y2={C + Math.sin(a) * R}
              stroke="rgba(110,215,255,.16)" strokeWidth="0.7" />
          )
        })}
        {petals}
        {/* 外圈刻度 */}
        {Array.from({ length: 72 }).map((_, i) => {
          const a = (i * 5 * Math.PI) / 180
          const r1 = R + (i % 6 === 0 ? 8 : 4)
          return <line key={i} x1={C + Math.cos(a) * (R + 1)} y1={C + Math.sin(a) * (R + 1)}
            x2={C + Math.cos(a) * r1} y2={C + Math.sin(a) * r1} stroke="rgba(120,210,250,.3)" strokeWidth="0.7" />
        })}
        {RINGS.map((v, i) => (
          <text key={v} x={C + R + 22} y={C - R + 16 + i * 16}
            fontSize="8.5" fill="#6fa3c4" textAnchor="middle" className="ringlabel">
            {v.toFixed(0)}
          </text>
        ))}
        {RADAR_DIRS.map((d) => {
          const a = (d.a * Math.PI) / 180
          const rr = R + 15
          return (
            <text key={d.t} x={C + Math.cos(a) * rr} y={C + Math.sin(a) * rr + 3}
              fontSize="9" fill="#8fc6e4" textAnchor="middle" className="dirlabel">
              {d.t}
            </text>
          )
        })}
        <circle cx={C} cy={C} r={4.5} fill="#bfefff" className="petal" />
        {/* 扫描扇面 */}
        <g className="sweep"><path d={`M${C} ${C} L${C} ${C - R} A${R} ${R} 0 0 1 ${C + R * 0.71} ${C - R * 0.71} Z`} fill="rgba(120,235,255,.16)" /></g>
      </svg>
    </div>
  )
}

/* ---------- 实时功率曲线（原图双线） ---------- */
function PowerChart({ tHours }: { tHours: number }) {
  const d = useMemo(() => {
    const W = 292, H = 196, ML = 30, MR = 8, MT = 12, MB = 26
    const xs = (i: number) => ML + (i / 47) * (W - ML - MR)
    const ys = (v: number) => MT + (1 - v / 50) * (H - MT - MB)
    // 原图形态：白天双峰（08:00 后爬升，12:00 前峰值，14:00 回落，18:00 二峰），夜间低位
    const shape = (t: number) =>
      0.16 + 0.4 * Math.exp(-(((t - 9.2) / 3.2) ** 2)) + 0.52 * Math.exp(-(((t - 19.0) / 2.6) ** 2)) + 0.13 * Math.sin(t * 0.9)
    const pts: number[] = []
    const fpts: number[] = []
    for (let i = 0; i < 48; i++) {
      const t = (i / 47) * 24
      pts.push(ys(Math.max(0, shape(t) * 42 + 1 * Math.sin(i * 2.7))))
      fpts.push(ys(Math.max(0, shape(t + 0.35) * 40)))
    }
    const line = (arr: number[]) => arr.map((y, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${y.toFixed(1)}`).join(' ')
    const area = `${line(pts)} L${xs(47).toFixed(1)},${ys(0).toFixed(1)} L${xs(0).toFixed(1)},${ys(0).toFixed(1)} Z`
    const current = Math.min(47, Math.round((tHours / 24) * 47))
    return { W, H, ML, MR, MT, MB, xs, ys, line, area, pts, fpts, current }
  }, [tHours])

  return (
    <div className="chart">
      <div className="legend">
        <span className="k act" />Actual
        <span className="k fc" />Forecast
      </div>
      <svg width="100%" height={d.H} viewBox={`0 0 ${d.W} ${d.H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="pgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(90,215,255,.34)" />
            <stop offset="1" stopColor="rgba(90,215,255,.02)" />
          </linearGradient>
        </defs>
        {[0, 10, 20, 30, 40, 50].map((v) => (
          <g key={v}>
            <line x1={d.ML} x2={d.W - d.MR} y1={d.ys(v)} y2={d.ys(v)} stroke="rgba(100,175,215,.12)" strokeWidth="0.7" />
            <text x={d.ML - 4} y={d.ys(v) + 3} fontSize="8.5" fill="#5f8db0" textAnchor="end">{v}</text>
          </g>
        ))}
        {[0, 8, 12, 16, 20, 24].map((h) => (
          <text key={h} x={d.ML + (h / 24) * (d.W - d.ML - d.MR)} y={d.H - 9} fontSize="8.5" fill="#5f8db0" textAnchor="middle">{h === 0 ? '0' : `${h}:00`}</text>
        ))}
        <text x={5} y={d.MT + 26} fontSize="9" fill="#7096b4">Power (MW)</text>
        <path d={d.area} fill="url(#pgrad)" />
        <path d={d.line(d.pts)} fill="none" stroke="#66dcff" strokeWidth="1.8" className="chart-glow" />
        <path d={d.line(d.fpts)} fill="none" stroke="rgba(190,235,255,.5)" strokeWidth="1.1" strokeDasharray="4 3" />
        <circle cx={d.xs(d.current)} cy={d.pts[d.current]} r="3.2" fill="#dff6ff" className="chart-glow" />
      </svg>
    </div>
  )
}

/* ---------- 导颈舵机滑杆 ---------- */
function ServoSlider({ i }: { i: number }) {
  const servos = useSim((s) => s.servos)
  const setServo = useSim((s) => s.setServo)
  const v = servos[i]
  return (
    <div className="srow">
      <span className="slab">偏航执行器{i + 1}</span>
      <div className="track">
        <input
          type="range" min={-30} max={30} step={1} value={v}
          onChange={(e) => setServo(i, Number(e.target.value))}
          style={{ ['--p' as string]: `${((v + 30) / 60) * 100}%` }}
        />
        <div className="trk"><i className="fill" style={{ width: `${((v + 30) / 60) * 100}%` }} /><i className="head" style={{ left: `${((v + 30) / 60) * 100}%` }} /></div>
      </div>
      <span className="sval">{v}</span>
    </div>
  )
}

/* ---------- 报警通知 ---------- */
function Alarms() {
  const alarms = useSim((s) => s.alarms)
  return (
    <div className="alist">
      {alarms.map((a) => (
        <div key={a.id} className="ait">
          <i className={`adot ${a.severity}`} />
          <div className="atext"><b>{a.turbine} · {a.zh}</b><em>{a.en}</em></div>
          <span className="atime">{a.minutes}分钟前</span>
        </div>
      ))}
    </div>
  )
}

/* ---------- 顶部标题 + 飞翼装饰 ---------- */
function Wings({ flip }: { flip?: boolean }) {
  return (
    <svg className={`wings${flip ? ' flip' : ''}`} viewBox="0 0 380 44" width="380" height="44">
      <defs>
        <linearGradient id="wg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgba(130,220,255,.9)" />
          <stop offset="1" stopColor="rgba(70,160,220,.35)" />
        </linearGradient>
      </defs>
      {/* 主折线：外低内高，向标题收拢 */}
      <g fill="none" stroke="url(#wg)" strokeWidth="1.6">
        <path d="M4 36 L104 36 L136 14 L214 14 L250 30 L376 30" />
        <path d="M14 41 L110 41 L140 21 L210 21 L244 36 L370 36" stroke="rgba(110,200,250,.35)" strokeWidth="1" />
      </g>
      {/* 垂直小刻度 */}
      {[64, 84, 130, 172, 190, 230, 262, 300, 340].map((x, i) => (
        <line key={i} x1={x} y1={i % 2 ? 36 : 16} x2={x} y2={(i % 2 ? 36 : 16) + (i % 2 ? -10 : 10)} stroke="rgba(150,225,255,.55)" strokeWidth="1" />
      ))}
      {/* 端点菱形 */}
      {[[106, 36], [138, 14], [250, 30]].map(([x, y], i) => (
        <rect key={i} x={x - 3.2} y={y - 3.2} width="6.4" height="6.4" fill="rgba(170,235,255,.95)" transform={`rotate(45 ${x} ${y})`} />
      ))}
    </svg>
  )
}

/* ---------- 顶角飞翼装饰（原图左右上角羽翼） ---------- */
function CornerWings({ flip }: { flip?: boolean }) {
  return (
    <svg className={`cwings${flip ? ' flip' : ''}`} viewBox="0 0 340 64" width="340" height="64">
      <defs>
        <linearGradient id="cwg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgba(160,235,255,.95)" />
          <stop offset="1" stopColor="rgba(70,150,210,.2)" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#cwg)" strokeWidth="1.8">
        <path d="M0 44 L96 44 L118 22 L196 22 L232 40 L340 40" />
        <path d="M8 52 L102 52 L126 32 L198 32 L238 48 L334 48" stroke="rgba(120,205,250,.35)" strokeWidth="1.2" />
        <path d="M16 60 L108 60 L134 42 L202 42 L244 56 L326 56" stroke="rgba(120,205,250,.2)" strokeWidth="1" />
      </g>
      {[96, 120, 232, 258, 300].map((x, i) => (
        <line key={i} x1={x} y1={i % 2 ? 30 : 46} x2={x} y2={(i % 2 ? 30 : 46) + (i % 2 ? 10 : -8)} stroke="rgba(160,230,255,.6)" strokeWidth="1.2" />
      ))}
      {[[104, 44], [200, 32]].map(([x, y], i) => (
        <rect key={i} x={x - 3} y={y - 3} width="6" height="6" fill="rgba(180,240,255,.95)" transform={`rotate(45 ${x} ${y})`} />
      ))}
    </svg>
  )
}

/* ---------- 主组件 ---------- */
export default function Hud() {
  const scale = useStageScale()
  const playing = useSim((s) => s.playing)
  const togglePlay = useSim((s) => s.togglePlay)
  const setTime = useSim((s) => s.setTime)
  const tHours = useSim((s) => s.tHours)
  const servos = useSim((s) => s.servos)
  const telemetry = getTelemetry(tHours, servos)
  const setAlarms = useSim((s) => s.setAlarms)

  // 时钟动画（rAF 驱动 store）
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const s = useSim.getState()
      if (s.playing) {
        useSim.setState({ tHours: (s.tHours + dt * (24 / (50 * 60))) % 24 })
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // 报警计时
  useEffect(() => {
    const iv = setInterval(() => {
      const s = useSim.getState()
      if (s.playing) {
        s.setAlarms(s.alarms.map((a) => ({ ...a, minutes: a.minutes >= 59 ? 1 : a.minutes + 1 })))
      }
    }, 30000)
    return () => clearInterval(iv)
  }, [setAlarms])

  const hh = String(Math.floor(tHours)).padStart(2, '0')
  const mm = String(Math.floor((tHours % 1) * 60)).padStart(2, '0')

  return (
    <div className="hud">
      <div className="stage" style={{ width: SIZE.w, height: SIZE.h, transform: `scale(${scale})` }}>
        {/* ===== 顶部 ===== */}
        <header className="topbar">
          <div className="cornorn l" /><div className="cornorn r" />
          <CornerWings />
          <CornerWings flip />
          <Wings />
          <Wings flip />
          <h1 className="title">未来能源数字孪生系统</h1>
          <div className="tline" />
        </header>

        {/* ===== 左列 ===== */}
        <div className="col left">
          <Panel title="全场实时功率" en="(MW)">
            <div className="kpi-xl">{telemetry.totalPower.toFixed(1)}</div>
          </Panel>

          <div className="row2">
            <Panel title="电网频率" en="(Hz)">
              <div className="kpi-md">{telemetry.frequency.toFixed(2)}</div>
            </Panel>
            <Panel title="无功功率" en="(MVar)">
              <div className="kpi-md">{telemetry.reactivePower.toFixed(1)}</div>
            </Panel>
          </div>

          <Panel title="运行机组数">
            <div className="kpi-row"><span className="kpi-xl sm">{telemetry.runningUnits}</span><span className="unit">台</span></div>
          </Panel>

          <Panel title="电网功率" en="(NPI)" tall>
            <div className="donuts">
              <NpiDonut pct={telemetry.npi[0]} label="瞬时功率" />
              <NpiDonut pct={telemetry.npi[1]} label="成功率" />
              <NpiDonut pct={telemetry.npi[2]} label="传输效率" />
            </div>
          </Panel>

          <Panel title="机组状态矩阵" en="Matrix" tall>
            <Matrix />
          </Panel>

          <Panel title="实时功率" en="Real-time Power" tall>
            <PowerChart tHours={tHours} />
          </Panel>
        </div>

        {/* ===== 右列 ===== */}
        <div className="col right">
          <Panel title="风况雷达" en="" tall>
            <Radar />
          </Panel>

          <Panel title="偏航角度" en="(deg)" tall>
            <div className="servos">
              {[0, 1, 2, 3, 4].map((i) => <ServoSlider key={i} i={i} />)}
            </div>
          </Panel>

          <Panel title="报警通知" tall>
            <Alarms />
          </Panel>
        </div>

        {/* ===== 底部时间轴 ===== */}
        <footer className="timeline">
          <button className="play" onClick={togglePlay} aria-label="play">
            {playing ? <i className="pause" /> : <i className="tri" />}
          </button>
          <span className="clock">{hh}:{mm}</span>
          <div className="tlbar">
            <i className="tlfill" style={{ width: `${(tHours / 24) * 100}%` }} />
            <i className="tlhead" style={{ left: `${(tHours / 24) * 100}%` }} />
            <input className="timeline-input" type="range" min="0" max="24" step="0.01" value={tHours}
              onChange={(e) => { setTime(Number(e.target.value)); if (playing) togglePlay() }} aria-label="时间轴" />
            {[...Array(24)].map((_, i) => <i key={i} className="tick" style={{ left: `${(i / 24) * 100}%` }} />)}
          </div>
          <span className="tail">00:50</span>
          <svg className="vol" viewBox="0 0 20 16" width="16" height="13">
            <path d="M1 6 h4 l5 -4 v12 l-5 -4 H1 Z" fill="rgba(170,225,255,.75)" />
            <path d="M12 5 q3 3 0 6" fill="none" stroke="rgba(170,225,255,.75)" strokeWidth="1.4" />
            <path d="M14.5 3.5 q5 4.5 0 9" fill="none" stroke="rgba(170,225,255,.5)" strokeWidth="1.4" />
          </svg>
        </footer>

        {/* 真实几何已统一全息化；保留原图右下角的演示数据标识，不再显示模式切换。 */}
        <div className="demo-note">演示数据 DEMO</div>
      </div>
    </div>
  )
}
