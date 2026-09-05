import { Simplex2D, smoothstep, mix, clamp } from "./noise";

export const MAP_SIZE = 1800; // world meters
export const MAP_RES = 1024; // heightmap resolution
export const SEA_LEVEL = 0;
export const SNOW_LINE = 205;

export interface HeightField {
  data: Float32Array; // MAP_RES * MAP_RES
  res: number;
  size: number;
  minH: number;
  maxH: number;
  sample(x: number, z: number): number;
  normal(x: number, z: number, out?: [number, number, number]): [number, number, number];
}

export const simplex = new Simplex2D(20240611);

/** Warped coordinates for the coastline function */
function warp(x: number, z: number): [number, number] {
  const n = simplex;
  const wx = (n.fbm(x * 0.0013, z * 0.0013, 3) - 0.5) * 2;
  const wz = (n.fbm(x * 0.0013 + 100, z * 0.0013 - 70, 3) - 0.5) * 2;
  return [x + wx * 130, z + wz * 130];
}

/** Raw signed coast field (>0 land). Only its zero-set matters – true distance is computed by an EDT. */
function coastRaw(x: number, z: number, qx: number, qz: number): number {
  const n = simplex;
  const r = Math.sqrt(qx * qx + qz * qz);
  const th = Math.atan2(qz, qx);
  const R =
    405 +
    110 * Math.sin(3 * th + 1.0) +
    70 * Math.sin(5 * th - 2.0) +
    30 * Math.sin(9 * th + 0.5) +
    80 * (n.fbm(Math.cos(th) * 2.2 + 10, Math.sin(th) * 2.2 + 10, 3) - 0.5) * 2 +
    30 * (n.fbm(qx * 0.012, qz * 0.012, 2) - 0.5) * 2;
  let d = R - r;
  // offshore islands as part of the land set
  const iso = n.fbm(qx * 0.0035 + 300, qz * 0.0035 - 120, 4);
  const island = (iso - 0.68) * 600 * smoothstep(-30, -120, d);
  d = Math.max(d, island);
  // keep sea near the border
  const rr = Math.sqrt(x * x + z * z);
  d = Math.min(d, 760 - rr);
  return d;
}

/** Height from (true) coast distance d (m, >0 land), cliff mask and warped coords */
function heightFromDistance(d: number, cliff: number, qx: number, qz: number, x: number, z: number): number {
  const n = simplex;
  const rr = Math.sqrt(x * x + z * z);
  let h: number;
  if (d < 0) {
    let sea = d * 0.035 + smoothstep(-30, -260, d) * d * 0.11;
    sea = Math.max(sea, -46 + 4 * n.fbm(qx * 0.01, qz * 0.01, 2));
    sea += (n.fbm(qx * 0.03, qz * 0.03, 3) - 0.5) * 1.2 * smoothstep(-10, -60, d);
    // sea stacks close to shore
    const st = n.fbm(qx * 0.02 + 700, qz * 0.02 + 200, 3);
    const stack = smoothstep(0.74, 0.86, st) * 16 * smoothstep(-90, -30, d) * (1 - smoothstep(-8, 0, d)) * (0.5 + cliff);
    h = sea + stack;
  } else {
    const beach = d * 0.024;
    const cliffRamp = 24 * smoothstep(0, 28, d) + d * 0.03;
    const base = mix(beach, cliffRamp, cliff);
    const hills = Math.pow(n.fbm(qx * 0.0025, qz * 0.0025, 4, 2.0, 0.45), 1.4) * 62 * smoothstep(30, 160, d);
    const mount = n.ridged(qx * 0.0012, qz * 0.0012, 5);
    const mountains = Math.pow(mount, 2.0) * 340 * smoothstep(45, 230, d) * (1 - smoothstep(330, 520, rr));
    const dunes =
      smoothstep(22, 45, d) * (1 - smoothstep(70, 125, d)) *
      (0.5 + 0.5 * Math.sin(d * 0.28 + n.fbm(qx * 0.05, qz * 0.05, 2) * 7)) * 1.7 * (1 - cliff);
    const detail = (n.fbm(qx * 0.022, qz * 0.022, 3) - 0.5) * 2 * 1.2 * smoothstep(15, 90, d);
    const fine = (n.fbm(qx * 0.15, qz * 0.15, 2) - 0.5) * 0.3 * smoothstep(8, 40, d);
    const st = n.fbm(qx * 0.02 + 700, qz * 0.02 + 200, 3);
    const stack = smoothstep(0.74, 0.86, st) * 16 * (1 - smoothstep(0, 25, d)) * cliff;
    h = base + hills + mountains + dunes + detail + fine + stack;
  }
  return h;
}

