/* oxlint-disable react/immutability -- 对 three scene/pmrem 的外部系统同步（docs/08 D2） */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

// 离线环境反射：RoomEnvironment 本地生成 PMREM（不发任何外部请求）
// 冷白机身靠它出漆水质感
export default function EnvSetup() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.06)
    scene.environment = env.texture
    scene.environmentIntensity = 0.42 // 夜场压暗，只取高光走向
    return () => {
      scene.environment = null
      env.texture.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  return null
}
