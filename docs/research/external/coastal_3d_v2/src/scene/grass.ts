import * as THREE from "three";
import { GLSL_NOISE, GLSL_HEIGHT_SAMPLER } from "./glsl";
import { MAP_RES, MAP_SIZE, SNOW_LINE } from "./heightmap";
import { mulberry32 } from "./noise";

export interface GrassLayerOptions {
  region: number; // side of square region following the camera (m)
  count: number; // tufts
  minHeight: number;
  maxHeight: number;
  width: number;
  bladesPerTuft: number;
  segments: number;
  seed: number;
  castShadow: boolean;
}

function buildTuftGeometry(opts: GrassLayerOptions) {
  const rand = mulberry32(opts.seed * 7 + 1);
  const blades = opts.bladesPerTuft;
  const segs = opts.segments;
  const vertsPerBlade = (segs + 1) * 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let b = 0; b < blades; b++) {
    const ang = (b / blades) * Math.PI * 2 + rand() * 0.8;
    const c = Math.cos(ang), s = Math.sin(ang);
    const bend = 0.15 + rand() * 0.45;
    const lean = (rand() - 0.5) * 0.25;
    const hScale = 0.75 + rand() * 0.5;
    const off = (rand() - 0.5) * 0.12;
    const base = b * vertsPerBlade;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const w = 0.5 * Math.pow(1 - t, 0.75) * (1.0 - 0.3 * t * t);
      // local: x across blade, y up, z bend direction
      const zb = bend * t * t + lean * t;
      const y = t * hScale * (1 - bend * bend * t * t * 0.35);
      for (let side = 0; side < 2; side++) {
        const lx = side === 0 ? -w : w;
        // rotate around Y
        const x = lx * c - zb * s + off * s;
        const z = lx * s + zb * c + off * c;
        positions.push(x, y, z);
        // normal faces -bend dir tilted
        const nx = -s, nz = c;
        const ny = 0.35 + t * 0.5;
        const l = Math.hypot(nx, ny, nz);
        normals.push(nx / l, ny / l, nz / l);
        uvs.push(side, t);
      }
      if (i < segs) {
        const a = base + i * 2, bb = a + 1, cc = a + 2, d = a + 3;
        indices.push(a, cc, bb, bb, cc, d);
      }
    }
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function createGrassLayer(heightTex: THREE.DataTexture, opts: GrassLayerOptions) {
  const geo = buildTuftGeometry(opts);
  const rand = mulberry32(opts.seed);
  const inst = new Float32Array(opts.count * 4);
  const rnd = new Float32Array(opts.count);
  for (let i = 0; i < opts.count; i++) {
    inst[i * 4] = rand() * opts.region;
    inst[i * 4 + 1] = rand() * opts.region;
    inst[i * 4 + 2] = rand() * Math.PI * 2;
    inst[i * 4 + 3] = opts.minHeight + rand() * (opts.maxHeight - opts.minHeight);
    rnd[i] = rand();
  }
  geo.setAttribute("aInst", new THREE.InstancedBufferAttribute(inst, 4));
  geo.setAttribute("aRand", new THREE.InstancedBufferAttribute(rnd, 1));
  geo.instanceCount = opts.count;

  const uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector2() },
    uCamPos: { value: new THREE.Vector3() },
    uRegion: { value: opts.region },
    uHalf: { value: opts.region / 2 },
    uWidth: { value: opts.width },
    uHeightTex: { value: heightTex },
    uMapSize: { value: MAP_SIZE },
    uMapRes: { value: MAP_RES },
    uSnowLine: { value: SNOW_LINE },
  };

  const vertexHeader = /* glsl */ `
    attribute vec4 aInst;
    attribute float aRand;
    uniform float uTime;
    uniform vec2 uCenter;
    uniform vec3 uCamPos;
    uniform float uRegion;
    uniform float uHalf;
    uniform float uWidth;
    uniform float uSnowLine;
    ${GLSL_NOISE}
    ${GLSL_HEIGHT_SAMPLER}
    varying vec3 vGrassColor;
    varying float vGrassT;
  `;

  // Computes final world position (transformed) + world normal (gN)
  const vertexBody = /* glsl */ `
    vec3 gN = vec3(0.0, 1.0, 0.0);
    vec3 transformed;
    {
      vec2 rel = mod(aInst.xy - uCenter + uHalf, uRegion) - uHalf;
      vec2 wxz = uCenter + rel;
      float h = sampleHeight(wxz);
      vec3 tn = sampleTerrainNormal(wxz);
      float slope = 1.0 - tn.y;
      float macro = fbm(wxz * 0.015);
      float beachTop = 2.2 + (macro - 0.5) * 3.0;
      float m = smoothstep(beachTop + 0.5, beachTop + 2.2, h);
      m *= 1.0 - smoothstep(0.24, 0.40, slope + (macro - 0.5) * 0.25);
      m *= 1.0 - smoothstep(uSnowLine - 60.0, uSnowLine - 20.0, h);
      float dirt = smoothstep(0.52, 0.66, fbm(wxz * 0.05 + 3.0));
      m *= 1.0 - dirt;
      float density = fbm3(wxz * 0.06 + 20.0);
      m *= step(aRand * 0.95, density + 0.35);
      float dist = length(wxz - uCamPos.xz);
      float fade = 1.0 - smoothstep(uHalf * 0.62, uHalf * 0.97, dist);
      float s = aInst.w * m * fade;
      float t = uv.y;

      // blade local
      vec3 lp = vec3(position.x * uWidth, position.y, position.z * 0.6);
      float rot = aInst.z;
      float c = cos(rot), sn = sin(rot);
      mat2 rm = mat2(c, -sn, sn, c);
      lp.xz = rm * lp.xz;
      lp *= s;

      // wind
      float gust = fbm3(wxz * 0.035 - uTime * vec2(0.55, 0.3));
      float sway = sin(uTime * 1.9 + wxz.x * 0.25 + wxz.y * 0.17 + aRand * 4.0) * 0.5
                 + 0.5 * sin(uTime * 3.7 + wxz.x * 0.9 + aRand * 6.28);
      float bend = (0.10 + 0.55 * gust * gust) * (0.5 + 0.5 * sway) + 0.25 * gust;
      vec2 windDir = normalize(vec2(0.8, 0.45));
      lp.xz += windDir * bend * t * t * s;
      lp.y -= bend * bend * t * t * s * 0.25;

      vec3 bn = normal;
      bn.xz = rm * bn.xz;
      gN = normalize(mix(tn, bn, 0.4));
      transformed = vec3(wxz.x + lp.x, h + lp.y - 0.03, wxz.y + lp.z);

      // colour
      float hue = fbm3(wxz * 0.05 + 7.0);
      vec3 base = mix(vec3(0.09, 0.27, 0.05), vec3(0.34, 0.40, 0.12), smoothstep(0.3, 0.8, hue));
      base = mix(base, vec3(0.15, 0.36, 0.07), aRand * 0.45);
      base *= 0.85 + 0.3 * hash12(aInst.xy);
      vec3 tip = base * 1.55 + vec3(0.12, 0.10, 0.0);
      vGrassColor = mix(base * 0.40, tip, t * 0.5 + t * t * 0.5);
      vGrassT = t;
    }
  `;

  const patchVertex = (shader: THREE.WebGLProgramParametersWithUniforms, lit: boolean) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${vertexHeader}`)
      .replace(
        "#include <begin_vertex>",
        vertexBody + (lit ? `\nvNormal = normalize(normalMatrix * gN);\n` : "")
      );
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.75,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    patchVertex(shader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vGrassColor;
        varying float vGrassT;`
      )
      .replace("#include <map_fragment>", `diffuseColor.rgb = vGrassColor;`)
      .replace(
        "#include <normal_fragment_begin>",
        `float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
         vec3 normal = normalize(vNormal);
         vec3 nonPerturbedNormal = normal;`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `totalEmissiveRadiance += vGrassColor * (0.05 + 0.22 * vGrassT * vGrassT);`
      );
  };
  material.customProgramCacheKey = () => `grass-lit-${opts.seed}`;

  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depthMat.onBeforeCompile = (shader) => patchVertex(shader, false);
  depthMat.customProgramCacheKey = () => `grass-depth-${opts.seed}`;

  const mesh = new THREE.Mesh(geo, material);
  mesh.customDepthMaterial = depthMat;
  mesh.frustumCulled = false;
  mesh.castShadow = opts.castShadow;
  mesh.receiveShadow = true;

  const cell = opts.region / 64;
  const update = (time: number, camPos: THREE.Vector3) => {
    uniforms.uTime.value = time;
    uniforms.uCamPos.value.copy(camPos);
    uniforms.uCenter.value.set(Math.round(camPos.x / cell) * cell, Math.round(camPos.z / cell) * cell);
  };

  return { mesh, update, uniforms };
}
