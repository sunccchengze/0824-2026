import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSim } from '../state/simStore'
import {
  dailyCurve, integrateDay, makeAlarms, simulate, FARM_RATED_MW,
  type AlarmItem, type FarmSnap,
} from '../state/simCore'
import { SERVOS } from '../scene/terrainUtil'

// ================================================================
// 风电流场智能感知与调控 · 数字孪生大屏 HUD
// 所有数值由 simCore 单一数据契约驱动（确定性演示数据，非 SCADA/FLORIS）：
//   时间轴 → 风速/功率/频率/曲线联动；偏航滑杆 → 3D 姿态 + 功率 + 告警；
//   AUTO → 目标功率实时解算 9 机偏航角（申请书研究内容③演示口径）。
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

/* ---------- 三环（运行指标） ---------- */
function KpiDonut({ pct, label }: { pct: number; label: string }) {
  const r = 24, c = 2 * Math.PI * r
  const v = Math.min(100, Math.max(0, pct))
  return (
    <div className="donut">
      <svg width="74" height="74" viewBox="0 0 74 74">
        <defs>
          <linearGradient id="ndGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#a9ecff" />
            <stop offset="1" stopColor="#3fb8ee" />
          </linearGradient>
        </defs>
        <circle cx="37" cy="37" r={r} fill="rgba(8,26,40,.6)" stroke="rgba(70,130,170,.4)" strokeWidth="6" />
        <circle
          cx="37" cy="37" r={r} fill="none" stroke="url(#ndGrad)" strokeWidth="6"
          strokeDasharray={`${(v / 100) * c} ${c}`} strokeLinecap="butt"
          transform="rotate(-90 37 37)" className="ring-glow"
        />
        <text x="37" y="42" textAnchor="middle" className="donut-num">{Math.round(v)}%</text>
      </svg>
      <div className="dl">{label}</div>
    </div>
  )
}

