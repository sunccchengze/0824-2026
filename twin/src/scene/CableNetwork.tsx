import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, SUBSTATION, terrainHeight } from './terrainUtil'

const C_CABLE = new THREE.Color(0.22, 0.8, 1.25)
const C_PULSE = new THREE.Color(0.55, 1.5, 1.95)

// W8 冰河集电：每机 3 股贴地电缆束 → 升压站；脉冲光点沿线流动
export default function CableNetwork() {
  const pulses = useRef<THREE.InstancedMesh>(null!)
  const { tubes, curves, pulseMat, pulseGeo } = useMemo(() => {
    const cableMat = new THREE.MeshBasicMaterial({ color: C_CABLE, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    const pulseMat = new THREE.MeshBasicMaterial({ color: C_PULSE, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    const pulseGeo = new THREE.SphereGeometry(1.7, 8, 8)
    const tubes: THREE.Mesh[] = []
    const curves: THREE.CatmullRomCurve3[] = []
    FARM.forEach((u, idx) => {
      const sx = u.x, sz = u.z
      const ex = SUBSTATION.x - 60 + (idx % 3) * 52
      const ez = SUBSTATION.z - 40 + Math.floor(idx / 3) * 40
      const mx = (sx + ex) / 2 + (idx % 2 ? 40 : -40)
      const mz = (sz + ez) / 2 + (idx % 3 === 1 ? 60 : -30)
      for (let s = -1; s <= 1; s++) {
        const px = -((ez - sz) / 200) * s * 1.5
        const pz = ((ex - sx) / 200) * s * 1.5
        const pts = [
          new THREE.Vector3(sx + px, terrainHeight(sx, sz) + 1.2, sz + pz),
          new THREE.Vector3((mx + sx) / 2 + px, terrainHeight((mx + sx) / 2, (mz + sz) / 2) + 1.4, (mz + sz) / 2 + pz),
          new THREE.Vector3(mx + px, terrainHeight(mx, mz) + 1.6, mz + pz),
          new THREE.Vector3((mx + ex) / 2 + px, terrainHeight((mx + ex) / 2, (mz + ez) / 2) + 1.4, (mz + ez) / 2 + pz),
          new THREE.Vector3(ex + px, terrainHeight(ex, ez) + 2.2, ez + pz),
        ]
        const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35)
        const geo = new THREE.TubeGeometry(curve, 72, 0.55, 6, false)
        const mesh = new THREE.Mesh(geo, cableMat)
        mesh.frustumCulled = true
        tubes.push(mesh)
        if (s === 0) curves.push(curve)
      }
    })
    return { tubes, curves, cableMat, pulseMat, pulseGeo }
  }, [])

  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame((s) => {
    const im = pulses.current
    if (!im) return
    let k = 0
    const per = 5
    for (let i = 0; i < curves.length; i++) {
      const c = curves[i]
      for (let j = 0; j < per; j++) {
        const t = (s.clock.elapsedTime * 0.09 + j / per + i * 0.045) % 1
        const p = c.getPoint(t)
        dummy.position.set(p.x, p.y + 0.4, p.z)
        const sc = 0.75 + 0.25 * Math.sin((t * Math.PI * 2 + j) * 2)
        dummy.scale.setScalar(sc)
        dummy.updateMatrix()
        im.setMatrixAt(k++, dummy.matrix)
      }
    }
    im.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      {tubes.map((m, i) => <primitive key={i} object={m} />)}
      <instancedMesh ref={pulses} args={[pulseGeo, pulseMat, FARM.length * 5]} frustumCulled={false} />
    </group>
  )
}
