# 第 25 轮·修复：开场运镜“还不太丝滑 / 最后跳帧” + 功率曲线消失 + 整体功率下降

日期：2026-08-30 · 分支 `arena/01a0529f-0824-2026`
用户反馈（按优先级）：
1. 开场运镜整体还是不流畅、不丝滑，**最后有一个跳帧**，前面速度也不太顺；
2. 左下角（原来那个组件）**实时功率曲线不见了**；
3. **整体功率感觉下降了好多**。

---

## ① 左下角实时功率曲线消失 —— 纯 CSS 塌陷

- **组件没被删**：`PowerChart()` 仍在 `Hud.tsx`（第 201 行定义，第 543 行放入“实时功率”面板）。
- **根因**：`.pchart .pbody > svg` 只匹配“pbody 直接子元素”的 svg；但 `PowerChart` 的 `<svg>` 包在 `.chart` div 里，`.chart` 没有高度 → 内部 `height="100%"` 的 svg 高度为 0 → 曲线整块消失。
- **修复**（`theme.css`）：补 `.pchart .pbody .chart { flex:1; min-height:100px; }` 与 `.pchart .pbody .chart svg { flex:1; height:100%; min-height:100px; }`。
- **证据**：`shots/r25-fix-default-load.png`（正常加载）与 `shots/r25-fix-hero-t6.png`（t=6 hero）左下角均能看到 Actual / 对风基准 γ=0 / Forecast +2h 三条曲线。

## ② 整体功率“下降” —— 不是回退，是默认时刻落在日内低谷 + 开场期间时间乱跑

- 诊断：`farmFrame` 纯函数逐时刻输出：t=0 **16.95MW** / t=4 **18.55MW** / t=6 **13.96MW** / t=8 **8.06MW** / t=10 **5.63MW** / t=12 **2.97MW** / t=18 **3.34MW**。
- 旧默认 `tHours=10` 在日内风速低谷（~5.6MW）。且**开场 34~43s ≈ 大半天**，`startSimClock` 一启动就推进 `tHours`，用户看开场的过程中 HUD 从高功率飞快滑到低谷，开场一结束就“看到功率低了”——这就是“整体功率下降”的真观感。
- **修复**：
  1. `simStore` 默认时刻 `tHours: 10 → 6`（日出后高功率段 ~14MW，与《日间氛围_参考基线》06:12 帧一致）；
  2. `startSimClock` 在 `!s.introDone` 时**不推进仿真时间**：开场运镜期间 HUD 稳定展示高功率；开场结束（或用户跳过）后恢复播放（真实 50s=24h）。
- **修复后**正常加载首屏：`14.0MW · 06:00 · 运行 9 台 · 实时功率曲线完整`（`r25-fix-default-load.png`）。

## ③ 开场运镜丝滑：速度剖面收敛 + 收尾 coast 跳帧根除

### 3.1 前段“速度不太顺” → 速度剖面收敛
- **旧剖面**：`BOOST_TABLE` 13 段（0.55→1.50，峰谷 4.19×，~2.6s 一次方向反转），且曲率调制下限 0.65 → 速度在 107~450 m/s 之间猛烈跳变，34s 里眼睛明显感到“一阵快一阵慢/顿挫”。
- **新剖面**（`introProfile.ts`）：
  - 曲率调制下限 `0.65 → 0.78`（过弯最多降 22%，不再“一顿一顿”）；
  - `BOOST_TABLE` 收敛为 **11 个控制点、区间 0.78~1.22**，峰值从 1.50 降到 1.22，变速次数 13→9（平均 3.8s 一次）。
- **实测**：峰谷比 **4.19× → 2.01×**；min 107.4→147.6、max 450.4→295.9 m/s；出口速度 107.4→147.6 m/s（更接近收尾环绕接管角速度 0.80 rad/s）。整段速度更加柔和平滑，但仍保留“直道快、弯道缓”的节奏。
- 证据：`node --experimental-strip-types twin/scripts/introStats.mts`（新表数值如上）。

