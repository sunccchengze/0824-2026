# AEOLUS TWIN — 风电流场智能感知与调控 · 数字孪生大屏

> 1920×1080 大屏数字孪生：9×NREL 5MW 纯白全息风电场 + 集电网络 + 风掩流线 + 全联动 HUD。
> 所有数值为**浏览器端确定性演示代理**（`simCore.ts`），不是实测/FLORIS/SCADA；HUD 常驻 `演示数据 DEMO` 标注。

## 技术栈
Vite 8 + React 19 + TS + three 0.185 + R3F 9 + drei + @react-three/postprocessing + zustand。
中文字体 @fontsource/noto-sans-sc（已打进 `--font-num` 兜底链）；数字 @fontsource/rajdhani / share-tech-mono。

## 运行
```bash
npm install
npm run dev        # http://localhost:5173/
npm run build      # tsc -b && vite build → dist/
npx oxlint         # 0 error（9 warning 均为 three/R3F 惯用法误报，见 docs/08 §六）
```

## 验证脚本（沙箱自编译 NSS/NSPR → /tmp/nsslibs）
```bash
node scripts/shot.mjs <url> <out.png> [waitMs] [w] [h]   # 离屏自拍（SwiftShader）
node scripts/info.mjs <url> [waitMs] [sampleMs]          # draw calls / triangles 探针（依赖 window.__aeolus）
node scripts/interact.mjs <out.png>                      # 交互联动取证：滑杆/AUTO/报警/播放暂停
python3 ../scripts/abdiff.py a.png b.png                 # A/B 像素差分
```
调试参数：`?cam=az,el,dist[,tx,ty,tz]` 固定机位（仅 dev）；`?noveil` 关风掩（仅 dev，配合 abdiff）。

## 结构
```
src/
  App.tsx                舞台装配：Canvas/后期链/boot 幕/fatal 卡片/__aeolus 探针
  state/simCore.ts       确定性演示模型：风速日曲线 / Jensen 尾流链 / 偏航-出力 / AUTO 解算器 / AGC 限发 / 报警流
  state/simStore.ts      zustand 状态：servos(5 路) / targetMW / auto / playing / tH
  hud/Hud.tsx            大屏 HUD：KPI/三环/矩阵/雷达/图表/偏航滑杆/报警/时间轴（全部数值来自 simulate 快照）
  styles/theme.css       冰青设计系统皮肤（docs/04）
  scene/
    terrainUtil.ts       世界真值：FARM 机位 / SERVOS / CAM / 锚点 / terrainHeight
    turbine/geometry.ts  NREL 5MW 参数化几何（nacelle/叶片翼型/锥筒塔架）
    HoloTurbine.tsx      纯白全息四层渲染（深度壳/线框/软晕/亮核），视角无关亮度
    TurbineField.tsx     9 机阵列， yaw/转速/基座环随 simulate 快照联动
    CableNetwork.tsx     9 机串接链 + 升压站 + 干线 + 外送（Line2）
    WindVeil.tsx         2564 粒子南→北风掩（CPU 样条 + instanced 飘带）
    Substation/Callouts/SkyAurora/WorldTerrain/SparkleGround/CameraRig/Effects
scripts/shot.mjs / info.mjs / interact.mjs
```

## 数据口径（与 docs/08 §九一致）
| 类别 | 内容 |
|---|---|
| 真实 | NREL 5MW 公开几何参数；50Hz 常识帧 |
| 确定性演示 | simCore 全部产物：功率/尾流/偏航解算/频率/无功/累计电量/报警。同一输入同一输出 |
| 示意几何 | 地形、升压站、集电拓扑、风资源场图标 |

联动语义：AUTO 开=偏航解算器跟踪目标功率（超限如实报偏差）；AUTO 关=目标功率作为 AGC 限发指令；偏航滑杆（手动态）直接驱动对应机组 yaws 与 3D 朝向；矩阵点/基座环与 units 快照同源。
