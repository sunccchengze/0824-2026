import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainHeight } from './terrainUtil'

const VERT = /* glsl */ `
attribute float aPhase;
attribute float aSize;
varying float vTwinkle;
varying vec3 vColor;
uniform float uTime;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.5 + 0.5 * sin(uTime * 1.4 + aPhase * 40.0);
  vTwinkle = tw;
  gl_PointSize = aSize * tw * (320.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`
const FRAG = /* glsl */ `
precision highp float;
varying float vTwinkle;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d) * vTwinkle;
  gl_FragColor = vec4(vColor * 1.55, a);
}
`

// W3 星光铺地：贴地采样 terrainHeight，分布于场区与电缆走廊上空
export default function SparkleGround({ count = 1100 }: { count?: number }) {
  const root = useRef<THREE.Points>(null!)
  const matRef = useRef<THREE.ShaderMaterial>(null!)
  const points = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3), phase = new Float32Array(count)
    const size = new Float32Array(count), col = new Float32Array(count * 3)
    const c1 = new THREE.Color('#5fd6ff'), c2 = new THREE.Color('#bfe9ff')
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(Math.random()) * 1280
      const a = Math.random() * Math.PI * 2
      const x = Math.cos(a) * r + 120, z = Math.sin(a) * r + 40
      pos[i * 3] = x
      pos[i * 3 + 1] = terrainHeight(x, z) + 1.0 + Math.random() * 3.2
      pos[i * 3 + 2] = z
      phase[i] = Math.random()
      size[i] = 1.5 + Math.random() * 3.0
      const c = Math.random() < 0.7 ? c1 : c2
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, vertexColors: true,
    })
    matRef.current = m
    const p = new THREE.Points(g, m)
    p.frustumCulled = false
    return p
  }, [count])

  useEffect(() => () => { points.geometry.dispose(); (points.material as THREE.Material).dispose() }, [points])
  useFrame((s) => { matRef.current.uniforms.uTime.value = s.clock.elapsedTime })
  return <primitive object={points} ref={root} />
}
