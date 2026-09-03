# round31 · 开放外海 / 陆地生物群系 / 接地投影重构

> 分支 `arena/01a06577-0824-2026`，2026-09-03。承接 round30。
> 用户实按 round30 验收后给出四类反馈：① 风机阴影形态不正确（叶片投影有问题）；
> ② 海陆视觉差异要大（近海黄沙、远海森林）；③ 世界是盆地/湖泊而非海，须打开两相邻侧为纯海洋、另两侧为曲折陆地；
> ④ 公开参考来源（已在 chat 给出 GitHub / discourse / 知乎 链接，见文末）。

## 一、用户反馈与落实情况

| # | 反馈 | 落实 | 状态 |
|---|---|---|---|
| 1 | 风机阴影形态不正确，叶片投影有问题 | 接地投影整体重构：把「跨组件总线」方案改为**并入风机自身**，用 three 真实矩阵取 3 叶尖世界坐标 → 投影到地面。**塔影带 + 接地盘形态正确**（见截图）。叶片影因 3 条软影带在低角/俯视绕成「大软圆盘」仍未解决，**本轮暂停并记录移交**（见第四节）。 | ⚠️ 部分 |
| 2 | 海陆视觉差异要大：近海黄沙、远海森林 | `WorldTerrain` 片元分带：`vLand` 权重 → 近岸黄沙带 / 内陆森林台地 / 远山，低饱和莫兰迪黄褐/灰绿/深灰青。 | ✅ |
| 3 | 当前是盆地/湖泊，要开放两相邻侧为海、另两为曲折陆地 | `terrainUtil.terrainHeight` 从「径向海盆」改为「方向性陆地」：南(+z)/东(+x) 两相邻侧开放为纯海（无岸），北(-z)/西(-x) 为带噪声蜿蜒海岸线的陆地；9 机+升压站仍居海中央。 | ✅ |
| 4 | 公开参考来源 | 见文末「参考来源」。 | ✅ |

## 二、核心改动

### 1) 开放外海地形（`src/scene/terrainUtil.ts`）
- 删除「以场心为圆心的径向海盆」，改为方向性 `landMask(x,z)`：
  - `wN = smoothstep(COAST_N, COAST_N+480, -z + wobN)`：北向(-z)陆地；
  - `wW = smoothstep(COAST_W, COAST_W+460, -x + wobW)`：西向(-x)陆地；
  - `land = max(wN, wW)`：任一方向靠陆即抬升；南/东保持 0 = 开放海；
  - 海岸线蜿蜒：`wobN/wobW` 用 FBM 噪声（±320m）破除直线切割带感。
- `terrainHeight`：海床基准(≈2m) + 低幅微地貌(±2m)；`land>0` 时分带抬升：
  - `sand`(land 0→0.28) ≈ +10m；`forest`(0.20→0.72) ≈ +34~54m；`mountain`(0.55→1) ≈ +60~250m。
- 全部 9 机 x∈[-732,532]、z∈[-1272,-8]，南/东侧均 < 海岸基准 → 全在海床（≤12m）。升压站(300,300) 亦在海床。

### 2) 陆地生物群系着色（`src/scene/WorldTerrain.tsx`）
- 顶点新增 `aLand` attribute（`landMask(x,z)`），vertex shader 以 `aLand` 判定水陆：
  `water = 1 - smoothstep(0, 0.02, aLand)`（replace 旧高度阈值，避免海岸低海拔沙带被误判为水）。
- fragment shader 用 `vLand` 分带混色：
  - 沙带 `sandMask = 1 - smoothstep(0.06,0.17, vLand)`：低饱和暖黄（昼 ~~rgb(0.40,0.34,0.20)~~ 更亮、夜压暗）；
  - 森林 `forestMask`：低饱和冷绿 + 细碎树冠斑驳 `vnoise`；
  - 远山 `mtnMask`：深灰青，与原有冷调衔接。

### 3) 接地投影并入风机（`src/scene/HoloTurbine.tsx`）
- 采用「转子真实矩阵」方案：转子组内放 3 个不可见叶尖 `object3D` + 轮毂 `object3D`，useFrame 里 `getWorldPosition` 得到真实世界坐标；`projectToGroundY(P, sun, g)` 物理正确投影到地面（shadow = P − t·sunDir）。
- 每个风机自带 3 类影子 mesh（本地坐标，组原点=地面）：接地暗盘（contact disc）+ 塔影带（tower streak）+ 叶片影 ×3。
- `orientShadow` 用 `makeBasis(_shadowRight, _shadowDir, _shadowUp)` 确定贴地平面朝向（无欧拉歧义）。
- `GroundShadows.tsx` / `rotorShadowBus.ts` 已删除（职责并入 HoloTurbine）；`App.tsx` 移除 `<GroundShadows/>`。

