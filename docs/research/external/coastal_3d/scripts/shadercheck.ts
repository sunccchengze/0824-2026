/* Offline GLSL validation: assembles three.js shaders like WebGLProgram does and runs glslangValidator */
import * as THREE from "three";
import { ShaderChunk, ShaderLib } from "three";
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { generateHeightField } from "../src/scene/heightmap";
import { createHeightTexture, createTerrain } from "../src/scene/terrain";
import { createOcean } from "../src/scene/ocean";
import { createGrassLayer } from "../src/scene/grass";
import { createVegetation } from "../src/scene/vegetation";
import { createSky } from "../src/scene/sky";

const VALIDATOR = process.env.GLSLANG || "/tmp/glsl/node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux";
const OUT = "/tmp/glsl/out";
mkdirSync(OUT, { recursive: true });

const includePattern = /^[ \t]*#include +<([\w\d./]+)>/gm;
function resolveIncludes(s: string): string {
  return s.replace(includePattern, (_m, name) => {
    const c = (ShaderChunk as Record<string, string>)[name];
    if (c === undefined) throw new Error("Unknown include " + name);
    return resolveIncludes(c);
  });
}
const unrollLoopPattern = /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;
function unroll(s: string) {
  return s.replace(unrollLoopPattern, (_m, start, end, snippet) => {
    let out = "";
    for (let i = parseInt(start); i < parseInt(end); i++) out += snippet.replace(/\[\s*i\s*\]/g, "[ " + i + " ]").replace(/UNROLLED_LOOP_INDEX/g, String(i));
    return out;
  });
}
function lightNums(s: string) {
  return s
    .replace(/NUM_DIR_LIGHTS/g, "1").replace(/NUM_SPOT_LIGHTS/g, "0").replace(/NUM_SPOT_LIGHT_MAPS/g, "0").replace(/NUM_SPOT_LIGHT_COORDS/g, "0")
    .replace(/NUM_RECT_AREA_LIGHTS/g, "0").replace(/NUM_POINT_LIGHTS/g, "0").replace(/NUM_HEMI_LIGHTS/g, "1").replace(/NUM_DIR_LIGHT_SHADOWS/g, "1")
    .replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g, "0").replace(/NUM_SPOT_LIGHT_SHADOWS/g, "0").replace(/NUM_POINT_LIGHT_SHADOWS/g, "0")
    .replace(/NUM_CLIPPING_PLANES/g, "0").replace(/UNION_CLIPPING_PLANES/g, "0");
}

const precision = `precision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp samplerCube;\nprecision highp sampler3D;\nprecision highp sampler2DArray;\nprecision highp sampler2DShadow;\nprecision highp samplerCubeShadow;\nprecision highp sampler2DArrayShadow;\nprecision highp isampler2D;\nprecision highp isampler3D;\nprecision highp isamplerCube;\nprecision highp isampler2DArray;\nprecision highp usampler2D;\nprecision highp usampler3D;\nprecision highp usamplerCube;\nprecision highp usampler2DArray;\n#define HIGH_PRECISION\n`;