### 3.2 “最后有一个跳帧” → 收尾→coast 的时钟/初速问题
- **根因**：上一轮把 coast 的 `tc` 用 `state.clock.elapsedTime - co.t0clk`；而 `co.t0clk` 记录为 `introClock.current`，coast 每帧又同时推进 `introClock`，导致 `tc` 首帧就不是 0，且创建 coast 的环绕帧之后相机位置与 coast 初速不匹配 → 交接瞬时出现大位移（QA 冻结下甚至 `[-29944,4181,...]` 的“飞出世界”伪影）。
- **修复**（`CameraRig.tsx`）：
  1. coast 使用**独立 clock**：`co.t0clk` 初始为 0，每帧 `+= min(max(delta,.001),.1)`，首帧 `tc≈0.1s`、`off≈0.3*0.28≈0.085` → 位移极小，连续；
  2. coast 初速限幅：`v = clamp(vTrack, 1, vExit*1.15)`（上限 ~160m/s），杜绝首帧携带轨道外的超大速度；
  3. QA `?introT=` 冻结时不触发 coast（停在环绕终点复现帧），避免冻结路径反复重建 coast 造成假跳帧。
- **修复后**（`?introT=43/44`）相机稳定在 `[-728.8,66,-203.9]` 不再“飞出世界”；真实播放 coast 全程位置连续指数衰减，无瞬时跳位。

## ④ 验证链

- `npm run build` ✓（1.8s）
- `npm run lint` ✓ 0 warnings / 0 errors
- `npm run selftest` ✓ 34/34
- screenshot：`r25-fix-default-load.png` / `r25-fix-hero-t6.png`（左下角曲线 + 14MW + 06:00）
- QA 冻结边界：41/42/42.5/42.95/43/44 → 相机 `[-798,-756,-740,-733,-729→-728.8]` 连续收敛，无跳变。

## ⑤ 补充：镜头不抖动、不跳帧、速度平滑（用户 08-30 第三次反馈）

在已推送的 `2d90a57` 上再进步三层：

### 5.1 速度曲线二次平滑（introProfile.ts）
- 在“缩放回 34s”之后，对最终 `v[]` 再做 **31 样本盒式平滑**（`SW=16`），再按新积分时长重缩放回 34s。
- 效果：boost 表 smoothstep C1 连续仍存在的“加速-匀速-加速”轻微台阶被抹平，整条速度曲线变成 C1~C2 连续。
- 指标：变速方向反转 `13 → 7` 次（平均 4.9s 一次），峰谷比保持 `2.00×`，min/max `147.7/295.6 m/s`，出口 `147.7 m/s`（与环绕 0.80 rad/s 匹配）。
- 60fps 数学采样：**最大帧位移 5.01m**（≈speed/60），无任何帧间突跃。

### 5.2 相机“目标 + 指数平滑跟随”（CameraRig.tsx）
- **不再每帧硬设** `position/lookAt/rotateZ`（掉帧或加速相交点会“顿/跳”），改为每帧只计算目标机位/朝向，然后：
  - 位置 `smPos.lerp(targetPos, α)`；
  - 朝向 `smLook.lerp(targetLook, α)` → `_eLook.lookAt` → `quaternion.slerp`；
  - fov / bank 也指数缓动。
- `α = 1 - exp(-dt / CAM_SMOOTH_TAU)`，`τ=0.09s`：60fps 跟得极紧（α≈0.17/帧，无拖影），掉帧时把单帧大位移分摊到后续几帧，观感始终连续。
- 涉及巡航段、收尾环绕段**和 coast 段（5.3）**同口径。

### 5.3 coast 同口径平滑
- coast 由旧 `camera.position.copy(p) + lookAt(tg)` 改为一并走 `smPos/smLook` 的平滑跟随（与巡航/环绕一致）。
- 数学模拟（60fps）：coast 首帧位移 1.79m，之后 0.34→0.19→0.11→… 单调收敛，无阶跃。
- 收尾→coast 交接处即使目标差异数百米，平滑跟随首帧只走 α 比例（~17%），后续帧收敛，不会“跳”。

### 5.4 验证
- `npm run build` ✓ / `npm run lint` 0/0 / `npm run selftest` 34/34。
- `shots/r25-smooth-intro8s.png`：intro 8s 渲染正常，速度剖面新表推进无误。
- 数学验证：60fps 帧位移连续、无跳变。

## ⑥ 仍待真机
- 开场“丝滑”体感、bank 观感、coast/WASD 惯性仍需用户在真机 GPU 确认（软渲染无法代表 60fps）。
- 生产 `?introT / ?cam / ?t` 仍只由 `debugEnabled()` 门控，普通访问不触发。
