# Round 27 — 完整 BUG 筛查（两遍）+ 现有版本完善

日期：2026-08-31 · 分支 `arena/01a0529f-0824-2026`
用户指令：先完整做一遍 BUG 筛查与故障修复；再做一遍主代码审查。多截真实画面；也找出项目不足；
把现有版本完善到最好后交付（暂不建 PR）。

## 第一遍：运行时 + 截屏 + 交互 BUG 筛查

### 环境恢复
- `npm install` / `npm run build` / `lint 0/0` / `selftest 34/34` 基线全绿。
- 沙箱 Chromium 截图链路恢复：重建 `/tmp/nsslibs`（NSS/NSPR 符号桩，含 SECMOD 与版本脚本），
  `?debug=1` + `?cam=` / `?introT=` 可复现固定机位。

### 真实截图覆盖（`docs/research/shots/r27/`）
- 全景 `pano-cam.png` / 北向 `wide-north.png` / 南向 `south-az180.png` / 叶轮中心 `turbine-center.png`
- 开场 t2.5 / t10 / t20 / t34.5（orbit）——全程无黑屏、构图连续、无 180° 翻转。
- 移动端 390×844 —— 有“建议 1920×1080 横屏”提示，窄屏为降级视图（非主交付）。
- 1280×720 —— 右列偏航面板（修复前底部被裁/与报警重叠）。

### 交互/联动/控制台
- `qa2.mjs`：限功率 12MW → derate 0.596 / 9 机限功率；乱偏航 → 一键寻优 +36.9%（Jensen 代理）。
- `probe.mjs`：无控制台错误；画质手动锁档可用；自动降档在开场期间被冻结（658614d 修复）。

### 第一遍修复（commit `47398f2`）
1. **1280×720 右列溢出**：固定 1920 布局在窄高横屏下，右列可用高不足，
   `radar + pservo(≥420) + alarms(≥96)` 超出可用高，偏航底部“需求功率/下发寻优/复位对风”
   被裁剪并与报警面板重叠。新增横屏窄高断点：压缩内边距/字号并允许内区滚动。
2. **寻优文案口径不诚实**：`optimizeYaw` 的 `baseMW/totalMW` 都是“满发·不限功率”口径，
   且基准是“当前偏航”而非“零偏航目标”，原文“较指令前 +x”会误导限功率下的实际收益。
   改为“满发口径全场 … kW，由当前偏航 → 代理最优 +x% + 限功率约束提示”。
3. **开场光照与 HUD 时间不同步**：`LightRig` 连续时钟在 `introDone=false` 时仍推进，
   43s 内天空从 06:00 悄悄走到 ~06:20，而 HUD 停在 06:00，开场结束光照才被吸附回 06:00（“光照跳变”）。
   改为与 `startSimClock` 同口径：开场期间冻结连续钟。

## 第二遍：主代码架构级审查（commit `8581a76` 待提）

### 新增修复
4. **开场中途跳过时 OrbitControls 回弹**：Esc/点击/书签/WASD 会让 `introDone` 立即为 true，
   进入自由飞行分支只 `enabled=true`；但 OrbitControls 在巡航期间一直 disabled，内部球坐标陈旧，
   用户第一次拖动会先“回弹/跳一下”。修复：`!enabled && introDone` 时先 `target.copy(smLook)` + `update()` 再启用。
   运行验证：skip 前后 **posStep 0.000m / angleStep 0.000°**。
5. **开场热路径 GC 抖动**：巡航/环绕每帧 `new Vector3`、WASD 每帧 3 个新向量、DEBUG 每帧 push buffer，
   都会在 34s 运镜里制造 GC 压力（与“丝滑”目标冲突）。改为复用临时对象、`getPoint(t, out)`、
   删除 dev-only 滚动 buffer。

### 走查结论（无新增缺陷）
- `useFarmFrame` 单例缓存键含 `unitYaw+targetMW`，同 tick 多组件一致；
- `farmFrame` 会就地改缓存 `units.status/tempC`，但由 `coreAt` 轻缓存覆盖且输入确定性，无脏帧；
- `buildHeavy` 整天 48 点 + 6h 告警扫描按 30min 分桶缓存，空闲不重算，弱机可接受；
- `coreAt` key 含 `WAKE_REV` 等，缓存上限 64/32 有 `evictOldest`，无泄漏。

## 项目不足（现存、需向用户说明）

- **数据单一**：默认演示数据 9/9 台全在线、无告警，缺少“真实/演示/停机/告警”差异表达，
  无法一眼看出系统异常处理能力（演示口径，不影响正确性）。
- **移动/超窄屏是降级呈现**：390×844 提示“建议 1920×1080”，控制台缩得很小；这不是当前主交付形态。
- **`?debug&introT/cam` 等 QA 钩子仍在**：依赖 `DEBUG_ALLOWED`，生产构建不暴露；交付前可按需隐藏。
- **大 chunk**：three.js 单 chunk ~1.28MB（gzip 384KB），首载仍有优化空间（不作为本轮缺陷）。
- **`PerfGovernor` 冻档只覆盖开场+4s**：开场后可恢复自动升/降档，真机如需更保守可再调。

## 验证
- `npm run build` ✓ / lint 0/0 / selftest 34/34。
- 交接 skip 实机：posStep 0 / angleStep 0；1280 右列完整；寻优文案诚实；开场无黑屏。
