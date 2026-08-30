# 第 24 轮：夜间地面压暗（用户跨多轮诉求）+ 惯性运镜（-SKILL- 技能）+ 删标注

日期：2026-08-30 · 分支 `arena/01a051ab-0824-2026`
用户指令（4 项，"来吧"= 执行）：
1. 用用户仓库 `-SKILL-` 最新提交分支里的 web 惯性移动技能，让无人机运镜有惯性；
2. 开场运镜更自由潇洒：直线加速、弯道减速环绕、变速频率更高、幅度更大；
3. **地面棱柱侧面（用户纠正：最突兀在夜间，侧面青蓝色）要变暗色**——跨多轮未决诉求；
4. 删除"全场功率总览" 3D 标注。

---

## ① 技能落地（gsap-plugins / Inertia）

- 技能定位：`sunccchengze/-SKILL-` @ `arena/01a048e7-skill`（最新提交分支，2026-08-29），
  `skills/community/gsap-skills/skills/gsap-plugins/SKILL.md`（Inertia + MotionPath 两节）。
- 已安装到本仓库 `skills/gsap-plugins/`（第 27 项，`skills/README.md` 已更新）。
- **不新增依赖红线**：gsap 是 DOM tween 库，three 相机不适用 → 按技能语义**原生移植**：
  - `InertiaPlugin.track + inertia:"auto"`（track 速度→指数滑行停止）→ `CameraRig.tsx` 的
    **coast**（开场/跳过→自由轨道交接，τ=0.3s，漂移上限 120m）+ **WASD 惯性**
    （按压 0.22s 爬升 / 松手 0.9s 滑行，替代原来瞬停）；
  - `MotionPath`（沿路径+切向对齐+变速）→ `twin/src/scene/introProfile.ts`（见下）。

## ② 开场运镜（introProfile.ts + CameraRig.tsx）

**设计**（`twin/src/scene/introProfile.ts`，纯确定性数学，无 RNG）：
- 13 节点 CatmullRom 路径（7701m / 34s，均速被钉死 226.5 m/s）上做**表驱动速度**：
  - 曲率 25 样本盒式平滑 → 90 分位归一 → 温和乘性调制 0.65~1.0（直线满速、最紧段 −35%）；
  - `BOOST_TABLE` 13 控制点（smoothstep 插值 C1）：直线段 1.40~1.50 峰值、弯道 0.55~0.62 谷值；
  - 数值积分 → 时间→弧长映射表（2048 点），总时长精确 34s → **截图/A/B 可复现**；
  - bank = √(侧向加速度) 映射 ≤6.2°（右转→rotateZ 取负，已验证屏幕坐标符号）；
  - fov 随速 47→51.5 + 开场 3s 广角俯冲（54→）。
- **收尾环绕改 Hermite 三次**：起点角速度 = 巡航出口速度×切向对齐/R0（0.57 rad/s）匹配接管，
  终点 0.10 rad/s 缓停 → 环绕"减速环绕"（用户原话），不再从零起步；起始 0.8s roll 交叉淡化。

**定量证据**（`node --experimental-strip-types twin/scripts/introStats.mts`）：
```
总长 7701m 均速 226.5 m/s | min 107.4 max 450.4 m/s（峰谷比 4.19×）
变速方向反转 13 次（2.6s 一次）| 最大侧倾 6.2° | totalTime 精确 34.0s
出口 107.4 m/s → 环绕接管 0.57 rad/s
```

**验证状态（交接注意）**：
- 数值 ✓（上表）；渲染 ✓（`shots/r24-intro8s-after.png`：8s 时相机在 ~25% 弧长贴 T03，与剖面表一致，无崩溃）；
- **未完成**：①/20s/30s 三帧 A/B（被用户叫停收工）；② banking 观感未截图确认；
  ③ coast/WASD 惯性体感未人工确认（代码路径已走查，无类型/构建错误）。
- 修过的运行时坑：three r185 `divideByScalar`→`divideScalar`；scale 方向 `rawDur/totalDur`；
  smoothstep 未限幅 x>1 变负（尖角速度飙升 bug）。

## ③ 地面夜间压暗（WorldTerrain.tsx，shader cache key `terrain-wave-v13`）

**根因（像素测量确认，含用户纠正）**：
- 用户最初说"侧面绿亮"；多轮后用户明确纠正：**最突兀在夜间——每个三角棱柱侧面青蓝色，要暗色**。
- 测量（夜间特写 cam=35,22,200 t=22/23）：亮带 medHue≈195~196、G-R≈+48（典型 cyan）；
  夜间顶面近黑 → 青调补光（`#3f88b8` hue200° / `#86b8dc` hue203°，LightRig 未动）+ 月光 +
  青色波前辉光把晶面棱边整体点亮，黑顶面衬托下对比最强。
- 关键教训：a) 亮带**不是**纯几何侧墙（view-space upFace 高），是抬升晶面棱边 →
  只压侧墙（sideW hook）英雄机位只 −4%，必须**全局收暗**；
  b) `opaque_fragment` 处 gl_FragColor 是**线性空间**（tonemap 前），阈值按线性标定
  （0.010/0.08），按 sRGB 标定会失效；c) 必须**同 t 同月光角**做 A/B（t=22 vs 23 月光角差异
  会造成 ±5% 的假"改进/退化"）。

