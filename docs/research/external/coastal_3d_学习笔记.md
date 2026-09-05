# coastal_3d 学习笔记

> 来源：朋友分享的 `海岸形貌远光超惊艳3D海岸演示.zip`，解包到 `docs/research/external/coastal_3d{,_v2}/`。
> 学习时间：2026-09-05
> 目的：参考其海岸线/海面/草地/植被架构，看是否对 R32-R34 改造有借鉴价值。

---

## 1. 整体结构（2152 行 TS）

```
src/
├── App.tsx              206 行  入口 + 相机 + 后期 + GUI
└── scene/
    ├── noise.ts         108 行  Simplex2D / fbm / mulberry32 / smoothstep
    ├── heightmap.ts     240 行  高度场 + **EDT** 距离变换 + 雪线
    ├── glsl.ts          118 行  GLSL 噪声 / 高度采样 / 天空
    ├── terrain.ts       254 行  HeightField→Three 几何 + 着色
    ├── ocean.ts         222 行  Gerstner 海面 + 雾
    ├── sky.ts            61 行  天空 + 太阳
    ├── grass.ts         227 行  InstancedMesh 草簇（多 blade/簇）
    ├── vegetation.ts    317 行  程序化植被（merge + 颜色 + 实例）
    ├── controls.ts      135 行  相机 + 鼠标交互
    └── world.ts         264 行  高度场构建 + 资源编排
```

清晰分层：噪声 → 高度场 → 几何/材质 → 场景。

---

## 2. 海岸线方案（最值得借鉴的部分）

`heightmap.ts:23-28` 注释直白：
> Raw signed coast field (>0 land). **Only its zero-set matters – true distance is computed by an EDT.**

### 2.1 海岸 = 零集（zero-set）思维
不是沿 X/Z 算位移，而是**定义一个标量场 `coastRaw(x, z)`**，令其零等值面 = 海岸线。

```ts
// 极坐标 R + 多频 sin + fbm 扰动 → 距场心 R 处为海/陆边界
const R = 405 + 110*sin(3θ+1) + 70*sin(5θ-2) + 30*sin(9θ+0.5)
        + 80*fbm(2.2θ, 2.2θ) + 30*fbm(0.012q);
let d = R - r;  // 0 等值面 = 海岸
```

- 多频率（3/5/9 倍频 sin）保证 100m~3km 全尺度岬/湾
- fbm 叠加破单调
- 域坐标 `warp(x, z)` 先做坐标扭曲（fbm 偏移 130m）→ 防 90° 对称感

### 2.2 EDT (Euclidean Distance Transform)
**关键：闭式距离 vs 真距离**。闭式（analytic）会因 fbm 出现"自相交的等值面"——视觉上感觉是负距离但数学上是正。

`heightmap.ts:83-178` 用 **Felzenszwalb & Huttenlocher** 经典 2-pass EDT：
1. 像素化 `mask` 标记海/陆
2. Pass A：把 mask=true 的 cell 距离置 0，其余 +∞
3. 2-pass（行优先 → 列优先）松弛：每个 cell 取 8 邻域最小（带平方距离）→ O(N)
4. Pass B：开方得米数，按海/陆取正负号，shift 半格保连续

**得到的"真距离"用于**：沙带宽度、悬崖 mask、岸线泡沫强度、植被距离场。

### 2.3 跟我方 R32 方案的对比

| 维度 | coastal_3d | 我方 R32 (5465da0) |
|---|---|---|
| 海岸定义 | 标量场零集 | 沿岸位移 `wobN(x)` / `wobW(z)` |
| 距离计算 | EDT（精确 O(N)） | 闭式 `dNorth(x,z) = -z - CN0 - wobN(x)` |
| 多尺度岬湾 | sin(3/5/9 θ) + fbm | 5 层 fbm/ridged 叠加 |
| 安全性 | 无显式约束 | cap/bayCap 硬约束（≥600m 机组净距） |

**问题**：
- 闭式距离在 fbm 振幅过大或位移非单调时会失真（局部"自交"导致错号）
- 我方 R32 之所以保留闭式是因为 `wobN` 单调保证 + 振幅 ≤ 1500m（< 沿岸场长尺度），视觉上未暴露问题

**借鉴价值**：如果未来要加大 fbm 振幅或允许多尺度岬 ≥ 2km，应切换到 EDT 方案。

---

## 3. 高度场构建（world.ts）

- 1 个 CPU-side `Float32Array(res×res)` 高度数据
- 通过 `DataTexture(R, Float)` 上传 GPU
- 地形几何采样这张纹理（`GLSL_HEIGHT_SAMPLER`）
- 海面**也**采样这张纹理（`vDepth` varying）→ 浅水用低浪幅、贴地稳定

**跟我方对照**：我方 R32 把 landMask + signedShore 全在 CPU 算，再以 attribute 注入顶点。coastal_3d 在 GPU 采样纹理 → **可任意精度的等高线 + 真 EDT**，代价是高度数据必须常驻显存。

---

## 4. 草地（grass.ts）

