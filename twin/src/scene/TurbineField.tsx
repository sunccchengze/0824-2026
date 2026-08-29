import { useMemo } from 'react'
import { useSim } from '../state/simStore'
import { makeAlarms, simulate } from '../state/simCore'
import { FARM, terrainHeight } from './terrainUtil'
import HoloTurbine from './HoloTurbine'

// ============================================================================
// 真实 NREL 5MW 几何 × 全息材质 × 演示仿真联动
// 每台机组的偏航角/转速/告警色环均来自 simCore 快照：
//   · AUTO 模式：系统按目标功率解算 9 机偏航角并实时下发（含未挂滑杆的 4 台）；
//   · 手动模式：5 路偏航执行器滑杆驱动对应机组（terrainUtil.SERVOS 唯一映射）；
//   · 转速随风速物理映射（B8），尾流沿 南→北 列向传递。
// ============================================================================

export default function TurbineField() {
  const servos = useSim((s) => s.servos)
  const auto = useSim((s) => s.auto)
  const targetMW = useSim((s) => s.targetMW)
  // 粗粒度时间（3 分钟游戏刻），避免逐帧重解
  const tH = useSim((s) => Math.floor(s.tHours * 20) / 20)

  const snap = useMemo(() => simulate(servos, auto, targetMW, tH), [servos, auto, targetMW, tH])
  const alarms = useMemo(() => makeAlarms(snap, servos), [snap, servos])
  const alarmed = useMemo(() => {
    const set = new Set<string>()
    for (const a of alarms) if (a.level === 'warn' && a.tid) set.add(a.tid)
    return set
  }, [alarms])

  return (
    <group>
      {FARM.map((u, i) => {
        const t = snap.units[i]
        return (
          <HoloTurbine
            key={u.id}
            x={u.x}
            z={u.z}
            y={terrainHeight(u.x, u.z)}
            yawDeg={t.yawDeg}
            rpmRadS={t.rpmRadS}
            alarmed={alarmed.has(u.id)}
          />
        )
      })}
    </group>
  )
}