**三层修正（仅地形 shader；灯光/风机/昼夜曲线全部未动）**：
1. 侧墙 albedo 门 0.30→0.18（`normal_fragment_begin` 处）；
2. 片元末段（`opaque_fragment` 后）：侧墙去青（昼 0.60/夜 0.85）+ 压暗（昼 ×0.66/夜 ×0.42）
   + **夜间全局**：亮部软压缩去青（luma>0.08 线性 → 混向 (0.46,0.60,0.88)×luma 权 0.75 + ×0.45）
   + **夜间整体 ×0.52**（`c *= mix(1.0, 0.52, night)`）；
3. 波前辉光：色相向蓝收 (0.030,0.070,0.088)→(0.028,0.062,0.094)，夜间再蓝
   (0.015,0.036,0.082)；uGlow 白天上限 0.72→0.60、**夜间下限 0.34→0.08**。

**前后证据（t=23 同月光角，英雄机位 0,22,990）**：
- 地面（画面下 45%）meanL **49.3 → 38.8（−21%）**；亮带 8.9%→8.2%；
- 对照（用户当时看到的 v1 状态 vs 最终 v13，夜间特写）：meanL 46.4→~39.6、中频带 49%→28%；
- 天空**未被本修改影响**（shader 作用域仅地形）。注意：不同时刻截图的天空读数有
  ±10% 差异 = 极光/星空随 uTime 动画的相位噪声（SkyAurora.tsx L76-92 已证实），**不是回归**。
- 证据图：`shots/r24-night-closeup-{before,after}.png`、`shots/r24-night-hero-after.png`
  （before 对照用既有 `shots/r23-night-after.png`，t=23 同机位）。

**未完成（用户未表态）**：用户看完 v13 夜间效果后说"太慢了，收工交接"——
**夜间暗度未获明确验收**。当前 ×0.52 全局收暗是本轮最终状态；若用户仍觉亮，
下一杠杆（按风险从低到高）：夜间全局 0.52→0.42 / 两盏青调补光夜间去青（LightRig 改动，
须按《日间氛围_参考基线.md》对 baseline_dawn_0612/morning_0800 两帧 A/B 证明天空/风机未动）。

## ④ 删"全场功率总览"3D 标注

- `Callouts.tsx` ITEMS[0] 已删（左侧 2D 面板"全场功率总览"保留，用户只删 3D 标注）。
- 视觉确认：`r24-night-hero-after.png` 中 r23 画面中央的该标注已消失，其余 4 个标注（风能资源场/
  风机/集电线路/升压站）仍在。

## 验证（本轮最终态）

- `tsc -b` ✓ · `oxlint` 1 warning 0 error（WorldTerrain `mat` react-compiler 误报，历轮已有）
- `vite build` ✓ 1.76s（index JS 98.07 kB，+4.8 kB = introProfile/CameraRig 代码）
- probe（q=high hero 机位）：**163 calls / 128,196 tris / 45,584 lines / 80 geoms / 14 tex —— 与 r23 完全一致**
- selftest **34/34** ✓

## 环境与复现（下一 agent 注意）

- 沙箱重置会擦 node_modules 与 /tmp：`cd twin && npm install`；chromium 重取
  `node -e "import('@sparticuz/chromium').then(async m=>console.log(await m.default.executablePath()))"`；
  NSS 库重编（/tmp/nssbuild stub.c 44 符号，ver.map 首个节点必须是 `NSS_STUB_BASE { global: _stub_base_dummy; }`）；
  装 Pillow/numpy：`pip3 install --break-system-packages Pillow numpy`。
- 截图：`node twin/scripts/shot.mjs '<url>' out.png waitMs 1920 1200`
  （`?cam=az,el,dist[,tx,ty,tz] ?t=<sim小时> ?q=high ?noveil=1 ?debug=1`；intro 用 waitMs 钉时刻）。
- 速度剖面验证：`node --experimental-strip-types twin/scripts/introStats.mts`（与运行时同模块）。
- 像素测量脚本（本会话用，未入库）：PIL+numpy，注意 `a[y0:y1, :, c]` 三维切片写法
  （`a[y0:y1, c]` 会切错轴得到假灰度——本轮踩坑）。

## 交接 TODO（按优先级）

1. **用户验收夜间地面暗度**（本 rounds 未闭环）：亮预览等用户反馈；若仍亮，按③"未完成"段的杠杆升级。
2. **日间地面 A/B 未做**：`shots/r24-day-closeup-before.png`（t=12 特写）已归档，after 需重拍
   （当前代码）后做像素对比（中位色相应 201→>207、亮带 L p90 下降）。
3. **intro 完整 A/B**：20s/30s 帧（before 在 /tmp 未归档：r24_intro_{20,30}s_before.png，如已丢失用
   r23 之前的提交重拍）+ banking 观感确认。
4. 既有悬置：after_* 证据重拍、docs/08 同步 r11–24、PR#3（我的分支 merge 后建议关闭）、
   PR#4 不 merge（用户决定）、1080p crush 仅记录。
5. 红线不变：Bloom 关、告警红专用、16:10 交付比、每轮六段报告、改 LightRig 须对
   `shots/baseline_dawn_0612.png / baseline_morning_0800.png` A/B。
