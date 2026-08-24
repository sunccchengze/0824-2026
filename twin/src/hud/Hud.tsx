import { useMemo, type ReactNode } from 'react'
import { P_BASE, proxyPower, useSim, YAW_OPT } from '../state/simStore'

function Panel({ title, en, children, tag }: { title: string; en?: string; tag?: string; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <i className="diamond" />
        <span>{title}</span>
        {tag && <span className="tag">{tag}</span>}
        {en && <span className="en">{en}</span>}
      </div>
      {children}
    </section>
  )
}

function Donut({ pct, label }: { pct: number; label: string }) {
  const r = 21, c = 2 * Math.PI * r
  return (
    <div className="donut">
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(61,90,116,.35)" strokeWidth="5" />
        <circle
          cx="28" cy="28" r={r} fill="none" stroke="var(--cyan)" strokeWidth="5"
          strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="round"
          transform="rotate(-90 28 28)" style={{ filter: 'drop-shadow(0 0 4px rgba(95,214,255,.7))' }}
        />
        <text x="28" y="32" textAnchor="middle" fill="var(--cyan-hi)" fontSize="12">
          {pct % 1 === 0 ? pct : pct.toFixed(1)}%
        </text>
      </svg>
      <div className="lb">{label}</div>
    </div>
  )
}

function Radar() {
  const spokes = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const vals = [0.95, 0.55, 0.7, 0.4, 0.62, 0.85, 1.0, 0.5]
  const cx = 62, cy = 56, R = 42
  const pts = vals.map((v, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v] as const
  })
  return (
    <div className="radar-box">
      <svg width="124" height="112" viewBox="0 0 124 112">
        {[0.33, 0.66, 1].map((f) => <circle key={f} cx={cx} cy={cy} r={R * f} fill="none" stroke="rgba(95,214,255,.16)" />)}
        {spokes.map((_, i) => {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2
          return <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(a) * R} y2={cy + Math.sin(a) * R} stroke="rgba(95,214,255,.14)" />
        })}
        <polygon points={pts.map((p) => p.join(',')).join(' ')} fill="rgba(95,214,255,.22)" stroke="var(--cyan)" strokeWidth="1" />
        {spokes.map((s, i) => {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2
          return <text key={s} x={cx + Math.cos(a) * (R + 9)} y={cy + Math.sin(a) * (R + 9) + 3} fontSize="7" fill="var(--dim)" textAnchor="middle">{s}</text>
        })}
      </svg>
    </div>
  )
}

