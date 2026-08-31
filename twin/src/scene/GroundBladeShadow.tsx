import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSim } from '../state/simStore'

/**
 * 确定性的接地投影：地形使用自定义着色/起伏网格，真实阴影在不同 GPU 上
 * 不稳定，因此用一张柔边的接地纹理表达塔影和叶影。它不是物理测量数据。
 */
export default function GroundBladeShadow({ x, z, y }: { x: number; z: number; y: number }) {
  const mesh = useRef<THREE.Mesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)
  const tHours = useSim((s) => s.tHours)
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createLinearGradient(0, 0, 256, 0)
    gradient.addColorStop(0, 'rgba(1, 5, 8, .62)')
    gradient.addColorStop(0.12, 'rgba(1, 5, 8, .42)')
    gradient.addColorStop(0.72, 'rgba(1, 5, 8, .16)')
    gradient.addColorStop(1, 'rgba(1, 5, 8, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 256, 64)
    // 一条细叶影，避免形状退化成规则矩形。
    ctx.strokeStyle = 'rgba(1, 5, 8, .38)'
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(34, 32); ctx.lineTo(226, 15); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(34, 32); ctx.lineTo(226, 49); ctx.stroke()
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [])

  useFrame(() => {
    if (!mesh.current || !material.current) return
    const daylight = Math.max(0, Math.sin(((tHours - 5) / 14) * Math.PI))
    // 从南侧光线开始，太阳方向全天连续旋转；中午仍保留可读的短影。
    const azimuth = ((tHours - 6) / 12) * Math.PI - Math.PI / 2
    const length = 34 + 30 * (1 - daylight) + 12
    mesh.current.position.set(x + Math.cos(azimuth) * length / 2, y + 0.85, z - Math.sin(azimuth) * length / 2)
    mesh.current.rotation.set(-Math.PI / 2, 0, azimuth)
    mesh.current.scale.set(length, 9 + daylight * 3, 1)
    material.current.opacity = daylight > 0.01 ? 0.72 : 0
  })

  return (
    <mesh ref={mesh} position={[x, y + 0.85, z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={0}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial ref={material} map={texture} transparent depthWrite={false} depthTest={false} toneMapped={false} />
    </mesh>
  )
}
