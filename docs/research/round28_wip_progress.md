# 第 28 轮 · 3A 画面提升（白天投影 B1 / 夜晚生机 B2）

> 真值源 + 交付记录。接手前先读这里。
> 分支：`arena/01a0584c-0824-2026`（本会话）
> 用户需求（截图对照）：① 白天任何角度都能看到风机在地面上的**明显**投影；② 夜晚太冷清死寂，要有"生机/活跃"。

## B1 · 白天投影 —— ✅ 已完成（本会话）

### 结论（为什么之前一直"看不到"）
两次根因，都实测定位（非猜）：

1. **真实 shadow-map 管线不可靠**（前任已确认）：地面是自定义 shader + 强补光 + 深色
   albedo，测试柱无影。故改走**确定性"接地影带"**（无 shadow-map 依赖）。
2. **普通 alpha 叠加"近黑片"在本场景对比度趋零**：地面 albedo 本身很暗，再叠近黑
   贴片 → 前后帧差几乎为 0（v1 全帧截图不可见的直接原因，A/B 帧差实测证实）。

**正解 = 乘法混合（MultiplyBlending）相对压暗**：`result = dst·(1−a)`，影带与地面
明度解耦——近处暗地、远处雾亮地、亮棱面，对比一致且纹理/雾色自然保留，无"黑补丁"。

### ⚠ 关键坑（three r185，必须记住）
`MultiplyBlending` **要求 `material.premultipliedAlpha = true`**，否则
`WebGLState.setBlending` 走 `error()` 分支 → **静默回退到上一次混合状态（普通叠加）**，
不抛异常、不报 lint，肉眼/帧差都难发现。曾因此白调一整轮 A/B。
（证据链见下；修复后帧差 P10 压暗 44%→实测核心 92%。）

### 实现（`twin/src/scene/GroundShadows.tsx`，独立组件，9 机共享两份几何）
- 方向 = 太阳水平方位反方向（`skyState.sunDir`，与 LightRig 同口径）。
- 长度 = `150 / tan(仰角)`，钳 [150, 280]m（正午短、晨昏长；下限 150 为观感裁决）。
- 形状 = 塔影窄条 + 轮毂处风轮弥散光斑 + 3 道叶影细线（随各机 rpm 慢转）。
- **贴地 = 逐顶点采样 `terrainSurfaceY`**（地形静态，每帧 ~1.2k 次纯数学调用）→
  影带严格贴起伏走，杜绝 v1"悬浮三角块"。`depthTest:false` 仅作掠射角保险。
- 可见性只由 `dayF` 驱动 → 全天清晰、入夜淡出（`dayF<0.012` 整组隐藏）。
- 顶点 4 分量颜色（USE_COLOR_ALPHA）做沿程/横向柔边；关雾（强度与距离无关）。
- 成本：+18 draw call（9 影带 + 9 叶影扇），无后期成本，CPU 可忽略。

### 验证证据（`docs/research/shots/r28-shadow-*`）
| 帧 | 机位 | 结论 |
|---|---|---|
| `r28-shadow-off-noon-wide` | 正午 广角 | 修前：地面**无**投影（v1 黑片不可见）|
| `r28-shadow-on-noon-wide` | 正午 广角 | 修后：每台风机向太阳反方向投出**清晰**影带 |
| `r28-shadow-on-noon-close` | 正午 近景 | 塔基深、向远处渐隐，贴起伏 |
| `r28-shadow-on-morning` | 07:00  | 晨影**长**且明显（物理正确：低仰角长影）|
| `r28-shadow-on-dusk` | 17:00 | 暮影长、暖调，明显 |
| `r28-shadow-night-off` | 22:00 | 夜晚 `dayF=0` 影带**关闭**（探针确认）|

探针（`?debug=1` → `window.__aeolus_shadows()`）：
- 正午 `t=12`：`dayF=1, L=150, stripOpacity=0.72, rootVisible=true`
- 夜晚 `t=22`：`dayF=0, rootVisible=false, alpha=0`

### 复现/自检
```bash
cd twin
npm run build && npm run lint && npm run selftest   # 全绿
npm run dev -- --host 0.0.0.0
# 截图（无头）：
node scripts/shot.mjs "http://127.0.0.1:5174/?debug=1&t=12&intro=0&cam=15,8,760,0,22,-340" out.png 9000
node scripts/shot.mjs "http://127.0.0.1:5174/?debug=1&t=12&intro=0&cam=15,8,760,0,22,-340&shoff=1" out_off.png 9000
# A/B 帧差（PIL/numpy 已装）：对比 on/off 亮度比
```
调试开关：`?shoff=1` 强制关影带（仅 debug 生效，A/B 用）；`?t=<h>` 锁时钟。

