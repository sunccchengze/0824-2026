# AEOLUS TWIN — 风电场 3A 数字孪生大屏

> 用户原图「未来能源数字孪生系统」的像素级还原实现（1920×1080 大屏）。
> 场景：NREL 5MW 真实几何已经统一透明化、线条化为纯白全息风电场；不再提供全息/写实二选一。

## 技术栈
Vite 8 + React 19 + TS + three 0.185 + R3F 9 + drei + @react-three/postprocessing + zustand。
中文字体内嵌 @fontsource/noto-sans-sc；数字 @fontsource/rajdhani / orbitron / share-tech-mono。

## 运行
```bash
npm install
npm run dev        # http://localhost:5173/
npm run build      # tsc -b && vite build → dist/
node scripts/shot.mjs <url> <out.png> [waitMs] [w] [h]   # 离屏自拍（沙箱自编译 NSS/NSPR + SwiftShader）
```
> 离屏截图依赖 `/tmp/nsslibs`（本沙箱手工编译的 NSS/NSPR）；真机/GPU 无此需求。

## 结构
```
src/
  App.tsx                场景装配 + 相机 + 后期链
  state/simStore.ts      舵机 5 路 / 时间轴 / 报警 / 矩阵
  hud/Hud.tsx            大屏 HUD（1920×1080 等比舞台）
  styles/theme.css       全套皮肤
  scene/
    terrainUtil.ts       世界真值源（地形/机位/升压站/锚点）
    HoloTurbine.tsx      NREL 5MW 真实几何的透明纯白线框全息化
    turbine/geometry.ts  NREL 5MW 参数化真实几何
    TurbineField.tsx     9 机阵列 + 舵机联动（统一全息）
    CableNetwork.tsx     三股电缆 + 河床辉光 + 晶粒 + 外送线束
    Substation.tsx       玻璃升压站
    SkyAurora/WorldTerrain/SparkleGround/WindVeil/Callouts/CameraRig/Effects
```

## 与原图口径差异（演示数据，非 FLORIS 求解）
| 原图 | 现实现 |
|---|---|
| 479,731 MWh / 48.20 Hz / 19 | 按原图逐字复刻（DEMO） |
| 导颈舵机1-5 = -10° | 5 路滑杆可拖，联动 3D 机组偏航 |
| NPI 70/99/92% | 复刻原图（真值口径见 docs/03） |
| 报警 22-23 分钟前 | 演示流水，随播放递增 |
