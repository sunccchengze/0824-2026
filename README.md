# 0824-2026 · 风电场 3A 数字孪生（方案与设计仓）

> 目标：为西北安交大风电场偏航优化项目打造**影院级、深色系、3D Web 数字孪生**（对标 51World/数字冰雹/Omniverse 的观感），部署至 Cloudflare Pages。
> 现役科研台 [wind-farm-viz.pages.dev](https://wind-farm-viz.pages.dev/) 保持封板不动；本仓是它的**暗色旗舰姊妹篇**。

## 📚 文档导航
| 文件 | 内容 |
|---|---|
| [docs/01_调研报告_顶级数字孪生界面.md](docs/01_调研报告_顶级数字孪生界面.md) | 18 组深搜 + 视觉拆解：顶级数字孪生 UI 三大流派、平台格局、风电专项、参考图录 |
| [docs/02_实操方案_风电场3A数字孪生.md](docs/02_实操方案_风电场3A数字孪生.md) | **主交付**：已验证的技术选型（+版本核验）、3A 画质规格清单、架构、数据接入、8 阶段路线图、Cloudflare Pages 部署手册、性能预算、风险册 |
| [skills/README.md](skills/README.md) | 从用户技能库装载的 26 项技能及用途 |
| [docs/03_申请书一致性审计报告.md](docs/03_申请书一致性审计报告.md) | **已按申请书终版原文逐字对表**：数字孪生=研究内容③+阶段五的法定交付物；里程碑 v0→v3 对齐 2027.06 结题；含原文勘误 3 处与 5 项裁决 |
| [docs/04_视觉设计系统_冰青.md](docs/04_视觉设计系统_冰青.md) | **已定稿·冰青版**（用户 08-24 上传原图钦定，取代金翡版）：单青令牌、场景特征清单（极光/星光/冰河集电）、3D 与 HUD 实现口径 |
| docs/research/img/ | 顶级大屏参考图 5 张 |
| docs/research/mockups/ | **预期效果概念图**（AI 生图并经两轮导演修图）：`styleA_deepblue_v2.png` 深蓝全息风、`styleB_amber_v2.png` 琥珀金工业风 |

## ✅ 已验证基线（2026-08-24 沙箱实测）
- Vite 8.2.2 + React 19.2.8 + TS 6.0.3 + three 0.185.1 + R3F 9.7.0 + drei 10.7.8 + @react-three/postprocessing 3.1.0 + zustand 5.0.15：**构建通过（1.18s，gzip 382KB）**，含 9 机阵列/物理天空/Bloom/SMAA/晕影 PoC
- wrangler 4.125.0 可用；npm 核验：n8ao 2.0.1、@takram/three-atmosphere 0.19.1、@gltf-transform/cli 4.4.2、camera-controls 3.1.2、echarts 6.1.0、uplot 1.6.32、maath 0.10.8、gsap 3.15.0
- Cloudflare Pages 硬约束登记：单文件 ≤25MiB、20,000 文件、带宽免费；Workers Static Assets 为官方新推荐（迁移零成本预留）

## 🚦 当前状态（2026-08-28）
**v3 演示平台已交付**：`twin/`（AEOLUS TWIN）。docs/07 评审 + docs/08 合并清单全部 P0/P1 修复并实测验收：
构建 0 错误、lint 0 警告、数据契约自检 22/22、35 draw calls、联动闭环有截图证据（docs/research/shots/after_*.png）。
数据口径三分法（真实/演示/示意）已上界面角标与 README。文档索引补充：

| 文件 | 内容 |
|---|---|
| [docs/07_全面评审报告_问题清单与优先级.md](docs/07_全面评审报告_问题清单与优先级.md) | 第二轮全面评审（A-E 五类 63 项） |
| [docs/08_合并评审_最终清单.md](docs/08_合并评审_最终清单.md) | **权威清单（终版）**：复核裁决 + 逐项修复证据 + 验收门槛对照 |
| [docs/research/shots/](docs/research/shots/) | 历轮截图证据链（含本轮 before/after 对拍） |
| [twin/README.md](twin/README.md) | 演示平台运行/自检/调试键/口径说明 |