## B2 · 夜晚生机 —— ✅ 已完成（2026-09-01，本会话）
用户：夜晚"冷清死寂、无变化"，要"生机/活跃"。四项克制改动（全部**夜间加权**，白天零影响，
守住"不霓虹/线稿红线"；红色语义仍只留给告警）：
1. **航空障碍灯夜间慢闪**（HoloTurbine）：夜间 beacon 转 2.4s 周期慢脉冲，
   9 机相位错开依次亮过全场；白天保持原克制微闪（fast 曲线原样）。
2. **极光呼吸**（SkyAurora）：极光带整体 `×(0.86+0.14·sin(t·0.11))`（~57s 周期 ±14%）。
3. **地面波前呼吸**（WorldTerrain）：夜间 `uGlow` 叠加 ~27s 周期呼吸（夜间 0.08↔0.125），
   白天 uGlow 曲线一字未动。
4. **夜间风痕微光**（WindVeil）：新增 `uBrite` uniform，夜间 +40% 粒子亮度且 ~16s 慢呼吸；
   白天恒 1.0。
证据：`docs/research/shots/r29-b2-{night-close,night-wide,day-close}.png`
—— 夜晚信标/风痕/极光可见、白天基线无变化（含 B1 影带）；build ✓ / lint 0-0 / selftest 34-34。

## 进度日志
- 2026-08-31：接手 01a0529f 未提交 WIP（`GroundShadows.tsx` v1 未提交、崩溃在"正午影不可见"）。
  定位两次根因（shadow-map 不可靠 + 近黑片对比度趋零）→ 改 MultiplyBlending + 逐顶点贴地，
  修复 r185 `premultipliedAlpha` 静默回退坑 → B1 完成，5 帧证据 + 探针验证，build/lint/selftest 全绿。
- 下一步：B2 夜晚生机。
- 2026-09-01（本会话 `arena/01a0584c`）：B1 已在 `349777e` 提交并推送（即本会话分支；
  用户链接的 01a0529f 分支上无此提交，故观感"未完成"）。本环境复验 B1 全绿 + 正午 A/B 截图确认。
  B2 四项夜间生机完成并截图验证（r29-b2-*）。

## Round 29 · 全量 BUG 审查（2026-09-01，本会话）
round27 已过一遍（见 round27_bug_audit_two_pass.md），本轮聚焦新代码（异常系统/GroundShadows/
开场丝滑系列）+ 交互回归。发现并修复 5 处：

1. **PerfGovernor"开场后 4s 冻结"是死代码**（功能 bug）：`introEndAt` 只在冻结分支内赋值，
   而分支进入条件又依赖 `introEndAt` 已有值（鸡生蛋）→ 开场一结束画质自适应立即可翻档，
   4s 缓冲从未生效。修复：introDone 首帧惰性记录结束时刻。
2. **异常剧本跨午夜被丢弃**（违背"当日必现"契约）：触发时刻 wrap 到 0~6 点（从当前起
   24h 内）的剧本，午夜换日时被无条件换新 → 当天异常跳过、首现可能拖到 24h+。
   修复：stepAnomaly 换日分支沿用"未触发且触发时刻仍在未来"的旧剧本；
   新增 selftest 断言 ×4（38/38）。
3. **书签键 1/2/3 缺输入焦点/keyup 重复保护**：焦点在滑杆/输入控件上按数字会触发机位跳变，
   按住不放会反复重启过渡（WASD 处理有保护、书签没有）。修复：同口径 guard + e.repeat。
4. **MetricDonut 重复 SVG id**：三个环共用 `id="ndGrad"` → 同一 DOM 3 个重复 id
   （无效 HTML；改一个渐变会连带另外两个）。修复：useId 每环独立。
5. **偏航量程不一致**：store 钳 ±40 vs 滑杆/寻优 ±30（死余量；一旦有路径写 >30 会出现
   "滑杆顶死 30 而 store 存 34.5"的显示/指令分歧）。修复：统一 ±30；
   顺带 telemetry.applyPatch 的 `length === 9` 改 N_UNITS。

运行时回归（无头实测）：
- 异常全链路：跨午夜沿用 → 02:00 到点触发 → 横幅（T07 掉线/8 机/14.4MW）→
  10s 自动修复/手动修复 → 7 步弹窗 → 机组恢复（r29-anomaly-{banner,modal}.png）；
- qa2 闭环：限功率 12MW derate 0.596/8 机限功率；寻优 +931 kW/+36.9%（wake 53.6→36.4%）；
- probe：无控制台错误。
- build ✓ / lint 0-0 / selftest 38/38。

### 已知取舍（记录，不改）
- 时间轴只支持点击 seek，不支持拖拽（可后续加 pointer capture）；
- WASD 自由飞行无水平距离上限（maxDistance 只管 OrbitControls 球距）；
- farmSim 缓存帧被 farmFrame 就地写 status/tempC——key 含全部输入，写值幂等（round27 已审，维持结论）。
