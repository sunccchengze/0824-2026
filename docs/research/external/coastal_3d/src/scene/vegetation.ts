import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HeightField, SNOW_LINE } from "./heightmap";
import { Simplex2D, mulberry32, smoothstep } from "./noise";
import { GLSL_NOISE } from "./glsl";

const veg = new Simplex2D(9001);

function jitterGeometry(geo: THREE.BufferGeometry, amount: number, rand: () => number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) + (rand() - 0.5) * amount, pos.getY(i) + (rand() - 0.5) * amount, pos.getZ(i) + (rand() - 0.5) * amount);
  }
  pos.needsUpdate = true;
}

function colorize(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number, i: number) => [number, number, number]) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i), i);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

function prepare(geo: THREE.BufferGeometry) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute("uv");
  return g;
}

/** Conifer: trunk + stacked jittered cones */
function buildPine(seed: number) {
  const rand = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.38, 5.5, 7, 3);
  trunk.translate(0, 2.7, 0);
  jitterGeometry(trunk, 0.06, rand);
  parts.push(colorize(prepare(trunk), (_x, y) => {
    const v = 0.85 + rand() * 0.3;
    return [0.24 * v, 0.15 * v, 0.09 * v * (1 - y * 0.02)];
  }));
  const layers = 5;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const r = 3.4 * (1 - t * 0.78) + rand() * 0.3;
    const h = 3.6 - t * 0.8;
    const y = 2.6 + i * 2.0;
    const cone = new THREE.ConeGeometry(r, h, 9, 2, true);
    cone.translate(0, y + h / 2 - 1.2, 0);
    jitterGeometry(cone, 0.35, rand);
    cone.computeVertexNormals();
    parts.push(colorize(prepare(cone), (_x, yy) => {
      const v = 0.75 + rand() * 0.5;
      const tipLight = smoothstep(y - 1, y + h - 1.2, yy) * 0.35;
      return [(0.07 + tipLight * 0.25) * v, (0.24 + tipLight * 0.3) * v, (0.07 + tipLight * 0.05) * v];
    }));
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/** Broadleaf: trunk + blobs */
function buildBroadleaf(seed: number) {
  const rand = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.5, 4.2, 7, 3);
  trunk.translate(0, 2.0, 0);
  jitterGeometry(trunk, 0.08, rand);
  parts.push(colorize(prepare(trunk), () => { const v = 0.85 + rand() * 0.3; return [0.28 * v, 0.20 * v, 0.13 * v]; }));
  const blobs = 6;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2;
    const rr = i === 0 ? 0 : 1.4 + rand() * 0.8;
    const s = 1.8 + rand() * 1.0;
    const ico = new THREE.IcosahedronGeometry(s, 2);
    jitterGeometry(ico, 0.55, rand);
    ico.translate(Math.cos(a) * rr, 4.6 + rand() * 1.2 + (i === 0 ? 1.2 : 0), Math.sin(a) * rr);
    ico.computeVertexNormals();
    parts.push(colorize(prepare(ico), (_x, y) => {
      const v = 0.7 + rand() * 0.6;
      const up = smoothstep(3.5, 8, y);
      return [(0.10 + up * 0.12) * v, (0.28 + up * 0.14) * v, (0.06 + up * 0.03) * v];
    }));
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

function buildBush(seed: number) {
  const rand = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const ico = new THREE.IcosahedronGeometry(0.55 + rand() * 0.4, 2);
    jitterGeometry(ico, 0.25, rand);
    ico.translate((rand() - 0.5) * 0.9, 0.35 + rand() * 0.2, (rand() - 0.5) * 0.9);
    ico.computeVertexNormals();
    parts.push(colorize(prepare(ico), (_x, y) => {
      const v = 0.75 + rand() * 0.5;
      return [(0.12 + y * 0.06) * v, (0.30 + y * 0.08) * v, (0.08) * v];
    }));
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

function buildRock(seed: number) {
  const rand = mulberry32(seed);
  const n = new Simplex2D(seed);
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const sx = 0.8 + rand() * 0.5, sy = 0.55 + rand() * 0.4, sz = 0.8 + rand() * 0.5;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const d = 1 + (n.fbm(x * 1.2 + y * 0.7, z * 1.2 - y * 0.5, 4) - 0.5) * 0.7 + (n.noise(x * 4, z * 4 + y * 3)) * 0.08;
    // facet
    pos.setXYZ(i, x * d * sx, y * d * sy, z * d * sz);
  }
  const g = prepare(geo);
  g.computeVertexNormals();
  colorize(g, (_x, y) => {
    const v = 0.8 + rand() * 0.35;
    const moss = y > 0.3 ? 0.25 : 0;
    return [0.44 * v * (1 - moss * 0.5), 0.42 * v, 0.40 * v * (1 - moss)];
  });
  g.computeBoundingSphere();
  return g;
}

export interface Placement {
  x: number; y: number; z: number; scale: number; rot: number;
}

function place(
  field: HeightField,
  count: number,
  seed: number,
  accept: (x: number, z: number, h: number, ny: number, r: number) => number // returns scale or 0
): Placement[] {
  const rand = mulberry32(seed);
  const out: Placement[] = [];
  const half = field.size / 2 - 20;
  const nrm: [number, number, number] = [0, 1, 0];
  let tries = 0;
  while (out.length < count && tries < count * 40) {
    tries++;
    const x = (rand() * 2 - 1) * half;
    const z = (rand() * 2 - 1) * half;
    const h = field.sample(x, z);
    field.normal(x, z, nrm);
    const s = accept(x, z, h, nrm[1], rand());
    if (s > 0) out.push({ x, y: h, z, scale: s, rot: rand() * Math.PI * 2 });
  }
  return out;
}

function makeInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: Placement[], sink = 0, tiltToNormal?: HeightField) {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3();
  const nrm: [number, number, number] = [0, 1, 0];
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const qy = new THREE.Quaternion();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    p.set(it.x, it.y - sink * it.scale, it.z);
    qy.setFromAxisAngle(up, it.rot);
    if (tiltToNormal) {
      tiltToNormal.normal(it.x, it.z, nrm);
      n.set(nrm[0], nrm[1], nrm[2]);
      q.setFromUnitVectors(up, n).multiply(qy);
    } else {
      q.copy(qy);
    }
    s.setScalar(it.scale);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

export function createVegetation(field: HeightField, quality: number) {
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 } };

  const forestMask = (x: number, z: number) => veg.fbm(x * 0.006, z * 0.006, 4);

  // ---- materials ----
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  treeMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;`)
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position);
        #ifdef USE_INSTANCING
          vec2 ip = instanceMatrix[3].xz;
          float sw = sin(uTime * 1.3 + ip.x * 0.21 + ip.y * 0.13) + 0.5 * sin(uTime * 2.7 + ip.x * 0.5);
          float amt = position.y * position.y * 0.0025;
          transformed.x += sw * amt;
          transformed.z += sw * amt * 0.5;
        #endif`
      );
  };
  treeMat.customProgramCacheKey = () => "tree-v1";

  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  rockMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vRWPos;`)
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vRWPos = (modelMatrix * (instanceMatrix * vec4(transformed, 1.0))).xyz;
        #else
          vRWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vRWPos;\n${GLSL_NOISE}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float rn = fbm(vRWPos.xz * 2.5 + vRWPos.y * 1.5);
        float strata = sin(vRWPos.y * 3.0 + rn * 4.0) * 0.5 + 0.5;
        diffuseColor.rgb *= 0.7 + 0.45 * rn + 0.15 * strata;
        diffuseColor.rgb *= 0.85 + 0.3 * vnoise(vRWPos.xz * 30.0 + vRWPos.y * 20.0);
        // wet/dark near water line
        diffuseColor.rgb *= mix(0.45, 1.0, smoothstep(-0.2, 1.0, vRWPos.y));`
      );
  };
  rockMat.customProgramCacheKey = () => "rock-v1";

  // ---- pines ----
  const pineCount = Math.floor(4200 * quality);
  const pines = place(field, pineCount, 11, (x, z, h, ny, r) => {
    if (h < 6 || h > SNOW_LINE - 50 || ny < 0.72) return 0;
    const f = forestMask(x, z);
    const altBias = smoothstep(20, 90, h) * 0.12; // pines prefer higher ground
    if (f + altBias < 0.52 + r * 0.12) return 0;
    return 0.8 + r * 0.9 + smoothstep(0.55, 0.8, f) * 0.4;
  });
  const pineGeos = [buildPine(1), buildPine(2), buildPine(3)];
  pineGeos.forEach((g, i) => {
    const items = pines.filter((_, j) => j % 3 === i);
    group.add(makeInstanced(g, treeMat, items, 0.15));
  });

  // ---- broadleaf ----
  const leafCount = Math.floor(1800 * quality);
  const leafs = place(field, leafCount, 23, (x, z, h, ny, r) => {
    if (h < 4 || h > 90 || ny < 0.78) return 0;
    const f = forestMask(x + 500, z - 300);
    if (f < 0.5 + r * 0.1) return 0;
    return 0.7 + r * 0.8;
  });
  const leafGeos = [buildBroadleaf(4), buildBroadleaf(5)];
  leafGeos.forEach((g, i) => {
    const items = leafs.filter((_, j) => j % 2 === i);
    group.add(makeInstanced(g, treeMat, items, 0.15));
  });

  // ---- bushes ----
  const bushCount = Math.floor(6000 * quality);
  const bushes = place(field, bushCount, 37, (x, z, h, ny, r) => {
    if (h < 3.2 || h > 180 || ny < 0.72) return 0;
    const f = veg.fbm(x * 0.02 + 900, z * 0.02, 3);
    if (f < 0.45 + r * 0.15) return 0;
    return 0.6 + r * 1.2;
  });
  const bushGeos = [buildBush(6), buildBush(7)];
  bushGeos.forEach((g, i) => {
    const items = bushes.filter((_, j) => j % 2 === i);
    const mesh = makeInstanced(g, treeMat, items, 0.1);
    group.add(mesh);
  });

  // ---- rocks ----
  const rockCount = Math.floor(3200 * quality);
  const rocks = place(field, rockCount, 53, (x, z, h, ny, r) => {
    if (h < -6 || h > 400) return 0;
    const slope = 1 - ny;
    const cliffZone = slope > 0.3 ? 1 : 0;
    const shoreZone = h < 3 && h > -5 ? 1 : 0;
    const beachPebble = shoreZone && r < 0.35 ? 1 : 0;
    const rn = veg.fbm(x * 0.03 + 200, z * 0.03, 3);
    if (!cliffZone && !shoreZone && rn < 0.62) return 0;
    if (shoreZone && !cliffZone && rn < 0.4 && !beachPebble) return 0;
    if (beachPebble) return 0.15 + r * 0.5;
    return 0.4 + r * r * 3.5 + cliffZone * 0.8;
  });
  const rockGeos = [buildRock(8), buildRock(9), buildRock(10), buildRock(12)];
  rockGeos.forEach((g, i) => {
    const items = rocks.filter((_, j) => j % 4 === i);
    group.add(makeInstanced(g, rockMat, items, 0.35, field));
  });

  const update = (time: number) => {
    uniforms.uTime.value = time;
  };

  return { group, update, counts: { pines: pines.length, broadleaf: leafs.length, bushes: bushes.length, rocks: rocks.length } };
}
