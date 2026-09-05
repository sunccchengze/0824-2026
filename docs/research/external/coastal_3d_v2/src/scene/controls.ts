import * as THREE from "three";
import { HeightField } from "./heightmap";

export class FlyControls {
  yaw = 0;
  pitch = -0.15;
  speed = 18; // m/s
  fov = 60;
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private velocity = new THREE.Vector3();
  private dispose: () => void;

  constructor(
    public camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private field: HeightField
  ) {
    const onKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
      this.keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onPointerDown = (e: PointerEvent) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const sens = 0.0028 * (this.fov / 60);
      this.yaw -= dx * sens;
      this.pitch -= dy * sens;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    };
    const onPointerUp = (e: PointerEvent) => {
      this.dragging = false;
      try { dom.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.shiftKey) {
        this.speed = Math.max(1, Math.min(200, this.speed * (e.deltaY > 0 ? 1.15 : 0.87)));
      } else {
        this.fov = Math.max(8, Math.min(90, this.fov * (e.deltaY > 0 ? 1.08 : 0.92)));
      }
    };
    const onBlur = () => this.keys.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("pointercancel", onPointerUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    this.dispose = () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointercancel", onPointerUp);
      dom.removeEventListener("wheel", onWheel);
    };
  }

  lookAt(target: THREE.Vector3) {
    const d = target.clone().sub(this.camera.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  private has(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  update(dt: number) {
    const k = this.keys;
    const boost = this.has("ShiftLeft", "ShiftRight") ? 4 : 1;
    const slow = this.has("AltLeft", "AltRight") ? 0.2 : 1;
    const sp = this.speed * boost * slow;

    // rotate with Q/E
    if (k.has("KeyQ")) this.yaw += 1.2 * dt;
    if (k.has("KeyE")) this.yaw -= 1.2 * dt;

    const forward = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (this.has("ArrowUp", "KeyW")) wish.add(forward);
    if (this.has("ArrowDown", "KeyS")) wish.sub(forward);
    if (this.has("ArrowRight", "KeyD")) wish.add(right);
    if (this.has("ArrowLeft", "KeyA")) wish.sub(right);
    if (this.has("Space", "KeyR")) wish.y += 1;
    if (this.has("KeyC", "KeyF")) wish.y -= 1;
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(sp);

    // smooth acceleration
    const accel = 1 - Math.exp(-dt * 8);
    this.velocity.lerp(wish, accel);
    this.camera.position.addScaledVector(this.velocity, dt);

    // keep above ground / water
    const half = this.field.size / 2 - 5;
    const p = this.camera.position;
    p.x = Math.max(-half - 600, Math.min(half + 600, p.x));
    p.z = Math.max(-half - 600, Math.min(half + 600, p.z));
    const ground = Math.abs(p.x) < half && Math.abs(p.z) < half ? this.field.sample(p.x, p.z) : -40;
    const minY = Math.max(ground, 0) + 0.45;
    if (p.y < minY) { p.y = minY; this.velocity.y = Math.max(0, this.velocity.y); }
    p.y = Math.min(p.y, 1500);

    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov += (this.fov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }
  }

  destroy() {
    this.dispose();
  }
}
