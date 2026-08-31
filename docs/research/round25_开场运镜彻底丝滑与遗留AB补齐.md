# 第 25 轮：开场运镜彻底丝滑（首秒卡顿根除）+ 遗留 A/B 补齐

日期：2026-08-30 · 分支 `arena/01a0529f-0824-2026`
用户指令（首条最高优先级）：**先修开场无人机视角——前几秒出现超大幅度卡顿，要彻彻底底丝滑；修完每小项 push，然后持续打磨到无可挑剔。**

---

## ① 根因：开场时钟用「绝对 elapsedTime」，首帧编译停顿被当成「时间已前进几秒」

`CameraRig.useFrame` 原来：
```ts
const t0 = state.clock.elapsedTime
if (introStart.current === null) introStart.current = 0
const el = t0 - introStart.current
```
- `introStart` 恒为 0，`el` = 从画布创建起的**绝对**帧时钟。
- 首帧（尤其是低端机）要编译 `WorldTerrain/SkyAurora/HoloTurbine` 等 onBeforeCompile shader、生成 PMREM、上传纹理，`requestAnimationFrame` 期间 `elapsedTime` 会一次性多走数秒。
- 相机于是**不是从 t=0 平滑起飞**，而是第一二帧就跳到开场几秒后的位置 —— 用户看到的正是「前几秒超大幅度卡顿/瞬移」。

## ② 修复（`CameraRig.tsx`）

1. **开场独立时钟**：`introClock.current += min(max(delta,0.001), 0.1)`
   - 帧间增量累加、单帧钳 0.1s → 多秒级编译停顿被吸收为「原地微停」，相机不会瞬移。
   - 30–60fps 正常帧率完全按真实时长推进，开场不变慢。
2. **开场期间禁用 OrbitControls 帧循环**（`ctl.enabled = s.introDone`）
   - drei OrbitControls 内部 `useFrame` 仅在 `enabled` 时 `update()`（已读源码验证）。开场 disabled 后不再每帧重跑 `lookAt(target)`，既保住巡航 bank 侧倾，也消除 damping 沉降抖动。
   - 巡航/环绕路径不再 `ctl.update()`（只同步 `ctl.target`），避免抹 bank。
3. **禁用→启用交界一次性同步**（`!enabled && introDone` 时 `target.copy` + `update()` + `enabled=true`）：OrbitControls 内部球坐标在开场期间是 stale 的，直接启用会在松手 damping 时产生一次「抬头/回弹」跳变——同步后再启用，接管连续。
4. **Loading 屏预热**（`App.tsx`）：首帧后不立刻 `setReady`，等 3 帧 + ≥400ms 再淡出。首次 PMREM/shader 编译停顿被藏进 Loading；用户看到的第一眼就是已就绪、直接开跑的开场。

## ③ QA 证据

### 数值帧（Node 采样同一路径/剖面，60fps 步长）
```
总长 7701m 均速 226.5 m/s | min 107.4 max 450.4 m/s（峰谷比 4.19×）
变速方向反转 13 次 | 最大侧倾 6.2° | totalTime 精确 34.0s
前 6s 连续采样：0.0s y=1720 → 1.0s y=1545 → 2.0s y=1321 → 4.0s y=714，逐帧直线俯冲无跳变
```
（`introStats.mts` + 同模块采样脚本，运行时使用同一 `introProfile.ts`。）

### 渲染帧（精确锚点 `?debug=1&introT=<s>`）
`?introT=` 是会**冻结**开场时钟的 QA 锚点（软渲染 waitMs 无法精确锁帧；此参数保证 A/B 复现）。
- `shots/r25-intro8s-after.png`：相机贴 T03 前低空（~25% 弧长）。
- `shots/r25-intro20s-after.png`：T05/T07 对角穿场。
- `shots/r25-intro30s-after.png`：T07 前低机位终点（~93% 弧长）。
三帧构图与 `introStats` 剖面表一致、无崩溃、白线/地面无断裂。

### 生产构建冒烟（`npm run build` + `vite preview`，1920×1200）
- 控制台 **0 error / 0 warning**（仅 THREE.Clock deprecated 等运行时库提示，行为无影响）。
- `?debug=1` 探测：`__aeolus_cam` 存在、intro 相机 y 随时间平滑下降；`__aeolus_stats` 返回（probe 与 r24 同量级：geometries 80、textures 14；calls/tris 随机位不同属正常视角差异）。

## ④ 后续（round24 遗留）补齐
| 项 | 结果 |
|---|---|
| 日间地面 A/B | 完成（见下） |
| 日间参考基线双帧 | 完成（见下） |
| intro 8/20/30s | 完成（见 §③） |
| banking 观感 | 三帧可见 bank ≤6.2°、无大角度甩镜；待真机 GPU 最终确认 |
| coast/WASD 惯性 | 代码路径已走查（无类型/构建错误）；体感待真机确认 |

**日间地面 A/B**（`r24-day-closeup-before.png` vs `r25-day-closeup-after.png`，同 t=12/cam=35,22,200/1920×1200）：
- 亮带 p90 **58.7 → 50.8**（收敛，地面晶面高光下沉）；meanL 44.9→46.3（线性空间小回弹，前轮已注明该口径）；
- 中位色相 203.1→202.8（冰青不变），G-R +20.3→+20.2（无青偏移）。

**日间参考基线**（`baseline_*` vs `r25-baseline-*`，cam=0,22,990/q=high）：
- 风机亮边：dawn/morning 区域 meanL 77.6→77.8（**无 LightRig 回归**）；
- 天空读数差异为极光/星空 uTime 相位噪声（SkyAurora.tsx L76-92），非回归。

## ⑤ 验证链（本轮最终态）
- `npm run build` ✓（1.71s，index JS ~99.6 kB）
- `npm run lint` ✓ **0 warnings / 0 errors**（顺手把 WorldTerrain 的 react/immutability 误报按 docs/08 D2 口径豁免，r24 遗留 1 警告清零）
- `npm run selftest` ✓ **34/34**
- probe：与 r23/r24 同基线（几何/纹理数不变；calls/tris 随机位正常浮动）

## ⑥ 红线与未决
- 红线不变：Bloom 关、告警红专用、16:10 交付比、改 LightRig 须对日间基线双帧 A/B。
- **用户尚未实机验收开场运镜体感**（软渲染无法代表真机 60fps）；已在生产预览运行，等用户浏览器确认。
- 夜间暗度、banking、coast/WASD 体感仍属「待用户实机确认」项（本轮已提供全部可复现证据）。

## 环境备注（供下一 agent）
- 同 HANDOFF.md §3：`cd twin && npm install`；chromium 重取；NSS 桩库重编；`node scripts/shot.mjs`.
- 断言与测量使用 PIL+numpy；同 t 同月光角做 A/B；`introT=` 冻结开场帧。
