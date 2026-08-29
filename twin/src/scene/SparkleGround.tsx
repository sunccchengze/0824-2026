import { useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FARM, SUBSTATION, terrainHeight } from './terrainUtil'
import { rng } from '../state/simCore'

const VERT = /* glsl */ `
attribute float aPhase;
attribute float aSize;
varying float vTwinkle;
varying vec3 vColor;
uniform float uTime;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.42 + 0.58 * (0.5 + 0.5 * sin(uTime * 1.5 + aPhase * 40.0));
  vTwinkle = tw;
  gl_PointSize = min(aSize * tw * (600.0 / -mv.z), 7.5);
  gl_Position = projectionMatrix * mv;
}
`
const FRAG = /* glsl */ `
precision highp float;
varying float vTwinkle;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.08, d) * vTwinkle;
  gl_FragColor = vec4(vColor * 1.35, a * 0.75);
}
`

// W3 星光铺地：谷地 + 电缆走廊两处加密（基准图地面冰晶微光）
// 排布使用确定性随机源 rng(seed) —— 每次加载完全一致（可复现截图差分）。
export default function SparkleGround({ count = 5200 }: { count?: number }) {
  const { points, mat } = useMemo(() => {
    const rand = rng(20260823)
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3), phase = new Float32Array(count)
    const size = new Float32Array(count), col = new Float32Array(count * 3)
    const c1 = new THREE.Color('#6fd8ff'), c2 = new THREE.Color('#dcf4ff')
    for (let i = 0; i < count; i++) {
      let x: number, z: number
      if (i % 10 < 7) {
        // 谷地散布
        const r = Math.sqrt(rand()) * 1450
        const a = rand() * Math.PI * 2
        x = Math.cos(a) * r * 1.15 + 80
        z = Math.sin(a) * r * 0.95 - 60
      } else {
        // 电缆走廊加密：随机一台机 → 升压站连线上取点
        const u = FARM[(rand() * FARM.length) | 0]
        const t = rand()
        x = u.x + (SUBSTATION.x - u.x) * t + (rand() - 0.5) * 150
        z = u.z + (SUBSTATION.z - u.z) * t + (rand() - 0.5) * 150
      }
      pos[i * 3] = x
      pos[i * 3 + 1] = terrainHeight(x, z) + 0.9 + rand() * 3.0
      pos[i * 3 + 2] = z
      phase[i] = rand()
      size[i] = 1.4 + rand() * 3.4
      const c = rand() < 0.82 ? c1 : c2
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
    const p = new THREE.Points(g, m)
    p.frustumCulled = false
    return { points: p, mat: m }
  }, [count])

  useEffect(() => () => { points.geometry.dispose(); (points.material as THREE.Material).dispose() }, [points])
  useFrame((s) => { mat.uniforms.uTime.value = s.clock.elapsedTime })
  return <primitive object={points} />
}
