# Round 28 — 3A 画面完成（白天影子 + 夜晚生机）+ Bug 审计

日期：2026-08-31 · 分支 `arena/01a058c7-0824-2026`（承接 `arena/01a0529f-0824-2026` 未完成部分）

## 承接状态

- 上游分支 `01a0529f` 最新提交 `cc03b63` 已完成异常系统，B1/B2 未提交（沙箱重置丢失）。
- 本分支从 main `bfa58ca` fast-forward 到 `d789055`（即 `01a0529f` 顶），再继续。

## B1 白天影子 — 任何角度可见

### 根因
- 真实阴影管线：地面为自定义 MeshStandardMaterial（onBeforeCompile 注入波浪位移+空气透视+侧壁压暗），且有 4 盏青调补光 + 半球光 0.66，白天阴影对比度被冲淡；
- 太阳高度 54° 时真实投影仅 ~0.7 纹素/m，纹理本身短，且会被地形起伏遮挡；
- 用户诉求：任何角度都能看到风机在地面上的明显投影，正午也要。

### 方案：确定性接地投影 `GroundShadows.tsx`
- 共享 CanvasTexture：
  - streak 64×256：白底 alpha 渐变，长度方向 pow(1-v,1.35) 根实尖虚，宽度方向 pow(1-|u|/wFactor,2.2) 软边，尖部收窄 0.55；
  - disc 128×128：白底 radial 0.95→0 中心实边缘虚，由材质 color 着色为深蓝黑 `#08101e`；
- 每机组 4 层：
  - 外层柔影 disc 34m，opacity 0.33，俯视也可见；
  - 接地圆盘 disc 18m，opacity 0.78 day，锚定接地感，正午也有；
  - 软影 streak 28m 宽，opacity 0.28+boost，模拟半影；
  - 核心影带 streak 14m 宽，opacity 0.62+boost，清晰；
- 方向：`atan2(sunDir.x, sunDir.z)`，外层 group Y 旋转，内层 mesh X -90° 铺平，Y 缩放 = 长度；
- 长度：`38 + 130*(1-sinEl)^1.35`，晨昏 ~168m，正午 ~52m，最小 32m 保证正午可见；
- 透明度：`dayF*(0.62+0.35*(1-sinEl))` 正午 0.62 晨昏 0.97，disc 0.78；
- 材质：MeshBasicMaterial，depthTest:false/depthWrite:false/renderOrder 6-9，y 抬高 0.42-0.78m，`color=#08101e` 与白底纹理相乘后为深蓝黑，混合 `src*alpha + dst*(1-alpha)` = 压暗且色相可辨；
- 夜间：dayF<0.05 隐藏，避免黑夜黑块。

### 验证
- `?t=12&cam=60,22,990` 正午远景：9 机均有明显暗带，方向背离太阳（南→北），长度 ~50m，disc 清晰；
- `?t=7&cam=60,22,990` 晨间：影带更长 ~150m，透明度更高，方向一致；
- `?t=12&cam=85,70,400` 俯视：外层 34m 柔影让塔基在俯视下也有暗化锚点；
- `build/lint/selftest` 全绿。

### 额外：LightRig 对比度优化
- 半球光 0.42+0.24fd → 0.32+0.12fd，白天压低，阴影不被冲淡；
- 3 盏补光强度 ×(0.35+0.65*night)，白天 0.045/0.056/0.091，夜间保持原有。

## B2 夜晚生机 — 不再冷清死寂

### 信标增强 `HoloTurbine.tsx`
- 原有 beacon 球 0.4m → 0.7m，opacity 0.85；
- 新增两层光晕球 2.6m：内层 0.32+0.48*pulse，外层 0.12，Additive，scale 1.2+1.1*night+0.9*pulse；
- 点光源：强度 night*(8+14*pulse)*(0.6+0.4*slow)，距离 140+60*pulse，decay 2，照亮机舱与近地，告警时转红；
- 脉冲：`pow(0.5+0.5*sin(t*2.1+idx*1.7),3)` 0.33Hz 错相 + slow 0.7rad/s，呼吸感。