`InstancedMesh` 草簇，每簇 5~15 blade，每 blade 4~8 段：
- 三角面共享顶点的简化草片（不是 billboard）
- 簇 = 一个 matrix4 摆位
- 簇属性通过 `instanceColor` 颜色变体

**跟我方 R33 grassField.tsx 对比**：

| 维度 | coastal_3d | 我方 R33 |
|---|---|---|
| blade 形状 | 自建简化 mesh | `bladeGeometry` 自建 |
| 实例数 | GUI 可调（数百） | 同 |
| swiftshader 兼容 | 未知 | **回退方案**（userAgent 嗅探） |
| 风动 | 顶点 shader 加 sin(time) | 同 |

**借鉴价值**：coastal_3d 没用 R3F，直接 raw Three.js。我方 grassField 用了 R3F hooks + 自建组件。架构差异大，参考价值有限。

---

## 5. 植被（vegetation.ts）

- 程序化生成若干 `THREE.BufferGeometry`（树/灌木/石）
- `mergeGeometries` 合并后 `InstancedMesh` 散布
- 散布规则：根据 `HeightField.sample(x, z)` 的高度 + 坡度 + 与海岸距离分区域（沙地/草原/林地/雪线）

**借鉴价值**：
- 区域分流思想：按 height/slope/coastDist 三维特征判定**生物群系**
- 这跟我方 R32 的 6 类生物群系方案**完全同构**，只是数据源（CPU 闭式 vs GPU 采样）不同
- **学习点**：coastal_3d 的生物群系边界 = 软阈值（smoothstep），不是 hard mask，过渡更自然 → 我方 R32 在 6 类间也用 smoothstep 一致

---

## 6. 海面（ocean.ts）

- 平面 640×640 段，2400m 范围
- 顶点 shader：`GLSL_NOISE` + 高度纹理采样 + 多方向 Gerstner 波叠加
- 片元：菲涅尔天空反射 + 浪尖高光 + 雾

**关键细节**：
```ts
NEAR_OCEAN_SIZE = 2400;  // 近场海面（覆盖镜头主要视野）
NEAR_OCEAN_SEGS = 640;    // 顶点细分（2400/640 ≈ 3.75m/段）
```

**跟我方对照**：
- 我方 R32 收紧浪幅、降低饱和度（"克制"）
- coastal_3d 浪幅更大、近场范围 2400m → 视觉效果"更海"
- **可借鉴**：近场高密度海面段（3~4m/段）+ 浪尖镜面/泡沫 = R35 月光镜面的视觉目标

---

## 7. 架构图（mental model）

```
coastal_3d 架构
══════════════
   noise (CPU/GPU)        ←  Simplex2D + fbm
       │
       ▼
   heightmap (CPU)        ←  coastRaw 零集 + EDT + HeightField
       │
       ├────► DataTexture (R, Float)  ──►  GPU heightmap sampler
       │                                        │
       │                                        ├──► terrain.vsh  (vDepth)
       │                                        ├──► ocean.vsh    (vDepth/vCrest)
       │                                        └──► grass.vsh    (height sample)
       │
       ▼
   terrain.ts / ocean.ts  ←  几何 + 着色器 + 雾
       │
       ▼
   world.ts               ←  编排：相机 + 太阳 + 雾 + 实例化
       │
       ▼
   App.tsx                ←  入口 + GUI + 后期
```

跟我方 R32-R35 高度同构，差异在：
1. 海岸距离**真 EDT vs 闭式**
2. 高度数据**GPU 纹理 vs CPU 函数**
3. 框架**raw Three.js vs R3F**

---

## 8. 总结：可借鉴 vs 不借鉴

### ✅ 值得借鉴

1. **EDT 真距离**（如未来岬湾尺度 > 1km 必须切）
2. **warp 坐标扭曲**（fbm 偏移 130m 防 90° 对称感）→ 我方 R32 没用，可能 R35+ 引入
3. **极坐标多频 sin**（3/5/9 θ）做海岸 → 我方用 fbm 叠加，可考虑替换为极坐标 sin 框架
4. **生物群系软阈值 smoothstep**（已部分借鉴）
5. **近场海面高密度段**（3~4m/段）→ R35 月光镜面的视觉基础

### ❌ 不必借鉴

1. **raw Three.js 风格**（R3F 更适合我方 React 主体）
2. **DataTexture + GPU 高度采样**（我方 R32 CPU 函数已自检 60/71，重构风险大）
3. **mergeGeometries + InstancedMesh 植被**（我方 farmSim 已用不同方案）

---

## 9. 行动项

- [ ] R35+ 引入 **warp 坐标扭曲**（cheap win, 1~2 行代码）
- [ ] R36+ 评估 **EDT 替换闭式**（成本高，仅在出现视觉失真时）
- [ ] R35+ 用 **极坐标 sin(3/5/9 θ) 框架** 重写 wobN/wobW（更可控）
- [x] 保留 **coastal_3d{,_v2} 源码** 作为参考（已完成解包）
- [x] 写**提示词**复刻 R32-R34 cherry-pick 路径（见 `twin/docs/research/R32-R34-改造提示词.md`）
