# 截图验货记录

- `r4_final_holo.png`：统一全息风机的上一版基线。
- `r5_holo_real_transparent_final.png`：R5，NREL 真实几何初版全息化（保留供对比）。
- `r6_holo_real_tinted.png`：R6，降低能量值与线框不透明度后的冰青版本，避免白色实体观感。
- `r7_white_no_turbine_bloom.png`：R7，按用户反馈改为纯白线条，并将风机从加色泛光路径中收回，远景保持清晰轮廓。
- `r9_extended_closeup_t07.png`：R9，开场巡航延长到约 28 秒，最终推进到 T07 近景以检查真实翼型线框。
- `r10_low_angle_closeup.png`：R10，终点改为低机位轻微仰视，主风机下半段自然出框，贴近用户参考构图。
- `r11_continuous_spline_intro.png`：R11，改为单条连续 Catmull-Rom 运镜轨迹，经过全景构图节点时不停顿，最终保持低机位轻微仰视。
- `r12_drone_aerial_showcase.png`：R12，加入正上方俯瞰、远处绕场、快速前推、机组间穿梭与机身侧倾节点，开场总长约 34 秒。
- `r17_no_bloom_white_edges.png`：R17，关闭 Bloom 后的开场帧，用于验证天空下半球无指数溢出白团、风机轮廓保持纯白。

截图脚本在沙箱中使用 SwiftShader；其边缘颗粒属于软件渲染伪影，真机 GPU 预览会更干净。

## v3 交付轮证据（2026-08-28，`?debug=1` 固定机位 + `&t=` 时刻锁定，可复现）
- `after_hero_1920.png`：P0 后基线，1920×1080，`?t=10.2&cam=0,22,990,0,22,-340`。对应"前"图：`w1_south_hero.png`。
- `after_az92_east.png` / `after_az272_west.png` / `after_az182_north.png`：三方位视角巡检（白线均亮 210–218，无变暗；docs/08 §〇）。
- `after_rotor_upwind_closeup.png` / `after_rotor_downwind_closeup.png`：A4 转子迎风近距对拍（北侧见叶盘正面，南侧见机舱尾锥）。
- `after_optimize.png`：E3/E6 联动闭环实拍——一键寻优后 5 路滑杆停在 −1.5…−33°、告警卡（偏航偏差超限·可定位）、功率 4.82→6.00MW（+24.3%）、wake 40.9→26.5%。
- `after_curtail_12mw.png`：研究内容③闭环——指令 12MW → total=12.00MW、9 机 curtail、DERATE 告警。
- `after_wake_veil_on.png` / `after_wake_veil_off.png`：同 t 同相位真 A/B（abdiff：31,457 显著像素，集中于轮毂高走廊与尾流羽带；粒子亮度 P50=122/P90=243）。
- `after_hero_noveil.png`：hero 机位关纱对照。
- `after_narrow_1280.png` / `after_mobile_390.png`：窄屏/竖屏适配（等比居中+竖屏提示条，无溢出）。
注：SwiftShader 软渲染边缘颗粒为沙箱伪影；真机 GPU 更干净。旧 `w*/r*` 图仍为各轮历史基线，未删除。
