// Shared GLSL snippets

export const GLSL_NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = m * p + 3.7;
    a *= 0.5;
  }
  return v;
}
float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = m * p + 3.7;
    a *= 0.5;
  }
  return v / 0.875;
}
float ridged(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    v += a * n * n;
    p = m * p + 1.3;
    a *= 0.5;
  }
  return v;
}
// returns (F1 distance, cell hash)
vec2 voronoi(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float md = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) { md = d; id = hash12(n + g); }
    }
  }
  return vec2(sqrt(md), id);
}
`;

export const GLSL_HEIGHT_SAMPLER = /* glsl */ `
uniform sampler2D uHeightTex;
uniform float uMapSize;
uniform float uMapRes;
// bilinear sample of float heightmap (no float-linear extension needed)
float sampleHeight(vec2 xz) {
  vec2 f = (xz / uMapSize + 0.5) * (uMapRes - 1.0);
  f = clamp(f, vec2(0.0), vec2(uMapRes - 1.001));
  ivec2 i = ivec2(floor(f));
  vec2 t = fract(f);
  float h00 = texelFetch(uHeightTex, i, 0).r;
  float h10 = texelFetch(uHeightTex, i + ivec2(1, 0), 0).r;
  float h01 = texelFetch(uHeightTex, i + ivec2(0, 1), 0).r;
  float h11 = texelFetch(uHeightTex, i + ivec2(1, 1), 0).r;
  return mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y);
}
bool insideMap(vec2 xz) {
  return all(lessThan(abs(xz), vec2(uMapSize * 0.5 - 2.0)));
}
vec3 sampleTerrainNormal(vec2 xz) {
  float e = 1.2;
  float hl = sampleHeight(xz - vec2(e, 0.0));
  float hr = sampleHeight(xz + vec2(e, 0.0));
  float hd = sampleHeight(xz - vec2(0.0, e));
  float hu = sampleHeight(xz + vec2(0.0, e));
  return normalize(vec3(hl - hr, 2.0 * e, hd - hu));
}
`;

export const GLSL_SKY = /* glsl */ `
uniform vec3 uSunDir;
vec3 skyColor(vec3 dir) {
  float y = dir.y;
  vec3 zenith = vec3(0.10, 0.32, 0.75);
  vec3 horizon = vec3(0.70, 0.80, 0.90);
  vec3 col = mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.55));
  float sunAmt = max(dot(dir, uSunDir), 0.0);
  // warm haze around sun
  col += vec3(1.0, 0.75, 0.45) * pow(sunAmt, 6.0) * 0.28 * (1.0 - clamp(y, 0.0, 1.0) * 0.6);
  col += vec3(1.0, 0.9, 0.7) * pow(sunAmt, 64.0) * 0.6;
  // below horizon: fade to sea haze
  col = mix(col, vec3(0.55, 0.66, 0.78), smoothstep(0.0, -0.15, y));
  return col;
}
`;