### 4) 海面泡沫/波光克制化（`src/scene/WorldTerrain.tsx`）
- 泡沫提频（`fbm(0.075p)`）、收紧阈值、降低混色权重，消除大块白斑、更贴真实水面；
- 镜面高光指数提高（520→620）、sparkle 权重微调（0.15→0.10），天光反射权重略降，保持暗调克制。

## 三、验证证据（无头截图）

| 场景 | 文件 | 结论 |
|---|---|---|
| 高空全景 | `twin/docs/research/shots/r31_new_coast_far.png` | 一条蜿蜒海岸线 + 黄沙带 + 绿色森林台地 + 远山剪影，海陆对比显著；不再是封闭盆/湖 |
| 白天 hero | `twin/docs/research/shots/r31_new_hero.png` | 开放洋面 + 风机全在海中央 + 升压站离岸；海面细碎波光，无格子 |
| 风机接地投影(15.5 时) | `twin/docs/research/shots/r31_inline_shadow_wide3.png` | 塔影带沿背离太阳方向延伸、接地盘锚定塔基，形态正确 |
| 海面改善 | `twin/docs/research/shots/r31_sea_improved.png` | 泡沫云斑明显减少，海面更平顺像水，不再是云海/冰面 |

工程校验：`npm run build` 0 错误；`npm run lint` 0 警告 0 错误；`npm run selftest` 37/37 通过（新增「开放外海：南/东相邻侧 2300m 处保持海床 ≤12m」断言）。

## 四、遗留问题 / 移交项【叶片投影】

**现象**：叶片影用 3 条 `PlaneGeometry(2.2m 宽 × 最长 100m)` + `shadowTex`（宽度羽化）铺平后，从低角/俯视会绕成一个「大软圆盘」，而非 3 条清晰射线。

**已排除的假设**：
- 非海面泡沫（调低后圆斑仍在）；
- 非尾流管（alpha 峰值 0.055 + exp 衰减，加性混合为发光蓝，非暗斑）；
- 非信标光斑（beacon 为发亮青白，圆斑为暗色）。

**强烈怀疑根因**（`ENABLE_BLADE_SHADOW = false` 已注释于 `HoloTurbine.tsx` 顶部说明）：
- `orientShadow` 的 `makeBasis(_shadowRight, _shadowDir, _shadowUp)`：`_shadowRight = cross(up, dir)`，当 `dir` 水平时 right 水平、up 垂直，理论上正确；但 3 条影带在**转子自转（spinRef 每帧变）**下的投影方向不断变化，可能与影带的宽轴没对齐 → 影带被旋转成斜交、展宽成面；
- `shadowTex` 的**宽度羽化** `Math.pow(1-|u|/wf, 2.2)` 在长影带（100m×2.2m）下，羽化区占了大半宽度 → 3 条影带视觉上糊成一片。

**后续接手建议**：
1. 叶片影改用「细线/窄三角」而非带羽化纹理的宽平面——直接借用真实叶片截面（`bladeRibSet`）投影成细线，或用 `THREE.Line`/窄 `BufferGeometry` 三角带；
2. 复核 `orientShadow` 的 basis：改用 `setFromUnitVectors` 或「先绕 X 铺平再绕 Y 定向」的欧拉顺序，确保长轴严格沿投影方向、宽轴水平；
3. 影带长度不要按 `0.7` 系数截断，应按 `t=(P.y-g)/sun.y` 完整投影，避免近视模糊；
4. 若追求真实感，可在 `LightRig` 加 `directionalLight.castShadow` 配标准阴影贴图（需地形 shader 支持 `receiveShadow`），但当前是自定义 ShaderMaterial + 全息线框，标准阴影贴图不适用，故贴地投影是既有正确方向。

## 五、参考来源（用户要求公开，可回溯）

- Sean-Bradley/three.js — Classic Ocean Shader with Gerstner waves（`examples/webgl_shaders_ocean_gerstner.html`）；
  discourse.threejs.org/t/classic-ocean-shader-example-with-gestner-waves/29227
- github.com/juyshy/ocean — realistic water shader for Three.js（镜面反射底）
- github.com/davidllona/Threejs-water-shader — 过程海洋：正弦波 + Perlin 噪声 + 深度配色 + 泡沫 + 动态高光
- github.com/topics/waves-gerstner 与 github.com/madblade/waves-gerstner — Gerstner 波集合/模块
- 知乎《明日之后中如何构建末日世界的光与影》— PBR 湿润地表、DP 合批、植被 billboard RT；低饱和色调映射
- cnblogs uwatech TA实践分享（水体 Unity/UE）— SimpleWave GetWaveHeight + TBN 法线 + 泡沫流噪声
- blog.csdn.net/qq_26930381 写实海面渲染的全景解析 — IFFT 波高、LOD 网格、SSR/HZB 反射折射、水下散射、SSAO、近裁剪面水线
