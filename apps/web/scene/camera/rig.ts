/**
 * F1 camera. The pose lives in float64 (floating origin, §6.3): the three.js cameras always sit at the origin and only
 * take the orientation + FOV. Orbit ↔ flight ↔ warp transitions are continuous (slerp ≤ 400 ms, no snaps).
 */
import * as THREE from 'three';
import type { CameraMode, Vec3d } from '@/stores/universe';
import type { InputState } from './input';

export interface NearestMass {
  distance: number; // to the centre
  radius: number;
  center: Vec3d;
}

export interface RigEnv {
  nearestMass: (pos: Float64Array) => NearestMass | null;
  reducedMotion: boolean;
  /** Orbit zoom-out escalation: star → galaxy → supercluster. */
  onZoomOut?: (mode: CameraMode) => void;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

export const smoother = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
const damp = (current: number, goal: number, lambda: number, dt: number) => goal + (current - goal) * Math.exp(-lambda * dt);

function lookQuat(from: ArrayLike<number>, to: ArrayLike<number>, out: THREE.Quaternion, up = UP): THREE.Quaternion {
  tmpV.set(from[0]!, from[1]!, from[2]!);
  tmpV2.set(to[0]!, to[1]!, to[2]!);
  if (tmpV.distanceToSquared(tmpV2) < 1e-12) return out;
  // Matrix4.lookAt works in float32; use the direction only (well conditioned).
  tmpV2.sub(tmpV).normalize();
  tmpV.set(0, 0, 0);
  tmpM.lookAt(tmpV, tmpV2, up);
  return out.setFromRotationMatrix(tmpM);
}

export interface Warp {
  t: number;
  dur: number;
  p: [Vec3d, Vec3d, Vec3d, Vec3d];
  q0: THREE.Quaternion;
  target: Vec3d;
  arrivalDist: number;
  radius: number;
  fade: boolean;
}

export class CameraRig {
  pos = new Float64Array([0, 0, 1000]);
  quat = new THREE.Quaternion();
  fov = 60;
  mode: CameraMode = 'orbit';

  // orbit
  target = new Float64Array(3);
  dist = 80;
  distGoal = 80;
  minDist = 2;
  maxDist = 400;
  yaw = 0.7;
  pitch = 0.32;
  yawVel = 0;
  pitchVel = 0;
  autoRotateSpeed = 0.15;
  idle = 0;
  focusRadius = 1;
  orbitKind: 'star' | 'galaxy' | 'supercluster' = 'star';

  // flight
  vel = new Float64Array(3);
  speed = 0;

  warp: Warp | null = null;
  /** Remaining time of an orientation hand-off slerp (≤ 400 ms). */
  private blend = 0;
  private blendFrom = new THREE.Quaternion();
  cinematic = false;
  /** 0..1 progress mirrors for the post-processing warp effect / UI. */
  warpAmount = 0;
  arrivalFlash = 0;
  fadeOverlay = 0;

  snapshot(): { pos: Vec3d; quat: [number, number, number, number]; target: Vec3d } {
    return {
      pos: [this.pos[0]!, this.pos[1]!, this.pos[2]!],
      quat: [this.quat.x, this.quat.y, this.quat.z, this.quat.w],
      target: [this.target[0]!, this.target[1]!, this.target[2]!],
    };
  }

  private beginBlend() {
    this.blendFrom.copy(this.quat);
    this.blend = 0.4;
  }

