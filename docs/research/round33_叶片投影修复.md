# round33 · 叶片接地投影修复（「大软圆盘」→ 3 条清晰射线）

> 分支 `arena/01a066ee-dachuang-szls`，2026-09-03。承接 round31 移交项（叶片投影）。

## 一、背景

round31 把接地投影并入风机自身（真实转子矩阵取叶尖世界坐标 → 投影到地面），
塔影带 + 接地盘形态正确，但**叶片影被停用**（`ENABLE_BLADE_SHADOW = false`），
移交原因是：3 条影带（`PlaneGeometry 2.2m 宽 × 最长 100m`）+ `shadowTex` 的
宽度衰减叠加后，从低角/俯视会「绕成一个**大软圆盘**」，而非 3 条清晰射线。

本轮复核根因并修复，叶片投影重新启用。

## 二、根因复核（对 round31 两条假设的裁决）

| 假设 | 裁决 | 结论 |
|---|---|---|
| 纹理宽度羽化是主因 | ✅ 成立 | `shadowTex` 在 2.2m 宽度上全程 `pow(1-\|u\|/wf, 2.2)`，**无硬核** → 每条影带都是一整条软梯度；3 条随转子旋转叠加，糊成软盘。 |
| `orientShadow` 的 basis 方向错误 | ⚠️ 部分成立 | `makeBasis(_shadowRight,_shadowDir,_shadowUp)` 配 `_shadowRight=cross(up,dir)` 实为**左手系**（`right×dir=-up`）。影带几何关于长轴对称，视觉无差，但属方向性错误，本轮一并纠正为右手系。 |

补充结论：三条叶片影在低角太阳下「同向扇形」、高角太阳下「近似 120° 星形」是
真实风机影的物理行为（详见 §四），并非 bug；要修的只是「软 → 糊成盘」。

## 三、改动（`twin/src/scene/HoloTurbine.tsx`）

1. **几何改梯形面**：叶片影由等宽平面改为「根部宽 → 尖端窄」的 `BufferGeometry`
   梯形面（根半宽 2.6m → 尖半宽 1.0m，UV 0–1），贴真实叶片弦向渐缩。
   半宽略大于真实弦向是刻意为之：本场景为全息示意、塔影带宽 14m，影带需在远景
   仍可读，但明显细于塔影，避免再糊成盘。
2. **新增 `bladeShadowTex`**：独立于塔影的硬核纹理——横截面中心 55% 全 alpha、
   仅边缘窄羽化；沿长轴 `pow(1-v,1.6)` 衰减（根亮尖灭）。塔影仍用原 `shadowTex`
   （形态已被 round31 认可，零回归）。
3. **`orientShadow` 改右手系**：`_shadowRight = cross(dir, up)`（原 `cross(up, dir)`），
   `right×dir=+up`。
4. **影带长度完整投影**：不再按 0.7 系数截断，按 `t=(P.y-g)/sun.y` 完整投影，
   上限 175m 与塔影一致。
5. **重新启用** `ENABLE_BLADE_SHADOW = true`。
6. 每帧用预分配向量 `_tipWorld`，去掉旧代码 `getWorldPosition(new THREE.Vector3())`
   的每帧 ×3×9 次 GC 分配。

另：`twin/src/App.tsx` 的调试钩子新增 `window.__aeolus_scene = scene`（`debugEnabled()`
门内，与既有 `__aeolus_cam`/`__aeolus_stats` 同族），供无头 QA 遍历场景取证
（旧 `probe.mjs` 依赖的 `window.__getRotorTips` 已随 round31 的 rotorShadowBus 删除而失效，
未来可用此钩子重写探针）。

## 四、验证证据

### 1) 几何探针（无头，直接读场景 mesh 世界位姿，无动画噪声）

在 `t=16.5`（太阳方位 WSW、仰角 12.6°）下遍历场景，9 机各 3 条叶片影 mesh：

- **全部可见、贴地**：世界 Y = 基座 Y + 0.6~0.7（±0.02 分层防 z-fighting）；
- **长度物理正确**：三条 = 175m / 81m / 175m（仰角 12.6° 下「上叶长影/水平叶短影/
  下叶长影」，175 为与塔影一致的上限截断）；
- **轴向沿投影方向**：上叶 ≈ (0.989,0,-0.147)、水平叶 ≈ (0.93,0,-0.367)、
  下叶 ≈ (-0.964,0,0.267)，与 `sunDir=(-0.949,0.218,0.228)` 的 `-sun` 地面投影一致；
- 低角太阳下三影同向扇形、高角太阳（正午 54°）下趋近 120° 星形——真实风机影行为。

### 2) 工程校验

- `npm run build`：0 错误；
- `npm run lint`：0 警告 0 错误；
- `npm run selftest`：37/37 通过（无回归）；
- 无头加载（hero 机位）console：0 error / 0 warning / 0 pageerror。

### 3) 证据截图（`twin/docs/research/shots/`）

| 场景 | 文件 | 说明 |
|---|---|---|
| 下午 hero | `r33_blade_hero_afternoon.png` | `t=15.5`：全场风机可见塔影带 + 叶片射线，无软盘 |
| 正午俯视单机 | `r33_blade_noon_topdown.png` | `t=11.5` 单机俯视：接地盘 + 塔影 + 3 条叶片射线，轮廓清晰 |
| 下午俯视 | `r33_blade_afternoon_topdown.png` | `t=16.5` 低角太阳：影带拉长成同向扇形（物理正确） |

## 五、涉及文件

- `twin/src/scene/HoloTurbine.tsx`：叶片影几何/纹理/朝向/启用（核心）；
- `twin/src/App.tsx`：调试钩子 `__aeolus_scene`（1 行）；
- `twin/docs/research/shots/r33_*.png`：3 张证据截图；
- `docs/research/round33_叶片投影修复.md`：本文。
