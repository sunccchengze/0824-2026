import type { ReactNode } from 'react'

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
        <text x="28" y="32" textAnchor="middle" fill="var(--cyan-hi)" fontSize="12" fontFamily="var(--font-num)">
          {pct % 1 === 0 ? pct : pct.toFixed(1)}%
        </text>
      </svg>
      <div className="lb">{label}</div>
    </div>
  )
}

function Radar() {
  // 风玫瑰占位（裁决 D5：默认 OFF 真数据，先示意）
  const spokes = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const vals = [0.95, 0.55, 0.7, 0.4, 0.62, 0.85, 1.0, 0.5]
  const cx = 60, cy = 56, R = 44
  const pts = vals.map((v, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v] as const
  })
  return (
    <div className="radar-box">
      <svg width="120" height="112" viewBox="0 0 120 112">
        {[0.33, 0.66, 1].map((f) => <circle key={f} cx={cx} cy={cy} r={R * f} fill="none" stroke="rgba(95,214,255,.16)" />)}
        {spokes.map((_, i) => {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2
          return <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(a) * R} y2={cy + Math.sin(a) * R} stroke="rgba(95,214,255,.14)" />
        })}
        <polygon points={pts.map((p) => p.join(',')).join(' ')} fill="rgba(95,214,255,.22)" stroke="var(--cyan)" strokeWidth="1" />
        {spokes.map((s, i) => {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2
          return <text key={s} x={cx + Math.cos(a) * (R + 8)} y={cy + Math.sin(a) * (R + 8) + 3} fontSize="7" fill="var(--dim)" textAnchor="middle">{s}</text>
        })}
      </svg>
    </div>
  )
}

export default function Hud() {
  return (
    <div className="hud">
      <header className="topbar">
        <svg className="deco l" viewBox="0 0 132 20"><path d="M0 18 L30 18 L44 4 L74 4 L86 14 L132 14" fill="none" stroke="rgba(95,214,255,.55)" strokeWidth="1.2" /></svg>
        <svg className="deco r" viewBox="0 0 132 20"><path d="M0 18 L30 18 L44 4 L74 4 L86 14 L132 14" fill="none" stroke="rgba(95,214,255,.55)" strokeWidth="1.2" /></svg>
        <div className="meta l">XJTU · 大创 · 风电流场感知与智能调控</div>
        <div className="title">风电场偏航优化 · <b>数字孪生系统</b></div>
        <div className="sub">AEOLUS&nbsp;DIGITAL&nbsp;TWIN</div>
        <div className="meta r num">2026-08-24&nbsp;&nbsp;夜航模式</div>
      </header>

      <div className="hud-col hud-left">
        <Panel title="全场功率总览" en="TOTAL POWER" tag="FLORIS 模拟">
          <div className="kpi-xl num glow">10,041.46<span className="kpi-unit">kW</span></div>
          <div className="cell-sub">基准 8,095.15 kW · 逐排贪心 [30, 20, 0]°</div>
        </Panel>
        <Panel title="风况 / 增益" en="CONDITION">
          <div className="row2">
            <div><div className="cell-label">风速</div><div className="kpi-lg num glow">8.0<span className="kpi-unit">m/s</span></div><div className="cell-sub">轮毂高度</div></div>
            <div><div className="cell-label">阵列增益</div><div className="kpi-lg num glow">+24.04<span className="kpi-unit">%</span></div><div className="cell-sub">vs 自然迎风</div></div>
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
        <Panel title="实时功率" en="REAL-TIME">
          <div className="chart-hold">uPlot 功率流 · PHASE 5 接入</div>
        </Panel>
      </div>

      <div className="hud-col hud-right">
        <Panel title="风况雷达" en="WIND ROSE" tag="示意">
          <Radar />
        </Panel>
        <Panel title="偏航角度" en="YAW CONTROL" tag="Phase 5 联动">
          <div className="srow"><span className="lb">第一排</span><input type="range" defaultValue={30} min={-30} max={30} disabled /><span className="val num">+30°</span></div>
          <div className="srow"><span className="lb">第二排</span><input type="range" defaultValue={20} min={-30} max={30} disabled /><span className="val num">+20°</span></div>
          <div className="srow"><span className="lb">第三排</span><input type="range" defaultValue={0} min={-30} max={30} disabled /><span className="val num">0°</span></div>
          <div className="srow"><span className="lb">目标功率</span><input type="range" defaultValue={80} min={0} max={100} disabled /><span className="val num">8.0MW</span></div>
        </Panel>
        <Panel title="报警通知" en="ALARMS" tag="演示">
          <div className="alist">
            <div className="it red"><i className="d" /><span>过热预警<span className="s"><br />T04 主轴承温度越限</span></span><span className="t">23 分钟前</span></div>
            <div className="it cyan"><i className="d" /><span>风速突波提示<span className="s"><br />阵风 11.6 m/s，已顺桨</span></span><span className="t">22 分钟前</span></div>
            <div className="it red"><i className="d" /><span>过热预警<span className="s"><br />T07 变桨电机温度</span></span><span className="t">23 分钟前</span></div>
            <div className="it cyan"><i className="d" /><span>通信抖动<span className="s"><br />T02 遥测丢包 0.8%</span></span><span className="t">22 分钟前</span></div>
          </div>
        </Panel>
      </div>

      <footer className="timeline">
        <span className="play">▶</span>
        <span className="clock num">10:00</span>
        <div className="bar"><i className="fill" /><i className="head" /></div>
        <span className="tail num">00:50 · 巡航 · 全屏</span>
      </footer>
    </div>
  )
}