/* ---------- 机组状态矩阵 3×3 ---------- */
function Matrix({ snap, alarms }: { snap: FarmSnap; alarms: AlarmItem[] }) {
  const warn = useMemo(() => {
    const s = new Set<string>()
    for (const a of alarms) if (a.level === 'warn' && a.tid) s.add(a.tid)
    return s
  }, [alarms])
  return (
    <div className="matrix">
      {snap.units.map((u, i) => {
        const on = u.status === 'run'
        const bad = warn.has(u.id)
        return (
          <div key={u.id} className={`m${on ? ' on' : ' off'}`} title={`${u.id} · ${on ? '运行' : u.status === 'idle' ? '待机' : '大风切出'} · ${u.powerMW.toFixed(2)} MW · ${u.wind.toFixed(1)} m/s`}>
            <i className={`dot${bad ? ' bad' : ''}`} style={{ animationDelay: `${(i % 6) * 0.35}s` }} />
            <span className="mid">{u.id}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- 风况雷达（8 方位玫瑰 + 实时风速） ---------- */
const RADAR_DIRS = [
  { t: 'NW', a: -135 }, { t: 'N', a: -90 }, { t: 'NE', a: -45 },
  { t: 'E', a: 0 }, { t: 'SE', a: 45 }, { t: 'S', a: 90 },
  { t: 'SW', a: 135 }, { t: 'W', a: 180 },
]
// 年风向频率分布（演示口径）：主导风向 S（= 场景粒子流 南→北 的来向，语义自洽）
const PETALS = [0.35, 0.45, 0.30, 0.55, 0.62, 1.0, 0.72, 0.5]
const RINGS_MS = [9, 6, 3] // m/s

function Radar({ wind }: { wind: number }) {
  const C = 130, R = 92
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
        {Array.from({ length: 72 }).map((_, i) => {
          const a = (i * 5 * Math.PI) / 180
          const r1 = R + (i % 6 === 0 ? 8 : 4)
          return <line key={i} x1={C + Math.cos(a) * (R + 1)} y1={C + Math.sin(a) * (R + 1)}
            x2={C + Math.cos(a) * r1} y2={C + Math.sin(a) * r1} stroke="rgba(120,210,250,.3)" strokeWidth="0.7" />
        })}
        {RINGS_MS.map((v, i) => (
          <text key={v} x={C + R + 18} y={C - R + 16 + i * 16}
            fontSize="8.5" fill="#6fa3c4" textAnchor="middle" className="ringlabel">
            {v}
          </text>
        ))}
        <text x={C + R + 18} y={C - R + 16 + 3 * 16} fontSize="7.5" fill="#4d7592" textAnchor="middle">m/s</text>
        {RADAR_DIRS.map((d) => {
          const a = (d.a * Math.PI) / 180
          const rr = R + 15
          return (
            <text key={d.t} x={C + Math.cos(a) * rr} y={C + Math.sin(a) * rr + 3}
              fontSize="9" fill={d.t === 'S' ? '#cdf4ff' : '#8fc6e4'} textAnchor="middle" className="dirlabel">
              {d.t}
            </text>
          )
        })}
        <text x={C} y={C + 2} textAnchor="middle" className="rwind-v">{wind.toFixed(1)}</text>
        <text x={C} y={C + 30} textAnchor="middle" className="rwind-l">实时风速 m/s</text>
        <text x={C} y={C + 46} textAnchor="middle" className="rwind-l dim">主导风向 S（演示数据）</text>
        {/* 扫描扇面 */}
        <g className="sweep"><path d={`M${C} ${C} L${C} ${C - R} A${R} ${R} 0 0 1 ${C + R * 0.71} ${C - R * 0.71} Z`} fill="rgba(120,235,255,.16)" /></g>
      </svg>
    </div>
  )
}

/* ---------- 实时功率曲线（Actual=当前策略 / Baseline=零偏航基准 + now 标线） ---------- */
function PowerChart({ curve, nowTH }: { curve: { actual: number[]; baseline: number[] }; nowTH: number }) {
  const W = 292, H = 196, ML = 30, MR = 8, MT = 12, MB = 26
  const xs = (i: number) => ML + (i / 47) * (W - ML - MR)
  const ys = (v: number) => MT + (1 - Math.min(50, Math.max(0, v)) / 50) * (H - MT - MB)
  const line = (arr: number[]) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ')
  const area = `${line(curve.actual)} L${xs(47).toFixed(1)},${ys(0).toFixed(1)} L${xs(0).toFixed(1)},${ys(0).toFixed(1)} Z`
  const nowX = ML + (nowTH / 24) * (W - ML - MR)
  const nowIdx = Math.min(47, Math.max(0, Math.round((nowTH / 24) * 47)))
  const nowY = ys(curve.actual[nowIdx])

  return (
    <div className="chart">
      <div className="legend">
        <span className="k act" />当前策略
        <span className="k fc" />零偏航基准
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="pgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(90,215,255,.34)" />
            <stop offset="1" stopColor="rgba(90,215,255,.02)" />
          </linearGradient>
        </defs>
        {[0, 10, 20, 30, 40, 50].map((v) => (
          <g key={v}>
            <line x1={ML} x2={W - MR} y1={ys(v)} y2={ys(v)} stroke="rgba(100,175,215,.12)" strokeWidth="0.7" />
            <text x={ML - 4} y={ys(v) + 3} fontSize="8.5" fill="#5f8db0" textAnchor="end">{v}</text>
          </g>
        ))}
        {[0, 8, 12, 16, 20, 24].map((h) => (
          <text key={h} x={ML + (h / 24) * (W - ML - MR)} y={H - 9} fontSize="8.5" fill="#5f8db0" textAnchor="middle">{h === 0 ? '0' : `${h}:00`}</text>
        ))}
        <text x={5} y={MT + 26} fontSize="9" fill="#7096b4">Power (MW)</text>
        <path d={area} fill="url(#pgrad)" />
        <path d={line(curve.actual)} fill="none" stroke="#66dcff" strokeWidth="1.8" className="chart-glow" />
        <path d={line(curve.baseline)} fill="none" stroke="rgba(190,235,255,.5)" strokeWidth="1.1" strokeDasharray="4 3" />
        <line x1={nowX} x2={nowX} y1={MT} y2={H - MB} stroke="rgba(150,225,255,.35)" strokeWidth="0.8" strokeDasharray="2 3" />
        <circle cx={nowX} cy={nowY} r="3.2" fill="#dff6ff" className="chart-glow" />
      </svg>
    </div>
  )
}

/* ---------- 偏航执行器滑杆 ---------- */
function ServoSlider({ i, snap, auto }: { i: number; snap: FarmSnap; auto: boolean }) {
  const servos = useSim((s) => s.servos)
  const setServo = useSim((s) => s.setServo)
  const v = auto ? snap.yaws[SERVOS[i]] : servos[i]
  const shown = Math.round(v * 10) / 10
  return (
    <div className={`srow${auto ? ' auto' : ''}`}>
      <span className="slab">偏航执行器{i + 1}</span>
      <div className="track">
        <input
          type="range" min={-30} max={30} step={1} value={auto ? 0 : servos[i]}
          disabled={auto}
          aria-label={`偏航执行器 ${i + 1}`}
          onChange={(e) => setServo(i, Number(e.target.value))}
        />
        <div className="trk"><i className="fill" style={{ width: `${((v + 30) / 60) * 100}%` }} /><i className="head" style={{ left: `${((v + 30) / 60) * 100}%` }} /></div>
      </div>
      <span className="sval">{shown}</span>
    </div>
  )
}

/* ---------- 报警通知（可确认） ---------- */
function Alarms({ alarms }: { alarms: AlarmItem[] }) {
  const [acked, setAcked] = useState<Set<string>>(new Set())
  return (
    <div className="alist">
      {alarms.map((a) => {
        const key = `${a.zh}-${a.minutes}`
        const isAck = acked.has(key)
        return (
          <div
            key={`${a.id}-${a.zh}`}
            className={`ait${isAck ? ' acked' : ''}`}
            title={isAck ? '已确认' : '点击确认该通知'}
            onClick={() => setAcked((prev) => new Set(prev).add(key))}
          >
            <i className={`adot ${a.level === 'warn' ? 'red' : 'cyan'}`} />
            <div className="atext"><b>{a.zh}</b><em>{a.en}</em></div>
            <span className="atime">{a.minutes}分钟前</span>
          </div>
        )
      })}
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
      <g fill="none" stroke="url(#wg)" strokeWidth="1.6">
        <path d="M4 36 L104 36 L136 14 L214 14 L250 30 L376 30" />
        <path d="M14 41 L110 41 L140 21 L210 21 L244 36 L370 36" stroke="rgba(110,200,250,.35)" strokeWidth="1" />
      </g>
      {[64, 84, 130, 172, 190, 230, 262, 300, 340].map((x, i) => (
        <line key={i} x1={x} y1={i % 2 ? 36 : 16} x2={x} y2={(i % 2 ? 36 : 16) + (i % 2 ? -10 : 10)} stroke="rgba(150,225,255,.55)" strokeWidth="1" />
      ))}
      {[[106, 36], [138, 14], [250, 30]].map(([x, y], i) => (
        <rect key={i} x={x - 3.2} y={y - 3.2} width="6.4" height="6.4" fill="rgba(170,235,255,.95)" transform={`rotate(45 ${x} ${y})`} />
      ))}
    </svg>
  )
}

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
  const introActive = useSim((s) => s.introActive)
  const auto = useSim((s) => s.auto)
  const setAuto = useSim((s) => s.setAuto)
  const targetMW = useSim((s) => s.targetMW)
  const setTargetMW = useSim((s) => s.setTargetMW)
  const servos = useSim((s) => s.servos)

  // 时钟动画（rAF 驱动 store；subscribing 组件按粗粒度刻重渲染）
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

  // 粗粒度订阅：仿真快照 0.05h（游戏 3 分钟≈真实 6s）重算；时钟 1 游戏分钟刷新
  const tHC = useSim((s) => Math.floor((s.tHours * 20) % 480) / 20)
  const tMinutes = useSim((s) => Math.floor((s.tHours % 1) * 60))
  const tHHour = useSim((s) => Math.floor(s.tHours) % 24)

  const snap = useMemo(() => simulate(servos, auto, targetMW, tHC), [servos, auto, targetMW, tHC])
  const alarms = useMemo(() => makeAlarms(snap, servos), [snap, servos])
  const curve = useMemo(() => dailyCurve(servos, auto, targetMW), [servos, auto, targetMW])
  const todayMWh = integrateDay(curve.actual, tHC)
  const yearMWh = integrateDay(curve.actual, 24) * 365

  const hh = String(tHHour).padStart(2, '0')
  const mm = String(Math.floor(tMinutes)).padStart(2, '0')

  return (
    <div className="hud">
      <div className="stage" style={{ width: SIZE.w, height: SIZE.h, transform: `translate(-50%,-50%) scale(${scale})` }}>
        {/* ===== 顶部 ===== */}
        <header className="topbar">
          <div className="cornorn l" /><div className="cornorn r" />
          <CornerWings />
          <CornerWings flip />
          <Wings />
          <Wings flip />
          <h1 className="title">风电流场智能感知与调控 · 数字孪生系统</h1>
          <div className="tline" />
        </header>

        {/* ===== 左列 ===== */}
        <div className="col left">
          <Panel title="全场功率总览" en="(MW) · DEMO">
            <div className="kpi-xl">{snap.totalMW.toFixed(2)}</div>
            <div className="subkpi">
              <span>今日累计 {todayMWh.toFixed(0)} MWh</span>
              <span>年估算 {Math.round(yearMWh).toLocaleString('en-US')} MWh</span>
            </div>
          </Panel>

          <div className="row2">
            <Panel title="电网频率" en="(Hz)">
              <div className="kpi-md">{snap.freqHz.toFixed(2)}</div>
            </Panel>
            <Panel title="无功功率" en="(MVar)">
              <div className="kpi-md">{snap.qMVar.toFixed(1)}</div>
            </Panel>
          </div>

          <Panel title="运行机组数">
            <div className="kpi-row"><span className="kpi-xl sm">{snap.online}</span><span className="unit">/ 9 台</span></div>
          </Panel>

          <Panel title="运行指标" en="Fleet KPI" tall>
            <div className="donuts">
              <KpiDonut pct={snap.capFactorPct} label="容量利用率" />
              <KpiDonut pct={snap.wakeLossPct} label="尾流损失" />
              <KpiDonut pct={snap.cpMean * 100} label="风能利用系数" />
            </div>
          </Panel>

          <Panel title="机组状态矩阵" en="Matrix" tall>
            <Matrix snap={snap} alarms={alarms} />
          </Panel>

          <Panel title="实时功率" en="Real-time Power" tall>
            <PowerChart curve={curve} nowTH={snap.tH} />
          </Panel>
        </div>

        {/* ===== 右列 ===== */}
        <div className="col right">
          <Panel title="风况雷达" en="Wind Rose · DEMO" tall>
            <Radar wind={snap.windBase} />
          </Panel>

          <Panel title="偏航角度" en="(deg)" tall>
            <div className="servos">
              {[0, 1, 2, 3, 4].map((i) => <ServoSlider key={i} i={i} snap={snap} auto={auto} />)}
            </div>
            <div className="target-zone">
              <div className="trow">
                <span className="slab">目标功率</span>
                <div className="track">
                  <input
                    type="range" min={0} max={FARM_RATED_MW} step={0.5} value={targetMW}
                    aria-label="目标功率（兆瓦）"
                    onChange={(e) => setTargetMW(Number(e.target.value))}
                  />
                  <div className="trk"><i className="fill" style={{ width: `${(targetMW / FARM_RATED_MW) * 100}%` }} /><i className="head" style={{ left: `${(targetMW / FARM_RATED_MW) * 100}%` }} /></div>
                </div>
                <span className="sval">{targetMW.toFixed(1)}</span>
              </div>
              <div className="auto-line">
                <button
                  className={`auto-btn${auto ? ' on' : ''}`}
                  onClick={() => setAuto(!auto)}
                  title="偏航自优：输入需求功率，系统实时解算并下发各机偏航角（演示代理，非 FLORIS/PPO）"
                >
                  {auto ? '偏航自优 · 接管中' : '偏航自优 · 已关闭'}
                </button>
                {auto && (
                  <span className="track-note">
                    实发 {snap.totalMW.toFixed(1)} MW · 偏差 {snap.trackErrMW >= 0 ? '+' : ''}{snap.trackErrMW.toFixed(1)}
                  </span>
                )}
                {!auto && (
                  <span className="track-note dim">
                    手动模式 · 限发指令 {targetMW.toFixed(1)} MW · 尾流损失 {snap.wakeLossPct.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          </Panel>

          <Panel title="报警通知" en="Alarms" tall>
            <Alarms alarms={alarms} />
          </Panel>
        </div>

        {/* ===== 底部时间轴 ===== */}
        <footer className="timeline">
          <button className="play" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>
            {playing ? <i className="pause" /> : <i className="tri" />}
          </button>
          <span className="clock">{hh}:{mm}</span>
          <div className="tlbar">
            <i className="tlfill" style={{ width: `${(snap.tH / 24) * 100}%` }} />
            <i className="tlhead" style={{ left: `${(snap.tH / 24) * 100}%` }} />
            {[...Array(24)].map((_, i) => <i key={i} className="tick" style={{ left: `${(i / 24) * 100}%` }} />)}
          </div>
          <span className="tl-demo" title="所有数值来自浏览器端确定性演示代理（simCore），非真实 SCADA / FLORIS 求解">
            演示数据 DEMO · 浏览器代理
          </span>
          <span className="tail" title="时间轴比例：50 分钟 = 一昼夜">50min/天</span>
          <button
            className="replay"
            onClick={() => window.dispatchEvent(new Event('aeolus:replay'))}
            title="回放开场巡航"
          >↻ 回放开场</button>
        </footer>

        {/* 开场巡航中的跳过提示 */}
        {introActive && (
          <div className="skip-hint">开场巡航中 · 点击画面任意处跳过</div>
        )}
      </div>
    </div>
  )
}
