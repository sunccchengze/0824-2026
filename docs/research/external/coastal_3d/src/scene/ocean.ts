import * as THREE from "three";
import { GLSL_NOISE, GLSL_HEIGHT_SAMPLER, GLSL_SKY } from "./glsl";
import { MAP_RES, MAP_SIZE } from "./heightmap";

export const NEAR_OCEAN_SIZE = 2400;
export const NEAR_OCEAN_SEGS = 640;

export function createOcean(heightTex: THREE.DataTexture, sunDir: THREE.Vector3, fogColor: THREE.Color) {
  const uniforms = {
    uTime: { value: 0 },
    uHeightTex: { value: heightTex },
    uMapSize: { value: MAP_SIZE },
    uMapRes: { value: MAP_RES },
    uSunDir: { value: sunDir },
    uCamPos: { value: new THREE.Vector3() },
    fogColor: { value: fogColor.clone() },
    fogDensity: { value: 0.0004 },
    fogNear: { value: 1 },
    fogFar: { value: 1000 },
  };

  const vertexShader = /* glsl */ `
    ${GLSL_NOISE}
    ${GLSL_HEIGHT_SAMPLER}
    uniform float uTime;
    varying vec3 vWPos;
    varying vec3 vN;
    varying float vDepth;
    varying float vCrest;
    #include <fog_pars_vertex>

    void gerstner(vec2 p, vec2 dir, float steep, float wl, float damp, float t,
                  inout vec3 pos, inout vec3 tang, inout vec3 binorm, inout float crest) {
      float k = 6.28318 / wl;
      float c = sqrt(9.81 / k);
      vec2 d = normalize(dir);
      float f = k * (dot(d, p) - c * t);
      float a = steep * damp / k;
      pos.x += d.x * a * cos(f);
      pos.y += a * sin(f);
      pos.z += d.y * a * cos(f);
      float s = steep * damp;
      tang += vec3(-d.x * d.x * s * sin(f), d.x * s * cos(f), -d.x * d.y * s * sin(f));
      binorm += vec3(-d.x * d.y * s * sin(f), d.y * s * cos(f), -d.y * d.y * s * sin(f));
      crest += (sin(f) * 0.5 + 0.5) * s;
    }

    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vec2 p = wp.xz;
      float terrainH = insideMap(p) ? sampleHeight(p) : -45.0;
      float depth = max(0.0, -terrainH);
      float damp = 0.12 + 0.88 * smoothstep(0.0, 7.0, depth);
      float t = uTime;

      vec3 pos = vec3(p.x, 0.0, p.y);
      vec3 tang = vec3(1.0, 0.0, 0.0);
      vec3 binorm = vec3(0.0, 0.0, 1.0);
      float crest = 0.0;
      // swell rolling towards the land is approximated by fixed directions; shallow damping handles the shore
      gerstner(p, vec2(1.0, 0.35), 0.22, 64.0, damp, t, pos, tang, binorm, crest);
      gerstner(p, vec2(0.6, 0.8), 0.20, 31.0, damp, t, pos, tang, binorm, crest);
      gerstner(p, vec2(-0.3, 1.0), 0.18, 17.0, damp, t, pos, tang, binorm, crest);
      gerstner(p, vec2(0.9, -0.5), 0.16, 9.0, damp, t, pos, tang, binorm, crest);
      gerstner(p, vec2(-0.8, -0.3), 0.12, 4.6, damp, t, pos, tang, binorm, crest);
      gerstner(p, vec2(0.2, -1.0), 0.10, 2.3, damp, t, pos, tang, binorm, crest);

      // small swash rise near shore so water climbs the beach
      float shore = 1.0 - smoothstep(0.0, 3.0, depth);
      pos.y += shore * 0.12 * sin(t * 0.9 + fbm3(p * 0.05) * 6.0);

      vN = normalize(cross(binorm, tang));
      vWPos = pos;
      vDepth = pos.y - terrainH;
      vCrest = crest;
      vec4 mvPosition = viewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `;

  const fragmentShader = /* glsl */ `
    ${GLSL_NOISE}
    ${GLSL_HEIGHT_SAMPLER}
    ${GLSL_SKY}
    uniform float uTime;
    uniform vec3 uCamPos;
    varying vec3 vWPos;
    varying vec3 vN;
    varying float vDepth;
    varying float vCrest;
    #include <fog_pars_fragment>

    float rippleH(vec2 p, float t) {
      float h = 0.0;
      h += vnoise(p * 0.9 + vec2(t * 0.35, t * 0.2)) * 0.5;
      h += vnoise(p * 2.1 - vec2(t * 0.25, t * 0.4)) * 0.25;
      h += vnoise(p * 5.5 + vec2(t * 0.6, -t * 0.3)) * 0.12;
      return h;
    }

    void main() {
      vec3 P = vWPos;
      vec3 V = normalize(uCamPos - P);
      float camDist = length(uCamPos - P);
      float t = uTime;

      // per-pixel depth for foam
      float terrainH = insideMap(P.xz) ? sampleHeight(P.xz) : -45.0;
      float depth = max(0.0, P.y - terrainH);

      // micro ripples
      float rippleFade = 1.0 - smoothstep(60.0, 600.0, camDist);
      float e = 0.05;
      float r0 = rippleH(P.xz, t);
      float rx = rippleH(P.xz + vec2(e, 0.0), t);
      float rz = rippleH(P.xz + vec2(0.0, e), t);
      float rk = 0.35 * rippleFade / e;
      vec3 N = normalize(vec3(vN.x - (rx - r0) * rk * 0.1, vN.y, vN.z - (rz - r0) * rk * 0.1));

      // fresnel
      float NdV = max(dot(N, V), 0.0);
      float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

      vec3 R = reflect(-V, N);
      R.y = abs(R.y) * 0.9 + 0.02;
      vec3 skyRef = skyColor(R);

      // water body colour
      vec3 shallowCol = vec3(0.05, 0.50, 0.48);
      vec3 midCol = vec3(0.02, 0.26, 0.36);
      vec3 deepCol = vec3(0.005, 0.07, 0.16);
      float dAtt = exp(-depth * 0.22);
      float dAtt2 = exp(-depth * 0.05);
      vec3 water = mix(deepCol, midCol, dAtt2);
      water = mix(water, shallowCol, dAtt);
      float NdL = max(dot(N, uSunDir), 0.0);
      water *= 0.55 + 0.6 * NdL;

      // subsurface glow on backlit crests
      float sss = pow(max(dot(V, -uSunDir), 0.0), 3.0) * max(P.y + 0.3, 0.0) * 0.6;
      sss += vCrest * 0.35 * max(dot(N, uSunDir), 0.0);
      water += vec3(0.05, 0.42, 0.36) * sss * dAtt2 * 0.8;

      // sun specular
      vec3 H = normalize(uSunDir + V);
      float NdH = max(dot(N, H), 0.0);
      vec3 sunCol = vec3(1.0, 0.95, 0.85);
      float spec = pow(NdH, 900.0) * 6.0 + pow(NdH, 80.0) * 0.35;
      vec3 specular = sunCol * spec * (0.3 + fresnel * 0.7);

      // ---- foam ----
      float fm1 = fbm(P.xz * 0.9 + vec2(t * 0.15, -t * 0.1));
      float fm2 = vnoise(P.xz * 6.0 + vec2(-t * 0.6, t * 0.4));
      float shoreF = 1.0 - smoothstep(0.0, 3.2, depth);
      // rolling bands of surf coming in
      float band = sin(depth * 2.4 - t * 1.6 + fm1 * 3.0) * 0.5 + 0.5;
      float foam = shoreF * smoothstep(0.42, 0.62, fm1 * 0.55 + band * 0.35 + fm2 * 0.25 + shoreF * 0.25);
      // foam line right at waterline
      foam = max(foam, (1.0 - smoothstep(0.0, 0.35, depth)) * smoothstep(0.3, 0.6, fm2 * 0.5 + fm1 * 0.5));
      // crest foam offshore
      float crestF = smoothstep(0.55, 0.85, vCrest * 0.8 + fm2 * 0.25) * smoothstep(0.0, 6.0, depth);
      crestF *= smoothstep(0.45, 0.7, fm1);
      foam = clamp(foam + crestF * 0.8, 0.0, 1.0);
      // foam bubbles detail
      float bub = smoothstep(0.55, 0.7, vnoise(P.xz * 18.0 + t * 0.5));
      foam *= 0.85 + 0.3 * bub;
      vec3 foamCol = vec3(0.90, 0.95, 0.96) * (0.55 + 0.6 * NdL);

      vec3 col = mix(water, skyRef, fresnel);
      col += specular * (1.0 - foam);
      col = mix(col, foamCol, foam);

      float alpha = clamp(0.30 + smoothstep(0.0, 3.5, depth) * 0.65 + fresnel * 0.5, 0.0, 1.0);
      alpha = max(alpha, foam * 0.95);
      // stop hard edge where water meets sand: soften at very shallow depth
      alpha *= smoothstep(0.0, 0.08, depth);

      gl_FragColor = vec4(col, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `;

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    fog: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const nearGeo = new THREE.PlaneGeometry(NEAR_OCEAN_SIZE, NEAR_OCEAN_SIZE, NEAR_OCEAN_SEGS, NEAR_OCEAN_SEGS);
  nearGeo.rotateX(-Math.PI / 2);
  const near = new THREE.Mesh(nearGeo, material);
  near.frustumCulled = false;
  near.renderOrder = 10;

  const farGeo = new THREE.RingGeometry(NEAR_OCEAN_SIZE * 0.5 - 4, 30000, 96, 12);
  farGeo.rotateX(-Math.PI / 2);
  const far = new THREE.Mesh(farGeo, material);
  far.frustumCulled = false;
  far.renderOrder = 9;

  const group = new THREE.Group();
  group.add(near, far);

  const cell = NEAR_OCEAN_SIZE / NEAR_OCEAN_SEGS;
  const update = (time: number, camPos: THREE.Vector3) => {
    uniforms.uTime.value = time;
    uniforms.uCamPos.value.copy(camPos);
    const sx = Math.round(camPos.x / cell) * cell;
    const sz = Math.round(camPos.z / cell) * cell;
    near.position.set(sx, 0, sz);
    far.position.set(sx, -0.05, sz);
  };

  return { group, material, update };
}
