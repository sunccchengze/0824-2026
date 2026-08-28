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