  /** Orbit around a point. Keeps the current camera position (derives yaw/pitch/dist) so nothing snaps. */
  orbitAround(target: Vec3d, radius: number, opts: { dist?: number; kind?: CameraRig['orbitKind']; keepPosition?: boolean } = {}) {
    this.target.set(target);
    this.focusRadius = radius;
    this.orbitKind = opts.kind ?? 'star';
    this.minDist = this.orbitKind === 'star' ? 1.5 * radius : radius * 0.05;
    this.maxDist = this.orbitKind === 'star' ? 400 : this.orbitKind === 'galaxy' ? radius * 3.2 : radius * 6;
    const dx = this.pos[0]! - target[0];
    const dy = this.pos[1]! - target[1];
    const dz = this.pos[2]! - target[2];
    const d = Math.hypot(dx, dy, dz);
    if (opts.keepPosition !== false && d > 1e-6) {
      this.dist = d;
      this.yaw = Math.atan2(dx, dz);
      this.pitch = Math.asin(Math.max(-1, Math.min(1, dy / d)));
    }
    this.distGoal = Math.max(this.minDist, Math.min(this.maxDist, opts.dist ?? this.dist));
    this.mode = this.orbitKind === 'galaxy' ? 'galaxy' : this.orbitKind === 'supercluster' ? 'supercluster' : 'orbit';
    this.beginBlend();
  }

  enterFlight() {
    if (this.mode === 'warp') return;
    this.mode = 'flight';
    this.vel.fill(0);
  }

  exitFlight(env: RigEnv) {
    const m = env.nearestMass(this.pos);
    if (m && m.distance < 400) this.orbitAround(m.center, m.radius, { kind: 'star' });
    else {
      // orbit a point 100 u ahead
      tmpV.set(0, 0, -100).applyQuaternion(this.quat);
      this.orbitAround([this.pos[0]! + tmpV.x, this.pos[1]! + tmpV.y, this.pos[2]! + tmpV.z], 1, { kind: 'star' });
    }
  }

  /** Autopilot on a cubic Bézier that bows out of the galactic plane (F1 warp). */
  warpTo(target: Vec3d, radius: number, env: RigEnv, frameDist?: number) {
    const arrival = frameDist ?? Math.max(6 * radius, 60);
    const start: Vec3d = [this.pos[0]!, this.pos[1]!, this.pos[2]!];
    let dx = start[0] - target[0];
    let dy = start[1] - target[1];
    let dz = start[2] - target[2];
    const d = Math.hypot(dx, dy, dz) || 1;
    dx /= d;
    dy /= d;
    dz /= d;
    // arrive from slightly above, on the side we came from
    const ay = Math.max(0.18, Math.min(0.6, dy + 0.25));
    const h = Math.hypot(dx, dz) || 1;
    const scale = Math.sqrt(1 - ay * ay);
    const end: Vec3d = [target[0] + (dx / h) * scale * arrival, target[1] + ay * arrival, target[2] + (dz / h) * scale * arrival];
    const dist = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    if (env.reducedMotion || dist < 1e-3) {
      // Reduced motion: 400 ms crossfade instead of a flight.
      this.pos.set(end);
      this.fadeOverlay = 1;
      this.warp = null;
      this.orbitAround(target, radius, { kind: 'star' });
      this.quat.copy(lookQuat(this.pos, target, tmpQ));
      this.blend = 0;
      return;
    }
    const bow = Math.min(dist * 0.18, 60_000);
    const p1: Vec3d = [
      start[0] + (end[0] - start[0]) * 0.25,
      start[1] + (end[1] - start[1]) * 0.25 + bow,
      start[2] + (end[2] - start[2]) * 0.25,
    ];
    const p2: Vec3d = [
      start[0] + (end[0] - start[0]) * 0.75,
      start[1] + (end[1] - start[1]) * 0.75 + bow,
      start[2] + (end[2] - start[2]) * 0.75,
    ];
    const dur = Math.max(1.5, Math.min(3.5, 1.2 + 0.45 * Math.log10(Math.max(1, dist))));
    this.warp = { t: 0, dur, p: [start, p1, p2, end], q0: this.quat.clone(), target, arrivalDist: arrival, radius, fade: false };
    this.mode = 'warp';
    this.cinematic = false;
  }

  private bezier(t: number, out: Float64Array) {
    const [a, b, c, d] = this.warp!.p;
    const u = 1 - t;
    const k0 = u * u * u;
    const k1 = 3 * u * u * t;
    const k2 = 3 * u * t * t;
    const k3 = t * t * t;
    for (let i = 0; i < 3; i++) out[i] = a[i]! * k0 + b[i]! * k1 + c[i]! * k2 + d[i]! * k3;
  }

