# 第 28 轮 · 3A 画面提升（白天投影 B1 / 夜晚生机 B2）

> 真值源 + 交付记录。接手前先读这里。
> 分支：`arena/01a0584c-0824-2026`（本会话）
> 用户需求（截图对照）：① 白天任何角度都能看到风机在地面上的**明显**投影；② 夜晚太冷清死寂，要有"生机/活跃"。

## B1 · 白天投影 —— ✅ 已完成（本会话）

### 结论（为什么之前一直"看不到"）
两次根因，都实测定位（非猜）：

1. **真实 shadow-map 管线不可靠**（前任已确认）：地面是自定义 shader + 强补光 + 深色
   albedo，测试柱无影。故改走**确定性"接地影带"**（无 shadow-map 依赖）。
2. **普通 alpha 叠加"近黑片"在本场景对比度趋零**：地面 albedo 本身很暗，再叠近黑
   贴片 → 前后帧差几乎为 0（v1 全帧截图不可见的直接原因，A/B 帧差实测证实）。

**正解 = 乘法混合（MultiplyBlending）相对压暗**：`result = dst·(1−a)`，影带与地面
明度解耦——近处暗地、远处雾亮地、亮棱面，对比一致且纹理/雾色自然保留，无"黑补丁"。

### ⚠ 关键坑（three r185，必须记住）
`MultiplyBlending` **要求 `material.premultipliedAlpha = true`**，否则
`WebGLState.setBlending` 走 `error()` 分支 → **静默回退到上一次混合状态（普通叠加）**，
不抛异常、不报 lint，肉眼/帧差都难发现。曾因此白调一整轮 A/B。
（证据链见下；修复后帧差 P10 压暗 44%→实测核心 92%。）

### 实现（`twin/src/scene/GroundShadows.tsx`，独立组件，9 机共享两份几何）
- 方向 = 太阳水平方位反方向（`skyState.sunDir`，与 LightRig 同口径）。
- 长度 = `150 / tan(仰角)`，钳 [150, 280]m（正午短、晨昏长；下限 150 为观感裁决）。
- 形状 = 塔影窄条 + 轮毂处风轮弥散光斑 + 3 道叶影细线（随各机 rpm 慢转）。
- **贴地 = 逐顶点采样 `terrainSurfaceY`**（地形静态，每帧 ~1.2k 次纯数学调用）→
  影带严格贴起伏走，杜绝 v1"悬浮三角块"。`depthTest:false` 仅作掠射角保险。
- 可见性只由 `dayF` 驱动 → 全天清晰、入夜淡出（`dayF<0.012` 整组隐藏）。
- 顶点 4 分量颜色（USE_COLOR_ALPHA）做沿程/横向柔边；关雾（强度与距离无关）。
- 成本：+18 draw call（9 影带 + 9 叶影扇），无后期成本，CPU 可忽略。

### 验证证据（`docs/research/shots/r28-shadow-*`）
| 帧 | 机位 | 结论 |
|---|---|---|
| `r28-shadow-off-noon-wide` | 正午 广角 | 修前：地面**无**投影（v1 黑片不可见）|
| `r28-shadow-on-noon-wide` | 正午 广角 | 修后：每台风机向太阳反方向投出**清晰**影带 |
| `r28-shadow-on-noon-close` | 正午 近景 | 塔基深、向远处渐隐，贴起伏 |
| `r28-shadow-on-morning` | 07:00  | 晨影**长**且明显（物理正确：低仰角长影）|
| `r28-shadow-on-dusk` | 17:00 | 暮影长、暖调，明显 |
| `r28-shadow-night-off` | 22:00 | 夜晚 `dayF=0` 影带**关闭**（探针确认）|

探针（`?debug=1` → `window.__aeolus_shadows()`）：
- 正午 `t=12`：`dayF=1, L=150, stripOpacity=0.72, rootVisible=true`
- 夜晚 `t=22`：`dayF=0, rootVisible=false, alpha=0`

### 复现/自检
```bash
cd twin
npm run build && npm run lint && npm run selftest   # 全绿
npm run dev -- --host 0.0.0.0
# 截图（无头）：
node scripts/shot.mjs "http://127.0.0.1:5174/?debug=1&t=12&intro=0&cam=15,8,760,0,22,-340" out.png 9000
node scripts/shot.mjs "http://127.0.0.1:5174/?debug=1&t=12&intro=0&cam=15,8,760,0,22,-340&shoff=1" out_off.png 9000
# A/B 帧差（PIL/numpy 已装）：对比 on/off 亮度比
```
调试开关：`?shoff=1` 强制关影带（仅 debug 生效，A/B 用）；`?t=<h>` 锁时钟。

## B2 · 夜晚生机 —— ⬜ 未开始（下一步）
用户：夜晚"冷清死寂、无变化"，要"生机/活跃"。候选（克制、不霓虹，守住全息线稿红线）：
1. 风机顶部**航空障碍灯**夜间慢闪（HoloTurbine 已有 beacon，需确认夜间增强）。
2. 极光/星辉**呼吸**（SkyAurora 幅度/亮度低频调制）。
3. 地面**波前呼吸**（WorldTerrain 棱面明度极缓慢起伏）。
4. 夜间**风痕微光**（WindVeil 夜间微亮拖尾）。
先截夜晚基线 + 定位"死寂"具体缺什么（星？光？动？），再逐项小步 + 截图 + commit。

## 进度日志
- 2026-08-31：接手 01a0529f 未提交 WIP（`GroundShadows.tsx` v1 未提交、崩溃在"正午影不可见"）。
  定位两次根因（shadow-map 不可靠 + 近黑片对比度趋零）→ 改 MultiplyBlending + 逐顶点贴地，
  修复 r185 `premultipliedAlpha` 静默回退坑 → B1 完成，5 帧证据 + 探针验证，build/lint/selftest 全绿。
- 下一步：B2 夜晚生机。
