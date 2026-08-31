# WORK-IN-PROGRESS（agent 续跑必须读）

> 本文件是跨会话的“真值源”。任何 agent 下一次接手前先读这里；
> 做完一步就更新本文件并 commit+push。不要依赖对话记忆。

## 如何立即恢复环境（沙箱已重置时）

```bash
cd /home/user/0824-2026
git fetch --depth=60 origin arena/01a0529f-0824-2026
git reset --hard FETCH_HEAD        # 对齐远程最新，丢弃本地误回退
bash twin/scripts/bootstrap.sh     # npm install + 重建 /tmp/nsslibs + 触发 /tmp/chromium
cd twin && npm run dev -- --host 0.0.0.0   # 启动 dev（端口 5173）
```

## 工作协议（硬性，防止“卡死/失忆/丢进度”）

1. 每完成一个**可验证小块**：`npm run build && npm run lint && npm run selftest`
   通过后立刻 `git add <files> && git commit && git push`。**绝不攒大坨未提交改动。**
2. 每一步前先 `git fetch` + `git reset --hard FETCH_HEAD`，保证基于远程最新。
3. 状态、下一步、已确认结论写入本文件末尾的“进度日志”，并随当步一起提交。
4. 长阻塞操作（单次截图 >60s、长轮询、npm build 过长）拆开，避免平台超时。
5. 卡在同一步超过 2 次就停止，向用户如实说明，不无限重试。

## 当前远程权威状态

- 分支：`arena/01a0529f-0824-2026`
- 最新提交：`cc03b63 feat(anomaly): random daily SCADA anomaly with manual/auto repair workflow`
- 已知提交线：
  - `cc03b63` 异常系统（随机 24h 剧本 / 手动+10s 自动修复 / 弹窗 10s 关闭 / 丝滑动画）
  - `294cdb6` 开场中途跳过同步 OrbitControls + 去 GC 抖动
  - `47398f2` 1280 布局溢出 / 寻优文案诚实化 / 开场冻结 LightRig 时钟
  - `658614d` 开场冻结自适应画质（消除两次黑屏）
  - `425cd78` 借鉴 01a052ed 全局 ease 开场 + 修复最后交接突跃
  - 更早：round25 丝滑系列（a776e3a / 2d90a57 / 7885dc4 等）

## 用户需求（截图对照，按优先级）

### A. 异常系统（已于 cc03b63 完成）
- 每 24h 一次随机异常；等级/强度/发生时间/种类完全随机；每次打开页面都不同。
- UI“修复异常情况”按钮手动修复；10s 未点击自动修复。
- 修复后弹窗显示修复过程，弹窗 10s 自动关闭；丝滑弹动。
- 不做移动端，只做电脑端。
- 运行时已用脚本验证：触发→横幅→手动/自动弹窗→关闭 均通过。

### B. 3A 画面提升（**未完成，需重做**）
1. **白天影子太浅**：要求任何角度都能看到风机在地面上的明显投影。
   - 已分析根因：地面自定义 MeshStandardMaterial + 强补光 + emissive 冲淡阴影；
   - 之前探索过真实阴影管线（测试柱无影）、曾计划加“接地假影/贴地影盘”。
   - **未提交**，重置后丢失，需重做。
2. **夜晚太冷清死寂、无变化**：要求夜晚有“生机/活跃”。
   - 已部分实现/计划：风机顶部航空障碍灯夜间慢闪（HoloTurbine 已有 beacon 但需确认夜间增强）、
     极光/星辉呼吸、地面波前呼吸、夜间风痕微光。
   - **未提交**，重置后丢失，需重做。

## 进度日志

- 2026-08-31：建立本 WIP。对齐远程 `cc03b63`。异常系统已提交，无需重做。
- 下一步：先做 B1 白天影子（确定性接地投影/加深阴影），每步 build+截图+commit+push；再做 B2 夜晚生机。
