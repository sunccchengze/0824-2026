import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSim, farmFrameNow } from '../state/simStore'
import { FARM, SERVOS, terrainHeight } from './terrainUtil'
import HoloTurbine from './HoloTurbine'
import { pushFarmFrame } from './frameBus'

// ============================================================================
// 9 机阵列 + 闭环联动
//  · 数据契约帧（farmFrame）每帧只求值一次，推给所有 HoloTurbine；
//  · 点击拾取：onPointerDown 选中机组（矩阵 ↔ 场景 ↔ 信息卡三方联动）；
//  · 偏航/转速/状态不再由 props 驱动 React —— 3D 直读同一帧（A5 修复）。
// ============================================================================

export default function TurbineField() {
  const setSelected = useSim((s) => s.setSelected)
  const selected = useSim((s) => s.selected)

  useEffect(() => {
    pushFarmFrame(farmFrameNow())
  }, [])

  useFrame(() => {
    pushFarmFrame(farmFrameNow())
  })

  return (
    <group>
      {FARM.map((u, i) => {
        const servoIdx = SERVOS.indexOf(i)
        return (
          <group
            key={u.id}
            onPointerDown={(e) => {
              e.stopPropagation()
              setSelected(selected === i ? null : i)
            }}
          >
            <HoloTurbine
              idx={i}
              x={u.x}
              z={u.z}
              y={terrainHeight(u.x, u.z)}
              servo={servoIdx >= 0 || selected === i}
            />
          </group>
        )
      })}
    </group>
  )
}
