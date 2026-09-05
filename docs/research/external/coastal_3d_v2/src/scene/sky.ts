import * as THREE from "three";
import { GLSL_NOISE, GLSL_SKY } from "./glsl";

export function createSky(sunDir: THREE.Vector3) {
  const uniforms = {
    uSunDir: { value: sunDir },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w; // push to far plane
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_NOISE}
      ${GLSL_SKY}
      uniform float uTime;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyColor(d);
        // sun disc
        float sunAmt = dot(d, uSunDir);
        col += vec3(1.0, 0.97, 0.9) * smoothstep(0.9993, 0.9997, sunAmt) * 12.0;
        // clouds on a virtual plane
        if (d.y > 0.0) {
          float hgt = 1.0 / (d.y + 0.08);
          vec2 cuv = d.xz * hgt * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
          float c1 = fbm(cuv * 1.2);
          float c2 = fbm(cuv * 3.5 + 11.0);
          float cov = smoothstep(0.50, 0.72, c1 * 0.75 + c2 * 0.35);
          // shading: sample toward sun
          float c1s = fbm(cuv * 1.2 + uSunDir.xz * 0.12);
          float shade = clamp((c1s - c1) * 6.0, -1.0, 1.0);
          vec3 cloudCol = mix(vec3(0.62, 0.66, 0.74), vec3(1.05, 1.02, 0.98), 0.5 + 0.5 * shade);
          cloudCol += vec3(1.0, 0.8, 0.6) * pow(max(sunAmt, 0.0), 12.0) * 0.4;
          float horizonFade = smoothstep(0.0, 0.18, d.y);
          col = mix(col, cloudCol, cov * horizonFade * 0.95);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const geo = new THREE.SphereGeometry(5000, 48, 24);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return { mesh, uniforms };
}
