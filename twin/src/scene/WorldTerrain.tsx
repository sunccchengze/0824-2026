import { useMemo } from 'react'
import * as THREE from 'three'
import { terrainHeight } from './terrainUtil'

const GRID_VERT = /* glsl */ `
varying vec2 vUvW;
varying float vY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vUvW = wp.xz;
  vY = wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
// 程序化测量网格：贴地投影、随距离淡出
const GRID_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUvW;
varying float vY;
uniform vec3 uColor;
uniform float uCell;
uniform float uSect;
float gridLine(vec2 p, float w) {
  vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  return smoothstep(0.0, w, line);
}
void main() {
  float minor = gridLine(vUvW / uCell, 0.9);
  float major = gridLine(vUvW / uSect, 0.9);
  float cam = clamp(1.0 - length(vUvW) / 2400.0, 0.0, 1.0);
  float a = (minor * 0.10 + major * 0.26) * cam;
  gl_FragColor = vec4(uColor, a);
}
`

// W4 辽阔地形：丘谷顶点色 + 贴地投影网格（基准图暗场 + 青绿测量网）
export default function WorldTerrain() {
  const { geo, gridGeo, gridMat } = useMemo(() => {
    const g = new THREE.PlaneGeometry(7600, 7600, 220, 220)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const cLow = new THREE.Color('#02070c')
    const cMid = new THREE.Color('#05101a')
    const cHigh = new THREE.Color('#0a1c2c')
    const tmp = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      const y = terrainHeight(x, z)
      pos.setY(i, y)
      const t = THREE.MathUtils.smoothstep(y, -30, 110)
      tmp.lerpColors(cLow, cMid, Math.min(1, t * 1.6))
      if (t > 0.62) tmp.lerp(cHigh, (t - 0.62) * 1.4)
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.computeVertexNormals()

    // 贴地网格片（仅覆盖场区谷地，边缘淡出）
    const gg = new THREE.PlaneGeometry(3400, 3000, 120, 106)
    gg.rotateX(-Math.PI / 2)
    gg.translate(150, 0, -60)
    const gp = gg.attributes.position
    for (let i = 0; i < gp.count; i++) gp.setY(i, terrainHeight(gp.getX(i), gp.getZ(i)) + 0.65)
    const gm = new THREE.ShaderMaterial({
      vertexShader: GRID_VERT, fragmentShader: GRID_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color('#1d4b68') },
        uCell: { value: 96 }, uSect: { value: 480 },
      },
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    return { geo: g, gridGeo: gg, gridMat: gm }
  }, [])

  return (
    <group>
      <mesh geometry={geo}>
        <meshStandardMaterial vertexColors roughness={1} metalness={0} />
      </mesh>
      <mesh geometry={gridGeo} material={gridMat} renderOrder={1} />
    </group>
  )
}