### 地面星光 `SparkleGround.tsx`
- 新增 uniform `uDayF`，夜间闪烁更快 `1.5+night*0.9`，尺寸更大 `7.5+night*2.5`，sizeBoost 1+night*0.55；
- 片元增益 0.85+night*0.55，alpha 0.42+night*0.38，夜间明显。

### 天空 `SkyAurora.tsx`
- 极光：night=1-dayF，呼吸 `0.85+0.35*sin(t*0.08+az*2.3)+0.15*sin(t*0.21+az*5.7)`，强度 ×(0.25+0.85*night)，叠加冷青白 `mix(aurCol, vec3(0.55,0.92,1.0),0.35*night)`；
- 星点：第一层 0.20+night*0.18，第二层 0.11+night*0.12，闪烁频率 +night*0.8/0.7；
- 第三层：夜间稀疏高亮星 `step 0.9965`，`pow(0.5+0.5*sin(t*2.4),3)` 偶发闪烁，`0.32*night`。

### 地形 `WorldTerrain.tsx`
- uGlow：原 0.08+0.52*dayF（夜 0.08 死寂）→ day*0.60 + night*(0.18+0.12*breathe)，夜 0.18-0.30 呼吸，波前微光保留。

### 地面脉动 `NightPulse.tsx` 新增
- 每机基座 + 升压站 2 处，Additive 柔边圆盘 18-28m，纹理 radial 白底 alpha，颜色冰青；
- 呼吸 `sin(t*0.8+phase)` + slow `sin(t*0.22)`，scale 0.85+0.45*breathe，opacity night*(0.45+0.55*breathe)，夜间明显。

### 升压站 `Substation.tsx`
- 点光：主站 12+4*flick，控楼 7+2.5*sin，夜×，照亮站区。

### 验证
- `?t=22&cam=60,22,990` 远景夜：地面星光大量蓝白点，波前微光呼吸，不再死黑；
- `?t=22&cam=15,28,220` 近景夜：蓝白星点 + 地面脉动可见，光点数量较旧版明显增多；
- 信标在 1280 720 下因距离仍小，但在高分屏近景可见双层光晕。

## Bug 审计（本轮）

- GroundShadows 纹理原黑底 × color 黑 = 恒黑，无法用 color 调色相 → 改白底 alpha + tinted color `#08101e`，混合后深蓝黑可辨；
- useMemo 依赖漏 `SHADOW_COLOR` → 移到模块常量，lint 0；
- LightRig 补光白天冲淡阴影 → 强度夜控；
- SparkleGround 夜间过暗 → 亮度/尺寸/频率夜增；
- HoloTurbine beacon 白天夜晚同亮度 → 夜增 + 点光 + 双晕；
- 截图链路：`/tmp/nsslibs` 需重建，已用 `bootstrap.sh` 恢复，qasmoke/qa2 全绿；
- 其余：Math.random 仅在 anomaly/粒子重生等非渲染路径，合规；无新增 console；build 1.27MB three chunk 384KB gzip 正常；34 自检全过。

## 交付物

- 代码：`GroundShadows.tsx`、`NightPulse.tsx`、增强 `HoloTurbine/SparkleGround/SkyAurora/WorldTerrain/Substation/LightRig`；
- 截图证据：`docs/research/shots/r28_*` 10 张，含正午/晨间/俯视/近景昼夜；
- 验证：`npm run build` ✓ / `lint 0/0` ✓ / `selftest 34/34` ✓ / `qa2` curtail 12MW + 优化 +36.9% ✓ / `qasmoke` ✓。

## 后续可优化（非阻塞）

- 信标在极远机位仍偏小，可考虑 Billboard Sprite 或更大光晕；
- 地面脉动颜色可再与电缆脉冲联动；
- three.js chunk 1.27MB 可拆分（不影响 3A）；
- 移动端仍为降级视图，主交付 1920×1080 横屏。
