// 全局地形高度场（世界/风机/星点/电缆共用同一函数，保证贴地一致）
function makeNoise(seed = 7) {
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 17.43) * 43758.5453
    return s - Math.floor(s)
  }
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const n2 = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = x - xi, yf = y - yi
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
    const u = smooth(xf), v = smooth(yf)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  return (x: number, y: number) => n2(x, y) * 0.68 + n2(x * 2.13 + 5.2, y * 2.13 + 1.3) * 0.32
}

const noise = makeNoise()
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function terrainHeight(x: number, z: number): number {
  let h = noise(x * 0.0016, z * 0.0016) * 20 - 7
  h += noise(x * 0.006, z * 0.006) * 3.2
  // 中央场区压平（风电场选址逻辑），远处保留丘陵
  const d = Math.sqrt(x * x + z * z)
  h *= 0.22 + 0.78 * smoothstep(420, 1150, d)
  // 左侧海岸下潜入海
  h -= smoothstep(-x, 460, 860) * 26
  return h
}

// 场景布局（全场唯一的机位真值源）
export interface FarmUnit { x: number; z: number; speed: number; yaw: number }
export const FARM: FarmUnit[] = (() => {
  const arr: FarmUnit[] = []
  let k = 0
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      arr.push({
        x: (c - 1) * 330 + (r % 2) * 26 - 30,
        z: (r - 1) * 340 - 20,
        speed: 1.05 + ((k * 37) % 5) * 0.09,
        yaw: Math.PI + (((k * 53) % 7) - 3) * 0.012,
      })
      k++
    }
  return arr
})()
export const SUBSTATION = { x: 680, z: 560 }
