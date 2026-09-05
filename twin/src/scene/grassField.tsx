import { useMemo } from 'react'
import * as THREE from 'three'

// R33 v15 · sphere 复测（控制组）
export default function GrassField() {
  const sphere = useMemo(() => {
    const g = new THREE.SphereGeometry(50, 32, 16)
    const m = new THREE.MeshBasicMaterial({ color: 0xff0000 })
    const mesh = new THREE.Mesh(g, m)
    mesh.position.set(0, 50, 0)
    return mesh
  }, [])

  return <primitive object={sphere} />
}
