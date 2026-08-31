# WORK-IN-PROGRESS（已完成）

## 当前状态（2026-08-31 终版）

- 分支：`arena/01a058c7-0824-2026`（承接 `01a0529f`）
- 已完成：
  - B1 白天影子：GroundShadows 确定性接地投影，外层 34m + 内层 18m disc + 28m 软影 + 14m 核心，长度 32-175m，透明度 0.62-0.97，任何角度可见，夜淡出
  - B2 夜晚生机：beacon 双晕 + 点光 8-22 强度、sparkle 亮度/尺寸/频率夜增、极光呼吸+第三层高亮星、地形 glow 夜 0.18-0.30 呼吸、NightPulse 地面脉动 18-28m、升压站点光 12/7
  - LightRig 对比度：hemi 0.32+0.12fd，补光夜控
- 验证：build ✓ / lint 0 / selftest 34 / qasmoke cam+stats / qa2 curtail 12MW + opt +36.9% / 截图 10 张 r28_*
- 提交：每小步 commit+push，协议遵守

## 截图证据
- r28_day_noon_shadow.png / r28_day_noon_v2.png：正午远景影子明显
- r28_day_morning_shadow.png：晨间长影
- r28_day_top_v2.png：俯视外层柔影
- r28_day_close_v2.png：近景接触盘
- r28_night_lively.png / r28_night_close_v2.png：夜间星光+脉动

## 后续
- 信标远景可再加大 Billboard
- 地面脉动可与电缆联动
- chunk 拆分优化