// ---------- exact Euclidean distance transform (Felzenszwalb & Huttenlocher) ----------
const INF = 1e12;
function edt1d(f: Float32Array, n: number, out: Float32Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    out[q] = dq * dq + f[v[k]];
  }
}
/** squared distance (in cells) from every cell to nearest cell where mask is true */
function edt2d(mask: Uint8Array, res: number): Float32Array {
  const grid = new Float32Array(res * res);
  for (let i = 0; i < res * res; i++) grid[i] = mask[i] ? 0 : INF;
  const f = new Float32Array(res), out = new Float32Array(res);
  const v = new Int32Array(res), z = new Float64Array(res + 1);
  // columns
  for (let x = 0; x < res; x++) {
    for (let y = 0; y < res; y++) f[y] = grid[y * res + x];
    edt1d(f, res, out, v, z);
    for (let y = 0; y < res; y++) grid[y * res + x] = out[y];
  }
  // rows
  for (let y = 0; y < res; y++) {
    const row = y * res;
    for (let x = 0; x < res; x++) f[x] = grid[row + x];
    edt1d(f, res, out, v, z);
    for (let x = 0; x < res; x++) grid[row + x] = out[x];
  }
  return grid;
}

export type ProgressCb = (p: number) => void;

/** Generate heightfield in chunks (keeps UI responsive) */
export function generateHeightField(onProgress: ProgressCb): Promise<HeightField> {
  return new Promise((resolve) => {
    const res = MAP_RES;
    const N = res * res;
    const step = MAP_SIZE / (res - 1);
    const data = new Float32Array(N);
    const raw = new Float32Array(N);
    const cliffA = new Float32Array(N);
    const qxA = new Float32Array(N);
    const qzA = new Float32Array(N);
    const landMask = new Uint8Array(N);
    const seaMask = new Uint8Array(N);
    let row = 0;
    const rowsPerChunk = 32;

    // ---- pass A: coast field, warped coords, cliff mask
    const passA = () => {
      const end = Math.min(res, row + rowsPerChunk);
      for (; row < end; row++) {
        const z = -MAP_SIZE / 2 + row * step;
        for (let i = 0; i < res; i++) {
          const x = -MAP_SIZE / 2 + i * step;
          const [qx, qz] = warp(x, z);
          const d0 = coastRaw(x, z, qx, qz);
          const idx = row * res + i;
          raw[idx] = d0;
          qxA[idx] = qx;
          qzA[idx] = qz;
          cliffA[idx] = smoothstep(0.56, 0.66, simplex.fbm(qx * 0.0032 + 50, qz * 0.0032, 3));
          landMask[idx] = d0 > 0 ? 1 : 0;
          seaMask[idx] = d0 > 0 ? 0 : 1;
        }
      }
      onProgress((row / res) * 0.45);
      if (row < res) setTimeout(passA, 0);
      else setTimeout(passB, 0);
    };

    // ---- pass B: signed distance in metres
    let dist: Float32Array;
    const passB = () => {
      const toSea = edt2d(seaMask, res);
      const toLand = edt2d(landMask, res);
      dist = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        // land: distance to nearest sea cell; sea: negative distance to land. Shift by half a cell for continuity
        dist[i] = landMask[i] ? (Math.sqrt(toSea[i]) - 0.5) * step : -(Math.sqrt(toLand[i]) - 0.5) * step;
      }
      onProgress(0.5);
      row = 0;
      setTimeout(passC, 0);
    };

    // ---- pass C: heights
    let minH = Infinity, maxH = -Infinity;
    const passC = () => {
      const end = Math.min(res, row + rowsPerChunk);
      for (; row < end; row++) {
        for (let i = 0; i < res; i++) {
          const idx = row * res + i;
          // sub-cell refinement close to the coast using the raw field gradient estimate
          let d = dist[idx];
          if (Math.abs(d) < step * 1.5) {
            const r0 = raw[idx];
            const rx = raw[Math.min(idx + 1, N - 1)] - r0;
            const rz = raw[Math.min(idx + res, N - 1)] - r0;
            const g = Math.max(0.3, Math.hypot(rx, rz) / step);
            const dn = r0 / g;
            d = mix(dn, d, smoothstep(step * 0.5, step * 1.5, Math.abs(d)));
          }
          const h = heightFromDistance(d, cliffA[idx], qxA[idx], qzA[idx], -MAP_SIZE / 2 + i * step, -MAP_SIZE / 2 + row * step);
          data[idx] = h;
          if (h < minH) minH = h;
          if (h > maxH) maxH = h;
        }
      }
      onProgress(0.5 + (row / res) * 0.5);
      if (row < res) setTimeout(passC, 0);
      else resolve(makeField(data, res, minH, maxH));
    };

    setTimeout(passA, 0);
  });
}

function makeField(data: Float32Array, res: number, minH: number, maxH: number): HeightField {
  const size = MAP_SIZE;
  const step = size / (res - 1);
  const sample = (x: number, z: number) => {
    const fx = clamp((x + size / 2) / step, 0, res - 1.001);
    const fz = clamp((z + size / 2) / step, 0, res - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const i00 = iz * res + ix;
    const h00 = data[i00], h10 = data[i00 + 1], h01 = data[i00 + res], h11 = data[i00 + res + 1];
    return mix(mix(h00, h10, tx), mix(h01, h11, tx), tz);
  };
  const normal = (x: number, z: number, out: [number, number, number] = [0, 1, 0]) => {
    const e = 1.2;
    const hl = sample(x - e, z), hr = sample(x + e, z);
    const hd = sample(x, z - e), hu = sample(x, z + e);
    const nx = hl - hr, ny = 2 * e, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  };
  return { data, res, size, minH, maxH, sample, normal };
}
