/* 天光共享状态：LightRig 每帧写入，SkyAurora/Effects 读取。
 * 只读旁路，不触发 React 渲染（帧循环内 mutate 为既定模式，docs/08 D2）。 */
import * as THREE from 'three'
export const skyState = {
  dayF: 0,
  sunDir: new THREE.Vector3(0, 1, 0),
  moonDir: new THREE.Vector3(0, 1, 0),
}