// 日内功率曲线【模拟】：基线 vs 阵列优化（+24.04%），种子固定可复现
function PowerChart() {
  const d = useMemo(() => {
    let a = 42
    const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const N = 97, W = 250, H = 96, ML = 30, MR = 6, MT = 8, MB = 14
    const xs = (i: number) => ML + (i / (N - 1)) * (W - ML - MR)
    const ys = (v: number) => MT + (1 - v / 12500) * (H - MT - MB)
    const base: number[] = [], opt: number[] = []
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) * 24
      const w = 0.88 + 0.13 * Math.sin(((t - 8.5) / 24) * Math.PI * 2) + 0.05 * Math.sin(t * 1.31 + 1.2) + (rnd() - 0.5) * 0.055
      const b = P_BASE * w + (rnd() - 0.5) * 150
      base.push(b)
      opt.push(Math.min(12400, b * 1.2404 + 55 * Math.sin(t * 2.1)))
    }
    const toLine = (arr: number[]) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ')
    const area = `${toLine(opt)} L${xs(N - 1).toFixed(1)},${ys(0).toFixed(1)} L${xs(0).toFixed(1)},${ys(0).toFixed(1)} Z`
    return { W, H, ML, MR, MT, MB, base, opt, toLine, area, xs, ys }
  }, [])

  return (
    <div className="chart">
      <div className="legend">
        <span className="k act" />Actual 实发
        <span className="k fc" />Forecast 预测
        <span className="tag" style={{ marginLeft: 'auto' }}>模拟</span>
      </div>
      <svg width="100%" height="96" viewBox={`0 0 ${d.W} ${d.H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="pgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(95,214,255,.38)" />
            <stop offset="1" stopColor="rgba(95,214,255,.02)" />
          </linearGradient>
        </defs>
        {[0, 3000, 6000, 9000, 12000].map((v) => (
          <g key={v}>
            <line x1={d.ML} x2={d.W - d.MR} y1={d.ys(v)} y2={d.ys(v)} stroke="rgba(95,214,255,.10)" strokeWidth="0.6" />
            <text x={d.ML - 3} y={d.ys(v) + 2.6} fontSize="7" fill="var(--dim)" textAnchor="end">{v === 0 ? '0' : `${v / 1000}k`}</text>
          </g>
        ))}
        {[0, 8, 12, 16, 20, 24].map((h) => (
          <text key={h} x={d.ML + (h / 24) * (d.W - d.ML - d.MR)} y={d.H - 4} fontSize="7" fill="var(--dim)" textAnchor="middle">{h === 0 ? '0' : `${h}:00`}</text>
        ))}
        <path d={d.area} fill="url(#pgrad)" />
        <path d={d.toLine(d.opt)} fill="none" stroke="var(--cyan)" strokeWidth="1.4" style={{ filter: 'drop-shadow(0 0 3px rgba(95,214,255,.8))' }} />
        <path d={d.toLine(d.base)} fill="none" stroke="rgba(169,236,255,.55)" strokeWidth="0.9" strokeDasharray="3 2" />
      </svg>
    </div>
  )
}

const ROW_NAMES = ['第一排', '第二排', '第三排']

export default function Hud() {
  const yawRows = useSim((s) => s.yawRows)
  const setYawRow = useSim((s) => s.setYawRow)
  const playing = useSim((s) => s.playing)
  const togglePlay = useSim((s) => s.togglePlay)
  const p = proxyPower(yawRows)
  const gain = (p / P_BASE - 1) * 100

  return (
    <div className="hud">
      <header className="topbar">
        <svg className="deco l" viewBox="0 0 132 20"><path d="M0 18 L30 18 L44 4 L74 4 L86 14 L132 14" fill="none" stroke="rgba(95,214,255,.55)" strokeWidth="1.2" /></svg>
        <svg className="deco r" viewBox="0 0 132 20"><path d="M0 18 L30 18 L44 4 L74 4 L86 14 L132 14" fill="none" stroke="rgba(95,214,255,.55)" strokeWidth="1.2" /></svg>
        <div className="meta l">XJTU · 大创 · 风电流场感知与智能调控</div>
        <div className="title">风电流场智能感知与调控 · <b>数字孪生系统</b></div>
        <div className="sub">AEOLUS&nbsp;DIGITAL&nbsp;TWIN</div>
        <div className="meta r num">2026-08-24&nbsp;&nbsp;夜航模式</div>
      </header>

      <div className="hud-col hud-left">
        <Panel title="全场功率总览" en="TOTAL POWER" tag="FLORIS 模拟">
          <div className="kpi-xl num glow">{p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span className="kpi-unit">kW</span></div>
          <div className="cell-sub">基准 {P_BASE.toLocaleString('en-US')} kW · 逐排贪心 [{YAW_OPT.join(', ')}]°</div>
        </Panel>
        <Panel title="风况 / 增益" en="CONDITION">
          <div className="row2">
            <div><div className="cell-label">风速</div><div className="kpi-lg num glow">8.0<span className="kpi-unit">m/s</span></div><div className="cell-sub">轮毂高度【模拟】</div></div>
            <div><div className="cell-label">阵列增益</div><div className="kpi-lg num glow">+{gain.toFixed(2)}<span className="kpi-unit">%</span></div><div className="cell-sub">vs 自然迎风 8,095.15</div></div>
          </div>
        </Panel>
        <Panel title="机组在线" en="ONLINE">
          <div className="kpi-lg num glow">9 / 9<span className="kpi-unit">台 · NREL 5MW 级</span></div>
        </Panel>
        <Panel title="电网功率（NPI）" en="GRID" tag="离线评测">
          <div className="donuts">
            <Donut pct={97.97} label="POD 重构" />
            <Donut pct={99.48} label="PPO 跟踪" />
            <Donut pct={76.38} label="模态能量 M0" />
          </div>
        </Panel>
        <Panel title="电机塔状态" en="MATRIX">
          <div className="matrix">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="m"><i className="dot" style={{ animationDelay: `${i * 0.22}s` }} /></div>)}</div>
        </Panel>
        <Panel title="实时功率" en="REAL-TIME POWER">
          <PowerChart />
        </Panel>
      </div>

      <div className="hud-col hud-right">
        <Panel title="风况雷达" en="WIND ROSE" tag="示意">
          <Radar />
        </Panel>
        <Panel title="偏航角度" en="YAW CONTROL" tag="联动演示">
          {ROW_NAMES.map((n, i) => (
            <div className="srow" key={n}>
              <span className="lb">{n}</span>
              <input
                type="range" value={yawRows[i]} min={-30} max={30} step={1}
                onChange={(e) => setYawRow(i, Number(e.target.value))}
              />
              <span className="val num">{yawRows[i] > 0 ? `+${yawRows[i]}` : yawRows[i]}°</span>
            </div>
          ))}
          <div className="srow">
            <span className="lb">目标功率</span>
            <input type="range" defaultValue={80} min={0} max={100} disabled />
            <span className="val num">8.0MW</span>
          </div>
          <div className="cell-sub" style={{ marginTop: 6 }}>偏离钦定点实时重估（抛物代理·【模拟】）</div>
        </Panel>
        <Panel title="报警通知" en="ALARMS" tag="演示">
          <div className="alist">
            <div className="it red"><i className="d" /><span>过热预警<span className="s"><br />T04 主轴承温度越限</span></span><span className="t">23 分钟前</span></div>
            <div className="it cyan"><i className="d" /><span>风速突波提示<span className="s"><br />阵风 11.6 m/s，已顺桨</span></span><span className="t">22 分钟前</span></div>
            <div className="it red"><i className="d" /><span>过热预警<span className="s"><br />T07 变桨电机温度</span></span><span className="t">23 分钟前</span></div>
            <div className="it red"><i className="d" /><span>振动预警<span className="s"><br />T02 塔架一阶振幅偏高</span></span><span className="t">23 分钟前</span></div>
            <div className="it cyan"><i className="d" /><span>通信抖动<span className="s"><br />T02 遥测丢包 0.8%</span></span><span className="t">22 分钟前</span></div>
          </div>
        </Panel>
      </div>

      <footer className={`timeline ${playing ? '' : 'paused'}`}>
        <span className="play" onClick={togglePlay}>{playing ? '❚❚' : '▶'}</span>
        <span className="clock num">10:00</span>
        <div className="bar"><i className="fill" /><i className="head" /></div>
        <span className="tail num">00:50 · 巡航 · 全屏</span>
      </footer>
    </div>
  )
}
