import { useSim } from '../state/simStore'
import { FARM, SERVOS, terrainHeight } from './terrainUtil'
import HoloTurbine from './HoloTurbine'

// ============================================================================
// 真实 NREL 5MW 几何 × 全息材质
// 所有机组统一为“透明线条化全息像”，不再提供会破坏沉浸感的模式切换。
// 舵机仍与画面右侧 5 个控制条联动，真实影响对应机组偏航角。
// ============================================================================

export default function TurbineField() {
  const servos = useSim((s) => s.servos)

  return (
    <group>
      {FARM.map((u, i) => {
        const servoIdx = SERVOS.indexOf(i)
        const yawDeg = servoIdx >= 0 ? servos[servoIdx] : 0
        return (
          <HoloTurbine
            key={u.id}
            x={u.x}
            z={u.z}
            y={terrainHeight(u.x, u.z)}
            yawDeg={yawDeg + 8}
            speed={u.speed}
            servo={servoIdx >= 0}
          />
        )
      })}
    </group>
  )
}
