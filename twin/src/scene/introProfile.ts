import * as THREE from 'three'
import { FARM } from './terrainUtil.ts'

// ============================================================================
// 开场巡航路径与速度剖面真值源
// ============================================================================

export const CAMERA_NODES = [
  new THREE.Vector3(-100, 1450, 250), // 0: 高空起始点：高空俯瞰全场
  new THREE.Vector3(-100, 850, 80),   // 1: 平滑俯冲
  new THREE.Vector3(-100, 360, -100), // 2: 掠过场区低空
  new THREE.Vector3(-100, 320, 150),  // 3: 抬头拉开
  new THREE.Vector3(-80, 380, 450),   // 4: 进全景过渡段
  new THREE.Vector3(-20, 440, 750),   // 5: 进全景过渡段
  new THREE.Vector3(60, 480, 990),    // 6: 全景构图机位
  new THREE.Vector3(120, 470, 900),   // 7: 全景缓行
  new THREE.Vector3(FARM[2].x + 145, 210, FARM[2].z - 160), // 8: 快速前推至 T03
  new THREE.Vector3(FARM[2].x + 160, 220, FARM[2].z - 110), // 9: T03 处转头
  new THREE.Vector3(FARM[4].x + 100, 130, FARM[4].z + 105), // 10: 沿对角线穿 T05
  new THREE.Vector3(FARM[6].x + 145, 86, FARM[6].z + 120),  // 11: 接近 T07
  new THREE.Vector3(FARM[6].x + 76, 56, FARM[6].z + 168),   // 12: T07 前低机位终点
]

export const LOOK_NODES = [
  new THREE.Vector3(0, 22, -340),     // 0: 全景重心
  new THREE.Vector3(0, 22, -340),     // 1: 全景重心
  new THREE.Vector3(0, 22, -340),     // 2: 全景重心
  new THREE.Vector3(0, 22, -340),     // 3: 全景重心
  new THREE.Vector3(0, 22, -340),     // 4: 全景重心
  new THREE.Vector3(0, 22, -340),     // 5: 全景中心
  new THREE.Vector3(0, 22, -340),     // 6: 全景中心 (CAM.target)
  new THREE.Vector3(0, 22, -340),     // 7: 全景中心
  new THREE.Vector3(FARM[2].x, 96, FARM[2].z), // 8: T03
  new THREE.Vector3(FARM[4].x, 96, FARM[4].z), // 9: T05
  new THREE.Vector3(FARM[6].x, 98, FARM[6].z), // 10: T07
  new THREE.Vector3(FARM[6].x, 96, FARM[6].z), // 11: T07
  new THREE.Vector3(FARM[6].x, 92, FARM[6].z), // 12: T07
]

export const CAMERA_PATH = new THREE.CatmullRomCurve3(CAMERA_NODES, false, 'centripetal', 0.38)
export const LOOK_PATH = new THREE.CatmullRomCurve3(LOOK_NODES, false, 'centripetal', 0.38)
export const INTRO_END = 34

export interface IntroSample {
  frac: number
  t: number
  speed: number
  fov: number
}

export function buildIntroProfile(
  path: THREE.CatmullRomCurve3,
  totalDur: number,
  _vCruise?: number,
  _vMin?: number,
  _vMax?: number,
  _boostPts?: ReadonlyArray<readonly [number, number]>,
) {
  const len = path.getLength()
  const vMean = len / totalDur
  const lookup = (t: number): IntroSample => {
    const k = Math.min(1, Math.max(0, t / totalDur))
    const frac = k * k * (3 - 2 * k)
    const speed = vMean * (6 * k * (1 - k))
    return {
      frac,
      t,
      speed,
      fov: 52 - 5 * frac,
    }
  }

  return {
    lookup,
    vExit: 100,
    exitTangent: path.getTangent(1),
    vMin: 40,
    vMax: 350,
    stats: {
      len,
      vMean,
      totalTime: totalDur,
      rawDur: totalDur,
      scale: 1,
      vMin: 40,
      vMax: 350,
      turns: 0,
      bankMaxDeg: 0,
      maxCurve: 0.05,
    },
  }
}

export const BOOST_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0.00, 1.0],
  [1.00, 1.0],
]
