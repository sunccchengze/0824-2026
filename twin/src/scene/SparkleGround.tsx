import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const VERT = /* glsl */ `
attribute float aPhase;
attribute float aSize;
varying float vTwinkle;
varying vec3 vColor;
uniform float uTime;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.55 + 0.45 * sin(uTime * 1.4 + aPhase * 40.0);
  vTwinkle = tw;
  gl_PointSize = aSize * tw * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`
const FRAG = /* glsl */ `
precision highp float;
varying float vTwinkle;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.06, d) * vTwinkle;
  gl_FragColor = vec4(vColor * 1.7, a);
}
`

// W3 星光铺地：约 900 个呼吸星点（蓝白随机）
export default function SparkleGround({ count = 900 }: { count?: number }) {
  const matRef = useRef<THREE.ShaderMaterial>(null!)
  const points = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    const phase = new Float32Array(count)
    const size = new Float32Array(count)
    const col = new Float32Array(count * 3)
    const c1 = new THREE.Color('#5fd6ff'), c2 = new THREE.Color('#eafcff')
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(Math.random()) * 1350
      const a = Math.random() * Math.PI * 2
      pos[i * 3] = Math.cos(a) * r + 60
      pos[i * 3 + 1] = 1.2 + Math.random() * 2.4
      pos[i * 3 + 2] = Math.sin(a) * r - 60
      phase[i] = Math.random()
      size[i] = 1.6 + Math.random() * 3.2
      const c = Math.random() < 0.72 ? c1 : c2
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    })
    const p = new THREE.Points(g, m)
    p.frustumCulled = false
    return p
  }, [count])

  useEffect(() => () => { points.geometry.dispose(); (points.material as THREE.Material).dispose() }, [points])
  useFrame((s) => { if (matRef.current) matRef.current.uniforms.uTime.value = s.clock.elapsedTime })
  return <primitive object={points} ref={(p: THREE.Points) => { if (p) matRef.current = p.material as THREE.ShaderMaterial }} />
}