  update(dt: number, input: InputState, env: RigEnv) {
    this.arrivalFlash = Math.max(0, this.arrivalFlash - dt * 3);
    this.fadeOverlay = Math.max(0, this.fadeOverlay - dt / 0.4);
    if (input.anyInput) {
      this.idle = 0;
      if (this.cinematic && this.mode !== 'warp') this.cinematic = false;
    } else this.idle += dt;

    if (this.mode === 'warp' && this.warp) {
      const w = this.warp;
      w.t = Math.min(w.dur, w.t + dt);
      const s = smoother(w.t / w.dur);
      this.bezier(s, this.pos);
      const ahead = new Float64Array(3);
      this.bezier(Math.min(1, s + 0.02), ahead);
      const along = lookQuat(this.pos, ahead, new THREE.Quaternion());
      const atTarget = lookQuat(this.pos, w.target, new THREE.Quaternion());
      const q = along.clone().slerp(atTarget, THREE.MathUtils.smoothstep(s, 0.55, 1));
      this.quat.copy(w.q0).slerp(q, THREE.MathUtils.smoothstep(s, 0, 0.18));
      this.fov = 60 + 35 * Math.sin(Math.PI * s) ** 2;
      this.warpAmount = Math.sin(Math.PI * s) ** 1.5;
      if (w.t >= w.dur) {
        this.warp = null;
        this.warpAmount = 0;
        this.fov = 60;
        this.arrivalFlash = 1;
        this.orbitAround(w.target, w.radius, { kind: 'star', dist: w.arrivalDist });
        this.blend = 0;
      }
      return;
    }

    if (this.mode === 'flight') {
      this.updateFlight(dt, input, env);
      return;
    }

    // Orbit-family modes
    const lookSpeed = 0.005;
    if (input.drag) {
      this.yaw -= input.dx * lookSpeed;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + input.dy * lookSpeed));
      this.yawVel = (-input.dx * lookSpeed) / Math.max(dt, 1 / 240);
      this.pitchVel = (input.dy * lookSpeed) / Math.max(dt, 1 / 240);
    } else {
      if (input.gamepad) {
        this.yawVel = -input.gamepad.rx * 1.6;
        this.pitchVel = input.gamepad.ry * 1.6;
      }
      this.yaw += this.yawVel * dt;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + this.pitchVel * dt));
      const decay = Math.exp(-dt * 7);
      this.yawVel *= decay;
      this.pitchVel *= decay;
    }
    if (input.gamepad?.zoom) this.distGoal *= Math.exp(input.gamepad.zoom * dt * 2);
    if (!env.reducedMotion && this.idle > 8 && !input.drag) this.yaw += this.autoRotateSpeed * dt * (this.orbitKind === 'star' ? 1 : 0.15);
    if (this.cinematic) this.yaw += 0.05 * dt;

    if (input.wheel) {
      this.distGoal *= Math.exp(input.wheel * 0.0012);
      if (this.distGoal > this.maxDist * 1.15 && env.onZoomOut) {
        env.onZoomOut(this.orbitKind === 'star' ? 'galaxy' : 'supercluster');
      }
    }
    if (input.pinch) this.distGoal /= input.pinch;
    this.distGoal = Math.max(this.minDist, Math.min(this.maxDist, this.distGoal));

    // pan moves the target in the camera plane
    if (input.pan) {
      const k = this.dist * 0.0015;
      tmpV.set(-input.pan[0] * k, input.pan[1] * k, 0).applyQuaternion(this.quat);
      this.target[0]! += tmpV.x;
      this.target[1]! += tmpV.y;
      this.target[2]! += tmpV.z;
    }

    this.dist = Math.exp(damp(Math.log(this.dist), Math.log(this.distGoal), 6, dt));
    const cp = Math.cos(this.pitch);
    this.pos[0] = this.target[0]! + this.dist * cp * Math.sin(this.yaw);
    this.pos[1] = this.target[1]! + this.dist * Math.sin(this.pitch);
    this.pos[2] = this.target[2]! + this.dist * cp * Math.cos(this.yaw);
    const q = lookQuat(this.pos, this.target, tmpQ);
    if (this.blend > 0) {
      this.blend = Math.max(0, this.blend - dt);
      this.quat.copy(this.blendFrom).slerp(q, smoother(1 - this.blend / 0.4));
    } else this.quat.copy(q);
    this.fov = damp(this.fov, 60, 8, dt);
  }

  private updateFlight(dt: number, input: InputState, env: RigEnv) {
    // mouse look / right stick / touch right-half drag
    const look = 0.0022;
    const yawD = -(input.lookX ?? 0) * look - (input.gamepad?.rx ?? 0) * 1.8 * dt;
    const pitchD = -(input.lookY ?? 0) * look - (input.gamepad?.ry ?? 0) * 1.8 * dt;
    const roll = ((input.keys.has('rollLeft') ? 1 : 0) - (input.keys.has('rollRight') ? 1 : 0) + (input.gamepad?.roll ?? 0)) * 1.2 * dt;
    tmpE.set(pitchD, yawD, roll, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    this.quat.multiply(tmpQ).normalize();

    const m = env.nearestMass(this.pos);
    const dNearest = m ? Math.max(0, m.distance - m.radius) : 40_000;
    const boost = input.keys.has('boost') || input.gamepad?.boost ? 8 : 1;
    this.speed = Math.max(2, Math.min(40_000, 0.8 * dNearest)) * boost;
    const f = (input.keys.has('forward') ? 1 : 0) - (input.keys.has('back') ? 1 : 0) + (input.stick?.[1] ?? 0) + (input.gamepad?.ly ?? 0);
    const s = (input.keys.has('right') ? 1 : 0) - (input.keys.has('left') ? 1 : 0) + (input.stick?.[0] ?? 0) + (input.gamepad?.lx ?? 0);
    const u = (input.keys.has('up') ? 1 : 0) - (input.keys.has('down') ? 1 : 0) + (input.gamepad?.up ?? 0);
    tmpV.set(s, u, -f);
    if (tmpV.lengthSq() > 1) tmpV.normalize();
    tmpV.applyQuaternion(this.quat).multiplyScalar(this.speed);
    const k = 1 - Math.exp(-dt * 4);
    this.vel[0]! += (tmpV.x - this.vel[0]!) * k;
    this.vel[1]! += (tmpV.y - this.vel[1]!) * k;
    this.vel[2]! += (tmpV.z - this.vel[2]!) * k;
    for (let i = 0; i < 3; i++) this.pos[i]! += this.vel[i]! * dt;

    // Soft repulsion field at 1.2·R — never clip through a star.
    if (m) {
      const dx = this.pos[0]! - m.center[0];
      const dy = this.pos[1]! - m.center[1];
      const dz = this.pos[2]! - m.center[2];
      const d = Math.hypot(dx, dy, dz) || 1;
      const limit = 1.2 * m.radius;
      if (d < limit * 1.5) {
        const push = d < limit ? limit - d + limit * 0.5 * dt * 4 : 0;
        const soft = Math.max(0, (limit * 1.5 - d) / (limit * 0.5)) * this.speed * 0.5 * dt;
        const k2 = (push + soft) / d;
        this.pos[0]! += dx * k2;
        this.pos[1]! += dy * k2;
        this.pos[2]! += dz * k2;
      }
    }
    this.fov = damp(
      this.fov,
      60 + Math.min(12, (Math.hypot(this.vel[0]!, this.vel[1]!, this.vel[2]!) / Math.max(1, this.speed)) * 10 * (boost > 1 ? 1 : 0.3)),
      5,
      dt,
    );
  }
}
