import * as THREE from "three";
import { HeightField, MAP_SIZE, SNOW_LINE } from "./heightmap";
import { GLSL_NOISE } from "./glsl";

export function createHeightTexture(field: HeightField) {
  const tex = new THREE.DataTexture(field.data, field.res, field.res, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function createTerrain(field: HeightField, sunDir: THREE.Vector3) {
  const res = field.res;
  const size = field.size;
  const step = size / (res - 1);
  const positions = new Float32Array(res * res * 3);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const idx = (j * res + i) * 3;
      positions[idx] = -size / 2 + i * step;
      positions[idx + 1] = field.data[j * res + i];
      positions[idx + 2] = -size / 2 + j * step;
    }
  }
  const indices = new Uint32Array((res - 1) * (res - 1) * 6);
  let k = 0;
  for (let j = 0; j < res - 1; j++) {
    for (let i = 0; i < res - 1; i++) {
      const a = j * res + i, b = a + 1, c = a + res, d = c + 1;
      // alternate diagonal for better silhouette
      if ((i + j) & 1) {
        indices[k++] = a; indices[k++] = c; indices[k++] = b;
        indices[k++] = b; indices[k++] = c; indices[k++] = d;
      } else {
        indices[k++] = a; indices[k++] = c; indices[k++] = d;
        indices[k++] = a; indices[k++] = d; indices[k++] = b;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const uniforms = {
    uSnowLine: { value: SNOW_LINE },
    uSunDir: { value: sunDir },
    uTime: { value: 0 },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.0,
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNormal;`
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNormal;
        uniform float uSnowLine;
        uniform float uTime;
        ${GLSL_NOISE}

        struct Masks { float sand; float wet; float grass; float soil; float rock; float snow; float under; };

        // ---- micro-detail height fields (metres) ----
        float sandDetail(vec2 p) {
          // wind ripples + fine grain + pebbles
          float warp = fbm3(p * 0.6) * 5.0;
          float ripple = sin((p.x * 0.55 + p.y * 0.35) * 6.0 + warp) * 0.5 + 0.5;
          ripple = pow(ripple, 1.6);
          vec2 v = voronoi(p * 2.4);
          float pebble = smoothstep(0.32, 0.0, v.x) * step(0.86, v.y);
          float grain = vnoise(p * 40.0) * 0.15;
          return ripple * 0.35 + pebble * 0.9 + grain;
        }
        float soilDetail(vec2 p) {
          // clumps of earth: layered voronoi bumps
          vec2 v1 = voronoi(p * 3.0);
          vec2 v2 = voronoi(p * 8.5 + 7.0);
          float clod1 = 1.0 - smoothstep(0.0, 0.55, v1.x);
          float clod2 = 1.0 - smoothstep(0.0, 0.5, v2.x);
          float crumbs = vnoise(p * 30.0);
          return clod1 * clod1 * 0.9 + clod2 * 0.45 + crumbs * 0.2;
        }
        float rockDetail(vec3 p) {
          float strata = sin(p.y * 2.2 + fbm3(p.xz * 0.35) * 4.0) * 0.5 + 0.5;
          float r = ridged(p.xz * 1.3 + p.y * 0.4);
          float crack = 1.0 - smoothstep(0.0, 0.08, voronoi(p.xz * 1.8 + p.y * 0.6).x);
          return r * 1.0 + strata * 0.45 - crack * 0.5 + vnoise(p.xz * 25.0) * 0.1;
        }
        float grassDetail(vec2 p) {
          return vnoise(p * 14.0) * 0.5 + vnoise(p * 45.0) * 0.25 + fbm3(p * 2.0) * 0.4;
        }
        float snowDetail(vec2 p) {
          return fbm3(p * 1.5) * 0.6 + vnoise(p * 20.0) * 0.1;
        }
        float detailHeight(vec3 P, Masks m) {
          float h = 0.0;
          if (m.sand > 0.001) h += sandDetail(P.xz) * 0.06 * m.sand;
          if (m.soil > 0.001) h += soilDetail(P.xz) * 0.14 * m.soil;
          if (m.rock > 0.001) h += rockDetail(P) * 0.35 * m.rock;
          if (m.grass > 0.001) h += grassDetail(P.xz) * 0.05 * m.grass;
          if (m.snow > 0.001) h += snowDetail(P.xz) * 0.08 * m.snow;
          return h;
        }
        `
      )
      .replace(
        "#include <map_fragment>",
        `
        vec3 P = vWPos;
        vec3 Nw = normalize(vWNormal);
        float slope = 1.0 - Nw.y;
        float camDist = length(cameraPosition - P);
        float h = P.y;

        float macro = fbm(P.xz * 0.015);
        float macro2 = fbm(P.xz * 0.045 + 30.0);

        Masks m;
        m.under = 1.0 - smoothstep(-0.05, 0.25, h);
        m.wet = 1.0 - smoothstep(0.15, 1.1, h + (macro2 - 0.5) * 0.3);
        float beachTop = 2.2 + (macro - 0.5) * 3.0;
        m.sand = 1.0 - smoothstep(beachTop, beachTop + 1.6, h);
        m.rock = smoothstep(0.30, 0.55, slope + (macro - 0.5) * 0.25);
        m.snow = smoothstep(uSnowLine - 25.0 + (macro - 0.5) * 60.0, uSnowLine + 25.0 + (macro - 0.5) * 60.0, h) * (1.0 - smoothstep(0.30, 0.55, slope));
        float soilSlope = smoothstep(0.14, 0.32, slope);
        float dirtPatch = smoothstep(0.55, 0.68, fbm(P.xz * 0.05 + 3.0));
        m.soil = max(soilSlope, dirtPatch) * (1.0 - m.rock) * (1.0 - m.sand) * (1.0 - m.snow);
        m.rock *= (1.0 - m.snow);
        // sandy rock near beach? leave rocks visible through sand on steep slopes
        m.sand *= (1.0 - m.rock * 0.85);
        m.grass = clamp((1.0 - m.sand) * (1.0 - m.rock) * (1.0 - m.soil) * (1.0 - m.snow), 0.0, 1.0);
        // normalise masks
        float total = m.sand + m.grass + m.soil + m.rock + m.snow + 1e-4;
        m.sand /= total; m.grass /= total; m.soil /= total; m.rock /= total; m.snow /= total;

        // ---- albedo ----
        float fineN = vnoise(P.xz * 12.0);
        float fineN2 = vnoise(P.xz * 3.0 + 9.0);
        vec3 sandCol = mix(vec3(0.80, 0.72, 0.55), vec3(0.70, 0.62, 0.46), fineN2) * (0.92 + 0.16 * fineN);
        vec2 pv = voronoi(P.xz * 2.4);
        float pebble = smoothstep(0.32, 0.05, pv.x) * step(0.86, pv.y);
        sandCol = mix(sandCol, mix(vec3(0.40, 0.38, 0.36), vec3(0.62, 0.58, 0.55), pv.y * 3.0 - 2.6), pebble * 0.8);
        sandCol = mix(sandCol, sandCol * vec3(0.55, 0.52, 0.50), m.wet);

        vec3 grassA = vec3(0.16, 0.34, 0.08);
        vec3 grassB = vec3(0.42, 0.46, 0.16);
        vec3 grassC = vec3(0.10, 0.25, 0.07);
        vec3 grassCol = mix(grassA, grassB, smoothstep(0.35, 0.75, macro2 * 0.6 + macro * 0.4));
        grassCol = mix(grassCol, grassC, fineN * 0.5);
        grassCol *= 0.85 + 0.3 * vnoise(P.xz * 40.0);

        vec2 sv = voronoi(P.xz * 3.0);
        vec3 soilCol = mix(vec3(0.30, 0.20, 0.12), vec3(0.42, 0.30, 0.18), sv.y);
        soilCol = mix(soilCol, vec3(0.22, 0.15, 0.09), smoothstep(0.35, 0.6, sv.x));
        soilCol *= 0.8 + 0.4 * vnoise(P.xz * 30.0);
        // small stones in soil
        vec2 sv2 = voronoi(P.xz * 8.5 + 7.0);
        soilCol = mix(soilCol, vec3(0.45, 0.43, 0.40), smoothstep(0.25, 0.05, sv2.x) * step(0.8, sv2.y) * 0.7);

        float strata = sin(P.y * 2.2 + fbm3(P.xz * 0.35) * 4.0) * 0.5 + 0.5;
        vec3 rockCol = mix(vec3(0.36, 0.34, 0.32), vec3(0.52, 0.49, 0.45), strata);
        rockCol = mix(rockCol, vec3(0.30, 0.26, 0.22), smoothstep(0.4, 0.7, ridged(P.xz * 1.3 + P.y * 0.4)) * 0.5);
        // lichen & moss on rock where not too steep
        float lichen = smoothstep(0.55, 0.75, fbm3(P.xz * 1.2 + 40.0)) * (1.0 - smoothstep(0.5, 0.8, slope));
        rockCol = mix(rockCol, vec3(0.30, 0.38, 0.16), lichen * 0.55);
        rockCol *= 0.85 + 0.3 * vnoise(P.xz * 20.0 + P.y * 5.0);
        // wet dark rock near waterline
        rockCol = mix(rockCol, rockCol * 0.5, m.wet);

        vec3 snowCol = vec3(0.92, 0.94, 0.98) * (0.95 + 0.05 * fineN);

        vec3 albedo = sandCol * m.sand + grassCol * m.grass + soilCol * m.soil + rockCol * m.rock + snowCol * m.snow;

        // underwater tint / algae
        float algae = smoothstep(0.45, 0.7, fbm(P.xz * 0.08 + 12.0)) * m.under;
        albedo = mix(albedo, albedo * vec3(0.35, 0.55, 0.45) + vec3(0.02, 0.10, 0.06), algae * 0.7);
        albedo = mix(albedo, albedo * vec3(0.55, 0.72, 0.75), smoothstep(0.0, -8.0, h));

        diffuseColor.rgb = albedo;

        // ---- roughness ----
        float rough = 0.95 * m.sand + 0.85 * m.grass + 0.9 * m.soil + 0.72 * m.rock + 0.55 * m.snow;
        rough = mix(rough, 0.35, m.wet * 0.8);
        rough = mix(rough, 0.4, m.under);
        vTerrainRough = rough;

        // ---- micro-normal ----
        float bumpFade = 1.0 - smoothstep(40.0, 320.0, camDist);
        vec3 pN = Nw;
        if (bumpFade > 0.001) {
          float eps = 0.02 + camDist * 0.0015;
          float h0 = detailHeight(P, m);
          float hx = detailHeight(P + vec3(eps, 0.0, 0.0), m);
          float hz = detailHeight(P + vec3(0.0, 0.0, eps), m);
          float k = 1.4 * bumpFade / eps;
          pN = normalize(vec3(Nw.x - (hx - h0) * k, Nw.y, Nw.z - (hz - h0) * k));
        }
        vTerrainN = pN;
        `
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = vTerrainRough;`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `normal = normalize((viewMatrix * vec4(vTerrainN, 0.0)).xyz);`
      )
      // declare the temporaries used across chunks
      .replace(
        "void main() {",
        `float vTerrainRough;
        vec3 vTerrainN;
        void main() {`
      );
  };
  mat.customProgramCacheKey = () => "terrain-v1";

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  return { mesh, uniforms, size: MAP_SIZE };
}
