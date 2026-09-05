import * as THREE from "three";
import { generateHeightField, HeightField, MAP_SIZE } from "./heightmap";
import { createHeightTexture, createTerrain } from "./terrain";
import { createOcean } from "./ocean";
import { createGrassLayer } from "./grass";
import { createVegetation } from "./vegetation";
import { createSky } from "./sky";
import { FlyControls } from "./controls";

export type Quality = "low" | "medium" | "high";

export interface WorldStats {
  fps: number;
  pos: THREE.Vector3;
  alt: number;
  speed: number;
  fov: number;
  triangles: number;
  counts: Record<string, number>;
}

const QUALITY: Record<Quality, { grassNear: number; grassFar: number; shadow: number; veg: number; pixelRatio: number; grassShadow: boolean }> = {
  low: { grassNear: 25000, grassFar: 30000, shadow: 2048, veg: 0.5, pixelRatio: 1, grassShadow: false },
  medium: { grassNear: 60000, grassFar: 70000, shadow: 4096, veg: 0.85, pixelRatio: 1.5, grassShadow: true },
  high: { grassNear: 110000, grassFar: 120000, shadow: 4096, veg: 1.0, pixelRatio: 2, grassShadow: true },
};

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls!: FlyControls;
  field!: HeightField;
  sun!: THREE.DirectionalLight;
  sunDir = new THREE.Vector3(-0.42, 0.52, 0.74).normalize();
  private clock = new THREE.Clock();
  private updaters: Array<(t: number, cam: THREE.Vector3) => void> = [];
  private raf = 0;
  private frames = 0;
  private fpsTime = 0;
  private fps = 0;
  private counts: Record<string, number> = {};
  paused = false;
  onStats?: (s: WorldStats) => void;

  constructor(public canvas: HTMLCanvasElement, public quality: Quality) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[quality].pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 30000);
  }

  async init(onProgress: (p: number, label: string) => void) {
    onProgress(0, "生成地形高度场…");
    this.field = await generateHeightField((p) => onProgress(p * 0.6, "生成地形高度场…"));
    const q = QUALITY[this.quality];

    onProgress(0.62, "构建地形网格…");
    await nextFrame();
    const fogColor = new THREE.Color(0.78, 0.84, 0.90);
    this.scene.fog = new THREE.FogExp2(fogColor, 0.00042);

    const heightTex = createHeightTexture(this.field);
    const terrain = createTerrain(this.field, this.sunDir);
    this.scene.add(terrain.mesh);

    onProgress(0.72, "生成海洋与天空…");
    await nextFrame();
    const sky = createSky(this.sunDir);
    this.scene.add(sky.mesh);
    this.updaters.push((t, cam) => { sky.uniforms.uTime.value = t; sky.mesh.position.copy(cam); });

    const ocean = createOcean(heightTex, this.sunDir, fogColor);
    this.scene.add(ocean.group);
    this.updaters.push(ocean.update);

    // environment map from sky for PBR ambient
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = createSky(this.sunDir);
    envScene.add(envSky.mesh);
    const envRT = pmrem.fromScene(envScene, 0.02);
    this.scene.environment = envRT.texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    onProgress(0.8, "种植草地…");
    await nextFrame();
    const grassNear = createGrassLayer(heightTex, {
      region: 64, count: q.grassNear, minHeight: 0.35, maxHeight: 0.75, width: 0.05,
      bladesPerTuft: 3, segments: 4, seed: 101, castShadow: q.grassShadow,
    });
    const grassFar = createGrassLayer(heightTex, {
      region: 220, count: q.grassFar, minHeight: 0.55, maxHeight: 1.0, width: 0.11,
      bladesPerTuft: 3, segments: 3, seed: 202, castShadow: false,
    });
    this.scene.add(grassNear.mesh, grassFar.mesh);
    this.updaters.push(grassNear.update, grassFar.update);

    onProgress(0.88, "种植森林与岩石…");
    await nextFrame();
    const veg = createVegetation(this.field, q.veg);
    this.scene.add(veg.group);
    this.updaters.push((t) => veg.update(t));
    this.counts = { ...veg.counts, grass: q.grassNear + q.grassFar };

    onProgress(0.95, "布置光照…");
    await nextFrame();
    // lights
    const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.95, 0.85), 3.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 900;
    sun.shadow.camera.left = -140;
    sun.shadow.camera.right = 140;
    sun.shadow.camera.top = 140;
    sun.shadow.camera.bottom = -140;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    sun.shadow.radius = 2;
    sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(sun, sun.target);
    this.sun = sun;

    const hemi = new THREE.HemisphereLight(new THREE.Color(0.55, 0.7, 0.95), new THREE.Color(0.35, 0.3, 0.2), 0.45);
    this.scene.add(hemi);

    // camera & controls
    this.controls = new FlyControls(this.camera, this.canvas, this.field);
    this.pickStartPosition();

    window.addEventListener("resize", this.onResize);
    onProgress(1, "完成");
  }

  private pickStartPosition() {
    // find a coastal hilltop with the sea in view
    const f = this.field;
    let best: { x: number; z: number; h: number; dir: number; score: number } | null = null;
    for (let a = 0; a < 360; a += 3) {
      for (let r = 150; r < 720; r += 12) {
        const x = Math.cos((a * Math.PI) / 180) * r;
        const z = Math.sin((a * Math.PI) / 180) * r;
        if (Math.abs(x) > MAP_SIZE / 2 - 60 || Math.abs(z) > MAP_SIZE / 2 - 60) continue;
        const h = f.sample(x, z);
        if (h < 18 || h > 45) continue;
        // look for water within 60-220m in some direction
        for (let d = 0; d < 360; d += 20) {
          const dx = Math.cos((d * Math.PI) / 180), dz = Math.sin((d * Math.PI) / 180);
          let water = 0, beach = 0;
          for (let s = 40; s <= 240; s += 12) {
            const hh = f.sample(x + dx * s, z + dz * s);
            if (hh < 0) water++;
            else if (hh < 2.5) beach++;
          }
          const score = water * 1.0 + beach * 1.5 + (h - 18) * 0.05;
          if (water > 6 && beach > 2 && (!best || score > best.score)) best = { x, z, h, dir: Math.atan2(dz, dx), score };
        }
      }
    }
    if (!best) best = { x: 0, z: 0, h: f.sample(0, 0), dir: 0, score: 0 };
    this.camera.position.set(best.x, best.h + 6, best.z);
    const target = new THREE.Vector3(best.x + Math.cos(best.dir) * 150, 0, best.z + Math.sin(best.dir) * 150);
    this.controls.lookAt(target);
    this.controls.pitch = Math.max(this.controls.pitch, -0.22);
  }

  teleport(kind: "beach" | "hill" | "peak" | "sea") {
    const f = this.field;
    const cands: Array<{ x: number; z: number; h: number }> = [];
    for (let i = 0; i < 4000; i++) {
      const x = (Math.random() * 2 - 1) * (MAP_SIZE / 2 - 60);
      const z = (Math.random() * 2 - 1) * (MAP_SIZE / 2 - 60);
      const h = f.sample(x, z);
      cands.push({ x, z, h });
    }
    let pick: { x: number; z: number; h: number } | undefined;
    if (kind === "beach") pick = cands.find((c) => c.h > 0.6 && c.h < 1.6);
    else if (kind === "hill") pick = cands.find((c) => c.h > 40 && c.h < 90);
    else if (kind === "peak") pick = cands.sort((a, b) => b.h - a.h)[0];
    else pick = cands.find((c) => c.h < -8 && c.h > -20);
    if (!pick) return;
    const eye = kind === "peak" ? 30 : kind === "sea" ? 3 : 1.7;
    this.camera.position.set(pick.x, Math.max(pick.h, 0) + eye, pick.z);
    this.controls.lookAt(new THREE.Vector3(0, kind === "peak" ? 0 : Math.max(pick.h, 0), 0));
    if (kind !== "peak") this.controls.pitch = -0.08;
  }

  private onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  start() {
    this.clock.start();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, this.clock.getDelta());
      const t = this.clock.elapsedTime;
      if (!this.paused) this.controls.update(dt);
      const cam = this.camera.position;
      for (const u of this.updaters) u(t, cam);

      // shadow frustum follows camera
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      fwd.normalize();
      const texel = 280 / this.sun.shadow.mapSize.x;
      const tx = Math.round((cam.x + fwd.x * 70) / (texel * 4)) * texel * 4;
      const tz = Math.round((cam.z + fwd.z * 70) / (texel * 4)) * texel * 4;
      const ty = Math.round(Math.max(this.field.sample(THREE.MathUtils.clamp(tx, -HALF, HALF), THREE.MathUtils.clamp(tz, -HALF, HALF)), 0) / 4) * 4;
      this.sun.target.position.set(tx, ty, tz);
      this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 450);
      this.sun.target.updateMatrixWorld();

      this.renderer.render(this.scene, this.camera);

      this.frames++;
      this.fpsTime += dt;
      if (this.fpsTime >= 0.5) {
        this.fps = this.frames / this.fpsTime;
        this.frames = 0;
        this.fpsTime = 0;
        this.onStats?.({
          fps: this.fps,
          pos: cam.clone(),
          alt: cam.y - Math.max(this.field.sample(THREE.MathUtils.clamp(cam.x, -HALF, HALF), THREE.MathUtils.clamp(cam.z, -HALF, HALF)), 0),
          speed: this.controls.speed,
          fov: this.controls.fov,
          triangles: this.renderer.info.render.triangles,
          counts: this.counts,
        });
      }
    };
    loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.controls?.destroy();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
  }
}

const HALF = MAP_SIZE / 2 - 10;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
