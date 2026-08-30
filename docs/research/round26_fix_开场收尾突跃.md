# Round 26 — 借鉴 `01a052ed` 开场运镜并修复最后一刻突跃

## 结论

采用 `arena/01a052ed-0824-2026`（head `73dc3a4`）的开场方案：
全局缓入缓出时间基、前 5 秒稳定注视点（消除黑屏 / 180° 闪跳）、关闭 bank 侧倾、速度用
`vMean*6k(1-k)` 解析剖面、34s 巡航 + 9s 收尾环绕。

同时修复原分支唯一被指出的问题——**44s 前后（严格说是 `el>=INTRO_TOTAL` 切到 OrbitControls 的最后一刻）的突跃**。

## 突跃根因（两个叠加）

1. **OrbitControls 极角钳制**
   开场结束时相机在叶轮中心下方仰视（极角约 99°~101°），但 `maxPolarAngle={Math.PI/2.06}`（约 87.4°）
   不允许相机低于目标水平线。`skipIntro()` 后 `ctl.update()` 一启用就把球坐标强制夹回约 87.4°，
   相机会瞬间上抬。
   **修复**：`maxPolarAngle → Math.PI/1.72`（约 104.65°），覆盖收尾环绕全程 98.7°~101.05°。

2. **React 重挂/重贴导致 OrbitControls `target` 被默认值覆盖**
   `skipIntro()` 触发 zustand 状态更新；`<OrbitControls target={CAM.target}>` 的 prop 会重新应用成
   `(0,22,-340)`，把我们在交接前写好的叶轮轮毂目标覆盖掉，相机朝向瞬间回到全景方向。
   **修复**：从 `<OrbitControls>` 移除 `target` prop，改为由 `CameraRig` 在开场期间逐帧维护
   `controls.target`（巡航/环绕中已同步到当前注视点），交接时再 `copy(smLook)` + `update()`。

## 保留的安全层

- 仍保留“目标 + 指数平滑跟随”（τ=0.09s）：位置 `lerp`、朝向 `quaternion.slerp`、fov 平滑，
  用来吸收掉帧与任何残余斜率切换。
- 开场时钟改为帧间增量累加并单帧钳 0.1s（原分支用绝对 `elapsedTime`，首帧/编译停顿会闪跳）。

## 验证

- 数学仿真（60fps）：平滑后 43s 与权威目标仅有 **0.08 m** 滞后；交接点无位置步跳。
- 真实页面交接测试（OrbitControls 已挂载、目标已同步到轮毂后触发 `skipIntro()`）：
  **position step 0.000 m，orientation step 0.000°**。
- 截图证据在 `docs/research/shots/`：
  - `r26-opening-t2.5.png` / `r26-opening-t7.png`：开场前段无黑屏、无闪翻。
  - `r26-orbit-entrance-t34.2.png`：34s 环绕入口（T07 低机位）。
  - `r26-handoff-42.9.png`：交接前冻结构图；`r26-handoff-after-real.png`：OrbitControls 已挂载后真实触发 `skipIntro()` 的交接后画面，与交接前保持同一 T07 构图（无回跳）。
- `npm run build` ✓ / lint 0/0 / selftest 34/34。

## 追报：用户反馈“开场仍出现两次黑屏”（Round 26b 修复）

**根因**：`PerfGovernor` 的自动画质调节在开场期间仍按帧时 EMA 行动。
开场首段要编译 shader / 生成 PMREM，帧时普遍偏高；真机上常见在头几秒内
**high → medium → low 连续降两档**。而 `quality` 同时驱动 `<Canvas dpr>` 与
`<Effects>` 的 `EffectComposer` 链路，每降一档就重建一次渲染目标 / 后期链，
于是出现**两次黑屏**（正好对应两次降档）。

**修复**：`PerfGovernor` 在 `introDone=false` 期间冻结自动降档；开场结束后再宽限
4 秒，避免交接瞬间立即重建后期/dpr。手动 `?q=` 锁档仍照常生效（首帧、Loading 屏内完成）。

**验证**：`npm run build` ✓ / lint 0/0 / selftest 34/34。该问题依赖真机首段 shader
编译压力，沙箱 SwiftShader 无法复现等价节流；修复逻辑从源头保证开场期间 `quality`
不再变更，因此不存在由画质重建引发的第二次黑屏。

## 改动文件

- `twin/src/scene/introProfile.ts`：采用 `01a052ed` 的节点集/`CAMERA_PATH`/`LOOK_PATH`/`INTRO_END` 与解析速度。
- `twin/src/scene/CameraRig.tsx`：采用全局时间基 + 无 bank + 稳定注视；保留指数平滑跟随；新增帧安全时钟与 `?debug&introT=` 帧锚点；交接前同步 OrbitControls 目标。
- `twin/src/App.tsx`：初始相机 `(-100,1450,250)` fov 52（与开场起点一致）；`maxPolarAngle` 放宽；移除会回写默认 target 的 OrbitControls prop。
- `twin/src/scene/PerfGovernor.tsx`：开场期间（及结束后 4s）冻结自动画质调节，杜绝首段双降档导致的后处理/dpr 重建黑屏。
- `twin/scripts/introStats.mts`：改为对应新路径的速度统计。