function vertexPrefix(defines: string[]) {
  return `#version 300 es
#define attribute in
#define varying out
#define texture2D texture
${precision}
${defines.map((d) => "#define " + d).join("\n")}
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
#ifdef USE_INSTANCING
attribute mat4 instanceMatrix;
#endif
#ifdef USE_INSTANCING_COLOR
attribute vec3 instanceColor;
#endif
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
#ifdef USE_COLOR_ALPHA
attribute vec4 color;
#elif defined( USE_COLOR )
attribute vec3 color;
#endif
`;
}
function fragmentPrefix(defines: string[], builtin: boolean) {
  return `#version 300 es
#define varying in
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
#define gl_FragDepthEXT gl_FragDepth
#define texture2D texture
#define textureCube texture
#define texture2DProj textureProj
#define texture2DLodEXT textureLod
#define texture2DProjLodEXT textureProjLod
#define textureCubeLodEXT textureLod
#define texture2DGradEXT textureGrad
#define texture2DProjGradEXT textureProjGrad
#define textureCubeGradEXT textureGrad
${precision}
${defines.map((d) => "#define " + d).join("\n")}
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
${builtin ? `#define TONE_MAPPING\n${ShaderChunk.tonemapping_pars_fragment}\nvec3 toneMapping( vec3 color ) { return ACESFilmicToneMapping( color ); }\n` : ""}
${ShaderChunk.colorspace_pars_fragment}
vec4 linearToOutputTexel( vec4 value ) { return ( vec4( value.rgb, value.a ) ); }
float luminance( const in vec3 rgb ) { const vec3 weights = vec3( 0.2126729, 0.7151522, 0.0721750 ); return dot( weights, rgb ); }
`;
}

let failures = 0;
function validate(name: string, stage: "vert" | "frag", src: string) {
  const file = `${OUT}/${name}.${stage}`;
  writeFileSync(file, src.replace(/\baverage\b/g, "average_")); // glslang reserved-name quirk
  try {
    execFileSync(VALIDATOR, ["-S", stage, file], { stdio: "pipe" });
    console.log(`  ✔ ${name}.${stage}`);
  } catch (e: unknown) {
    failures++;
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    console.log(`  ✘ ${name}.${stage}\n` + (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? ""));
  }
}

type Shader = { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string };

function checkBuiltin(name: string, mat: THREE.Material, lib: { vertexShader: string; fragmentShader: string }, defines: string[]) {
  const shader: Shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  (mat as unknown as { onBeforeCompile: (s: Shader, r: unknown) => void }).onBeforeCompile(shader, null);
  const vs = vertexPrefix(defines) + unroll(lightNums(resolveIncludes(shader.vertexShader)));
  const fs = fragmentPrefix(defines, true) + unroll(lightNums(resolveIncludes(shader.fragmentShader)));
  validate(name, "vert", vs);
  validate(name, "frag", fs);
}
function checkShaderMaterial(name: string, mat: THREE.ShaderMaterial, defines: string[]) {
  const vs = vertexPrefix(defines) + unroll(lightNums(resolveIncludes(mat.vertexShader)));
  const fs = fragmentPrefix(defines, false) + unroll(lightNums(resolveIncludes(mat.fragmentShader)));
  validate(name, "vert", vs);
  validate(name, "frag", fs);
}

const COMMON = ["USE_FOG", "FOG_EXP2", "USE_SHADOWMAP", "SHADOWMAP_TYPE_PCF_SOFT", "USE_ENVMAP", "ENVMAP_TYPE_CUBE_UV", "ENVMAP_MODE_REFLECTION", "ENVMAP_BLENDING_NONE", "CUBEUV_TEXEL_WIDTH 0.0013", "CUBEUV_TEXEL_HEIGHT 0.00097", "CUBEUV_MAX_MIP 8.0", "OPAQUE"];
const STD = ["STANDARD", ...COMMON];

(async () => {
  console.log("generating heightfield...");
  const field = await generateHeightField(() => {});
  const sunDir = new THREE.Vector3(-0.42, 0.52, 0.74).normalize();
  const tex = createHeightTexture(field);

  console.log("terrain");
  const terrain = createTerrain(field, sunDir);
  checkBuiltin("terrain", terrain.mesh.material as THREE.Material, ShaderLib.physical, STD);

  console.log("ocean");
  const ocean = createOcean(tex, sunDir, new THREE.Color());
  checkShaderMaterial("ocean", ocean.material, ["USE_FOG", "FOG_EXP2", "DOUBLE_SIDED"]);

  console.log("sky");
  const sky = createSky(sunDir);
  checkShaderMaterial("sky", sky.mesh.material as THREE.ShaderMaterial, []);

  console.log("grass");
  const grass = createGrassLayer(tex, { region: 64, count: 10, minHeight: 0.3, maxHeight: 0.7, width: 0.05, bladesPerTuft: 3, segments: 4, seed: 1, castShadow: true });
  checkBuiltin("grass", grass.mesh.material as THREE.Material, ShaderLib.physical, [...STD, "DOUBLE_SIDED"]);
  checkBuiltin("grassDepth", grass.mesh.customDepthMaterial as THREE.Material, ShaderLib.depth, ["DEPTH_PACKING 3201", "DOUBLE_SIDED"]);

  console.log("vegetation");
  const veg = createVegetation(field, 0.05);
  const mats = new Map<string, THREE.Material>();
  veg.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.material) mats.set((m.material as THREE.Material).customProgramCacheKey(), m.material as THREE.Material);
  });
  for (const [k, m] of mats) checkBuiltin(k, m, ShaderLib.physical, [...STD, "USE_COLOR", "USE_INSTANCING"]);

  console.log(failures ? `\n${failures} shader(s) FAILED` : "\nall shaders OK");
  process.exit(failures ? 1 : 0);
})();
