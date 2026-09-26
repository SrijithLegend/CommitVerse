/**
 * The imperative core (§6.1 rule: React owns structure; per-frame work happens here against refs and typed arrays).
 * Frame order (§6.9): input → camera (float64) → camera-relative updates → LOD → animate → far/near render → post.
 */
import { glsl, skyboxFragment, skyboxVertex } from '@commitverse/shaders';
import type { Manifest } from '@commitverse/universe-core';
import { dequantizeRadius, dequantizeTemperature, unpackFlags } from '@commitverse/universe-core';
import * as THREE from 'three';
import { Api } from '@/lib/client/api';
import { prefersReducedMotion, type QualityTier, useSettings } from '@/lib/client/settings';
import { type Focus, type FocusStar, sceneCommands, useUniverse, type Vec3d } from '@/stores/universe';
import { InputController } from './camera/input';
import { CameraRig, type NearestMass, type RigEnv } from './camera/rig';
import { FREEZE } from './context';
import { createPost, type PostStack } from './post/composer';
import { AdaptiveQuality, TIERS } from './quality';
import { createShared, type SharedPointUniforms } from './tiles/materials';
import { TileManager } from './tiles/TileManager';
import type { PointHit } from './tiles/tile.worker';

export interface NearStar extends PointHit {
  distance: number;
  radius: number;
  temperature: number;
  state: 'protostar' | 'main' | 'red_giant' | 'white_dwarf';
}

export interface BlackHoleView {
  position: Vec3d;
  rs: number; // world units
}

const STATE_SCALE: Record<string, number> = { red_giant: 1.8, white_dwarf: 0.35 };

export class Engine {
  readonly far = new THREE.Scene();
  readonly near = new THREE.Scene();
  readonly farCam: THREE.PerspectiveCamera;
  readonly nearCam = new THREE.PerspectiveCamera(60, 1, 0.01, 2000);
  readonly rig = new CameraRig();
  readonly input: InputController;
  readonly tiles: TileManager;
  readonly shared: SharedPointUniforms;
  post: PostStack;
  tier: QualityTier;
  nearStars: NearStar[] = [];
  blackHoles: BlackHoleView[] = [];
  time = 0;
  frame = 0;
  private lastNearest = 0;
  private hoverAt: { x: number; y: number; t: number } | null = null;
  private lastPick = 0;
  private picking = false;
  private briefCache = new Map<number, Promise<void>>();
  private adaptive: AdaptiveQuality;
  private skyRT: THREE.WebGLCubeRenderTarget | null = null;
  private frameTimes: number[] = [];
  readonly raycaster = new THREE.Raycaster();
  /** Near-layer objects that can be clicked (star mesh, planets). Registered by components. */
  readonly pickables = new Set<THREE.Object3D>();
  onFps?: (fps: number) => void;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    farCam: THREE.PerspectiveCamera,
    tier: QualityTier,
    tilesBase: string,
  ) {
    this.farCam = farCam;
    farCam.near = 10;
    farCam.far = 5e6;
    farCam.position.set(0, 0, 0);
    this.tier = tier;
    this.shared = createShared();
    this.tiles = new TileManager(this.shared, tilesBase);
    this.far.add(this.tiles.group, this.tiles.deltaGroup);
    this.input = new InputController(renderer.domElement);
    this.post = createPost(renderer, this.far, this.farCam, this.near, this.nearCam, tier);
    this.adaptive = new AdaptiveQuality(1000 / 60, (step) => this.applyAdaptive(step));
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.far.background = new THREE.Color(0x03040a);
    this.applyTier(tier);
    this.buildSkybox(TIERS[tier].skybox);

    this.input.onHover = (x, y) => {
      this.hoverAt = { x, y, t: performance.now() };
    };
    this.input.onTap = (x, y, double) => void this.select(x, y, double);
    renderer.domElement.addEventListener('webglcontextlost', this.onContextLost, false);
    renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored, false);
  }

  // ─── Setup ────────────────────────────────────────────────────────────

  setManifest(m: Manifest, deltaUrl: string, deltaEtag: string | null) {
    this.tiles.version = m.bakeVersion;
    this.tiles.setManifest(m);
    this.tiles.setDelta(deltaUrl, deltaEtag);
  }

  applyTier(tier: QualityTier) {
    this.tier = tier;
    const cfg = TIERS[tier];
    this.tiles.pointBudget = cfg.maxPoints;
    this.tiles.openThresholdPx = cfg.openThresholdPx;
    const dpr = FREEZE ? 1 : Math.min(window.devicePixelRatio || 1, cfg.dprCap);
    this.renderer.setPixelRatio(dpr);
    this.shared.uPixelRatio.value = dpr;
    this.post.setTier(tier, useSettings.getState().bloom);
    this.adaptive.setBudget(tier === 'low' ? 1000 / 30 : 1000 / 60);
    // store updates are deferred: applyTier also runs inside the constructor (during React render)
    queueMicrotask(() => useUniverse.getState().set({ tier }));
  }

  /** Fine-grained ladder: DPR first, then bloom, then points. */
  private applyAdaptive(step: number) {
    if (useSettings.getState().quality !== 'auto') return;
    const cfg = TIERS[this.tier];
    const dpr = Math.max(0.6, Math.min(window.devicePixelRatio || 1, cfg.dprCap) * (1 - Math.min(step, 2) * 0.2));
    this.renderer.setPixelRatio(dpr);
    this.shared.uPixelRatio.value = dpr;
    this.post.bloomPass.enabled = useSettings.getState().bloom && step < 3;
    this.tiles.pointBudget = Math.round(cfg.maxPoints * (step >= 4 ? 0.5 : 1));
    this.tiles.openThresholdPx = cfg.openThresholdPx * (step >= 5 ? 1.6 : 1);
  }

  private buildSkybox(size: number) {
    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    const cam = new THREE.CubeCamera(0.1, 10, rt);
    const scene = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      vertexShader: skyboxVertex,
      fragmentShader: glsl(skyboxFragment),
      uniforms: { uSeed: { value: 17.23 }, uDensity: { value: size >= 2048 ? 1.4 : size >= 1024 ? 1.15 : 1 } },
      side: THREE.BackSide,
      depthWrite: false,
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(5, 64, 32), mat));
    cam.update(this.renderer, scene);
    mat.dispose();
    this.skyRT?.dispose();
    this.skyRT = rt;
    this.far.background = rt.texture;
  }

  // ─── Picking & selection (§6.7) ───────────────────────────────────────

  private viewProj(): THREE.Matrix4 {
    return new THREE.Matrix4().multiplyMatrices(this.farCam.projectionMatrix, this.farCam.matrixWorldInverse);
  }

  private nearPick(x: number, y: number): THREE.Intersection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.nearCam);
    const hits = this.raycaster.intersectObjects([...this.pickables], false);
    return hits[0] ?? null;
  }

  async pickAt(x: number, y: number): Promise<PointHit | null> {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return this.tiles.pick(
      this.rig.pos,
      this.viewProj(),
      rect.width,
      rect.height,
      x - rect.left,
      y - rect.top,
      this.shared.uPixelRatio.value,
    );
  }

  private async select(x: number, y: number, double: boolean) {
    const near = this.nearPick(x, y);
    if (near) {
      const ud = near.object.userData as { kind?: string; slot?: number; githubId?: number };
      if (ud.kind === 'planet' && ud.slot !== undefined) {
        sceneCommands.push({ type: 'focusPlanet', slot: ud.slot });
        useUniverse.getState().set({ panel: 'planet' });
        return;
      }
      if (ud.kind === 'comet') {
        window.dispatchEvent(new CustomEvent('cv:comet-click', { detail: near.object.userData }));
        return;
      }
    }
    const hit = await this.pickAt(x, y);
    if (!hit || !hit.githubId) return;
    const [brief] = (await Api.briefs([hit.githubId]).catch(() => ({ stars: [] }))).stars;
    if (!brief) return;
    const focus: FocusStar = {
      kind: 'star',
      githubId: hit.githubId,
      login: brief.login,
      position: hit.position,
      radius: brief.radius,
      temperature: brief.temperature,
      starIndex: hit.starIndex,
    };
    const s = useUniverse.getState();
    s.set({ focus, history: [...s.history.slice(-20), s.focus], panel: 'system', focusDetail: null });
    if (double) sceneCommands.push({ type: 'warpTo', position: hit.position, radius: brief.radius });
  }

  private hoverTick(now: number) {
    if (!this.hoverAt || this.picking || now - this.lastPick < 33) return;
    const at = this.hoverAt;
    this.hoverAt = null;
    this.lastPick = now;
    this.picking = true;
    void this.pickAt(at.x, at.y)
      .then(async (hit) => {
        const s = useUniverse.getState();
        if (!hit || !hit.githubId) {
          if (s.hover) s.set({ hover: null });
          return;
        }
        if (s.hover?.githubId === hit.githubId) {
          s.set({ hover: { ...s.hover, screen: [at.x, at.y] } });
          return;
        }
        const hover = {
          githubId: hit.githubId,
          starIndex: hit.starIndex,
          position: hit.position,
          screen: [at.x, at.y] as [number, number],
          kind: 'star' as const,
        };
        s.set({ hover });
        if (!this.briefCache.has(hit.githubId)) {
          this.briefCache.set(
            hit.githubId,
            Api.briefs([hit.githubId])
              .then((r) => {
                const cur = useUniverse.getState().hover;
                if (cur?.githubId === hit.githubId && r.stars[0]) useUniverse.getState().set({ hover: { ...cur, brief: r.stars[0] } });
              })
              .catch(() => {}),
          );
        }
      })
      .finally(() => {
        this.picking = false;
      });
  }

  // ─── Environment for the rig ──────────────────────────────────────────

  private nearestMass = (pos: Float64Array): NearestMass | null => {
    let best: NearestMass | null = null;
    const consider = (c: Vec3d, radius: number) => {
      const d = Math.hypot(pos[0]! - c[0], pos[1]! - c[1], pos[2]! - c[2]);
      if (!best || d - radius < best.distance - best.radius) best = { distance: d, radius, center: c };
    };
    const f = useUniverse.getState().focus;
    if (f?.kind === 'star') consider(f.position, f.radius);
    for (const s of this.nearStars) consider(s.position, s.radius);
    const m = useUniverse.getState().manifest;
    if (m && (!best || (best as NearestMass).distance > 2000)) {
      for (const g of m.galaxies) {
        const d = Math.hypot(pos[0]! - g.center[0], pos[1]! - g.center[1], pos[2]! - g.center[2]);
        if (d > g.radius) consider(g.center, g.radius * 0.9);
        else consider([pos[0]! + 160, pos[1]!, pos[2]!], 1); // inside a galaxy: mean star spacing
      }
    }
    return best;
  };

  private rigEnv: RigEnv = {
    nearestMass: this.nearestMass,
    reducedMotion: false,
    onZoomOut: (mode) => {
      const s = useUniverse.getState();
      if (mode === 'galaxy') {
        const f = s.focus;
        const pos: Vec3d = f?.kind === 'star' ? f.position : [this.rig.target[0]!, this.rig.target[1]!, this.rig.target[2]!];
        const g = this.tiles.galaxyAt(pos);
        if (g) sceneCommands.push({ type: 'galaxyView', galaxyId: g.id });
        else sceneCommands.push({ type: 'supercluster' });
      } else sceneCommands.push({ type: 'supercluster' });
    },
  };

  private async updateNearest(now: number) {
    if (now - this.lastNearest < 250) return;
    this.lastNearest = now;
    const count = TIERS[this.tier].nearStars;
    const stars = await this.tiles.nearest([this.rig.pos[0]!, this.rig.pos[1]!, this.rig.pos[2]!], count, 300);
    this.nearStars = stars.map((s) => {
      const { state } = unpackFlags(s.flags);
      return { ...s, radius: dequantizeRadius(s.rq) * (STATE_SCALE[state] ?? 1), temperature: dequantizeTemperature(s.tq), state };
    });
  }

  // ─── Commands ─────────────────────────────────────────────────────────

  private handleCommands() {
    for (const c of sceneCommands.drain()) {
      switch (c.type) {
        case 'warpTo': {
          this.rig.cinematic = false;
          this.tiles.prefetch(c.position);
          this.input.setFlight(false);
          if (c.instant) {
            const d = c.frame ?? Math.max(6 * c.radius, 60);
            this.rig.pos.set([c.position[0] + d * 0.6, c.position[1] + d * 0.35, c.position[2] + d * 0.7]);
            this.rig.orbitAround(c.position, c.radius, { kind: 'star', dist: d });
          } else this.rig.warpTo(c.position, c.radius, this.rigEnv, c.frame);
          const g = this.tiles.galaxyAt(c.position);
          useUniverse.getState().set({ mode: 'warp' });
          void Api.stats({ type: 'warp', galaxy: g?.language });
          break;
        }
        case 'galaxyView': {
          const m = useUniverse.getState().manifest;
          const g = m?.galaxies.find((x) => x.id === c.galaxyId) ?? m?.galaxies[0];
          if (!g) break;
          this.input.setFlight(false);
          if (this.rig.mode === 'flight' || this.rig.mode === 'warp') this.rig.warp = null;
          this.rig.orbitAround(g.center, g.radius, { kind: 'galaxy', dist: Math.max(g.radius * 2.2, this.rig.dist), keepPosition: true });
          this.rig.pitch = Math.max(this.rig.pitch, 0.5);
          this.rig.distGoal = g.radius * 2.2;
          useUniverse.getState().set({ focus: { kind: 'galaxy', galaxyId: g.id }, mode: 'galaxy', panel: null });
          break;
        }
        case 'supercluster': {
          const m = useUniverse.getState().manifest;
          if (!m) break;
          const n = m.galaxies.length || 1;
          const c0: Vec3d = [0, 0, 0];
          for (const g of m.galaxies) for (let i = 0; i < 3; i++) c0[i]! += g.center[i]! / n;
          const extent = Math.max(
            ...m.galaxies.map((g) => Math.hypot(g.center[0] - c0[0], g.center[1] - c0[1], g.center[2] - c0[2]) + g.radius),
          );
          this.input.setFlight(false);
          this.rig.warp = null;
          this.rig.orbitAround(c0, extent, { kind: 'supercluster', keepPosition: true });
          this.rig.distGoal = extent * 1.6;
          this.rig.pitch = Math.max(this.rig.pitch, 0.6);
          useUniverse.getState().set({ focus: null, mode: 'supercluster', panel: null });
          break;
        }
        case 'flight': {
          if (c.on) {
            this.rig.enterFlight();
            this.input.setFlight(true);
          } else {
            this.input.setFlight(false);
            this.rig.exitFlight(this.rigEnv);
          }
          useUniverse.getState().set({ mode: this.rig.mode });
          break;
        }
        case 'cinematic':
          if (FREEZE) break; // the idle tour runs on wall-clock timers; frozen frames must not depend on them
          this.rig.cinematic = true;
          void this.runCinematic();
          break;
        case 'focusPlanet': {
          window.dispatchEvent(new CustomEvent('cv:focus-planet', { detail: c.slot }));
          break;
        }
        case 'setPose': {
          this.rig.warp = null;
          this.rig.pos.set(c.pos);
          this.rig.quat.set(...c.quat);
          if (c.target) this.rig.orbitAround(c.target, 1, { kind: 'star' });
          break;
        }
        case 'screenshot':
          this.screenshot(c.preset ?? 'landscape').then(c.resolve, () => c.resolve(null));
          break;
      }
    }
  }

  /** F1 cinematic: galaxy flyby → a random O-class star → a hypergiant → a live comet if any. Any input exits. */
  private async runCinematic() {
    const step = async (ms: number) => new Promise((r) => setTimeout(r, ms));
    const m = useUniverse.getState().manifest;
    if (!m) return;
    const g = m.galaxies[0]!;
    sceneCommands.push({ type: 'galaxyView', galaxyId: g.id });
    await step(9000);
    if (!this.rig.cinematic) return;
    for (const kind of ['hot', 'hyper'] as const) {
      const hit = await this.tiles.find(kind);
      if (!this.rig.cinematic) return;
      if (hit) {
        sceneCommands.push({ type: 'warpTo', position: hit.position, radius: dequantizeRadius(hit.rq) });
        this.rig.cinematic = true;
        await step(11_000);
        if (!this.rig.cinematic) return;
      }
    }
    const comet = useUniverse.getState().comets.at(-1);
    if (comet && this.rig.cinematic) {
      sceneCommands.push({ type: 'warpTo', position: comet.origin, radius: 4 });
      this.rig.cinematic = true;
    }
  }

  // ─── Frame ────────────────────────────────────────────────────────────

  update(dt: number) {
    if (FREEZE) dt = 1 / 60; // fixed step: the camera converges in a deterministic number of frames
    const now = performance.now();
    this.time = FREEZE ? FREEZE.t : this.time + dt;
    this.frame++;
    this.rigEnv.reducedMotion = prefersReducedMotion();
    this.input.pollGamepad();
    this.handleCommands();
    const prevMode = this.rig.mode;
    this.rig.update(Math.min(dt, 0.1), this.input.state, this.rigEnv);
    this.input.reset();
    if (this.rig.mode !== prevMode) useUniverse.getState().set({ mode: this.rig.mode });

    for (const cam of [this.farCam, this.nearCam]) {
      cam.position.set(0, 0, 0);
      cam.quaternion.copy(this.rig.quat);
      cam.fov = this.rig.fov;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    }

    // galaxy fades: points ↔ impostor
    const m = useUniverse.getState().manifest;
    if (m) {
      for (const g of m.galaxies) {
        const d = Math.hypot(this.rig.pos[0]! - g.center[0], this.rig.pos[1]! - g.center[1], this.rig.pos[2]! - g.center[2]) / g.radius;
        this.tiles.galaxyFade.set(g.id, 1 - THREE.MathUtils.smoothstep(d, 2.4, 3.6));
      }
    }
    const f = useUniverse.getState().focus;
    this.shared.uFocusIndex.value = f?.kind === 'star' && f.starIndex !== undefined ? f.starIndex : -1;
    this.tiles.update(this.rig.pos, this.farCam, this.renderer.domElement.clientHeight * this.renderer.getPixelRatio(), now);
    void this.updateNearest(now);
    this.hoverTick(now);
    useUniverse.getState().warp.active !== (this.rig.mode === 'warp') &&
      useUniverse.getState().set({ warp: { active: this.rig.mode === 'warp', progress: 0, target: null } });
  }

  render(dt: number) {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.nearCam.aspect = this.farCam.aspect = size.x / Math.max(1, size.y);
    this.farCam.updateProjectionMatrix();
    this.nearCam.updateProjectionMatrix();
    this.updateLensing(size);
    const style = (() => {
      const w = useUniverse.getState().tryOn.warp ?? null;
      return w === 'warp.tunnel' ? 1 : w === 'warp.glitch_jump' ? 2 : 0;
    })();
    this.post.warp.set(prefersReducedMotion() ? 0 : this.rig.warpAmount, this.rig.arrivalFlash * 0.35, style, this.time);
    this.post.warpPass.enabled = this.rig.warpAmount > 0.001 || this.rig.arrivalFlash > 0.001;
    const t0 = performance.now();
    this.post.composer.render(FREEZE ? 1 / 60 : dt);
    const ms = performance.now() - t0 + dt * 0; // CPU submit time
    this.sampleFrame(dt * 1000, ms);
  }

  private updateLensing(size: THREE.Vector2) {
    const cfg = TIERS[this.tier];
    let best: { uv: THREE.Vector2; rs: number } | null = null;
    for (const bh of this.blackHoles) {
      const rel = new THREE.Vector3(
        bh.position[0] - this.rig.pos[0]!,
        bh.position[1] - this.rig.pos[1]!,
        bh.position[2] - this.rig.pos[2]!,
      );
      const dist = rel.length();
      const p = rel.clone().project(this.farCam);
      if (p.z > 1 || Math.abs(p.x) > 1.3 || Math.abs(p.y) > 1.3) continue;
      const rsUv = bh.rs / dist / (2 * Math.tan(THREE.MathUtils.degToRad(this.farCam.fov) / 2));
      if (rsUv < 0.002) continue;
      if (!best || rsUv > best.rs) best = { uv: new THREE.Vector2(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5), rs: rsUv };
    }
    if (best && cfg.lensing !== 'sprite')
      this.post.lensing.set(best.uv, Math.min(best.rs, 0.2), size.x / size.y, 1, cfg.lensing === 'screen+ring');
    else this.post.lensing.set(new THREE.Vector2(), 0, 1, 0, false);
  }

  private sampleFrame(frameMs: number, _cpuMs: number) {
    const now = performance.now();
    if (useSettings.getState().quality === 'auto' && !FREEZE) this.adaptive.sample(frameMs, now);
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length >= 60) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameTimes = [];
      this.onFps?.(Math.round(1000 / Math.max(1, avg)));
    }
  }

  /** Screen projection for DOM overlays (no three.js import needed on the UI side). */
  projectToScreen(pos: Vec3d): { x: number; y: number; dist: number; visible: boolean; pxPerUnit: number } {
    const v = new THREE.Vector3(pos[0] - this.rig.pos[0]!, pos[1] - this.rig.pos[1]!, pos[2] - this.rig.pos[2]!);
    const dist = v.length();
    v.project(this.farCam);
    const rect = this.renderer.domElement.getBoundingClientRect();
    const visible = v.z <= 1 && Math.abs(v.x) <= 1.2 && Math.abs(v.y) <= 1.2;
    const pxPerUnit = rect.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.farCam.fov) / 2) * Math.max(dist, 1e-3));
    return { x: (v.x * 0.5 + 0.5) * rect.width + rect.left, y: (-v.y * 0.5 + 0.5) * rect.height + rect.top, dist, visible, pxPerUnit };
  }

  // ─── Share-card render (F14): a real render from a flattering preset camera, offscreen at 2× ─────────

  async screenshot(preset: 'landscape' | 'stories'): Promise<Blob | null> {
    const [w, h] = preset === 'landscape' ? [1200, 630] : [1080, 1920];
    const canvas = this.renderer.domElement;
    const prevSize = this.renderer.getSize(new THREE.Vector2());
    const prevDpr = this.renderer.getPixelRatio();
    const f = useUniverse.getState().focus as Focus;
    const saved = { pos: this.rig.pos.slice(), quat: this.rig.quat.clone(), fov: this.rig.fov };
    if (f?.kind === 'star') {
      const d = Math.max(9 * f.radius, 55);
      this.rig.pos.set([f.position[0] + d * 0.55, f.position[1] + d * 0.28, f.position[2] + d * 0.8]);
      const q = new THREE.Matrix4().lookAt(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(f.position[0] - this.rig.pos[0]!, f.position[1] - this.rig.pos[1]!, f.position[2] - this.rig.pos[2]!),
        new THREE.Vector3(0, 1, 0),
      );
      this.rig.quat.setFromRotationMatrix(q);
    }
    this.renderer.setPixelRatio(2);
    this.renderer.setSize(w, h, false);
    this.post.composer.setSize(w, h, false);
    for (const cam of [this.farCam, this.nearCam]) {
      cam.quaternion.copy(this.rig.quat);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    }
    // let near-field components update their camera-relative positions for this pose
    for (const cb of this.preRender) cb();
    this.post.composer.render(0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    this.renderer.setPixelRatio(prevDpr);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.post.composer.setSize(prevSize.x, prevSize.y, false);
    this.rig.pos.set(saved.pos);
    this.rig.quat.copy(saved.quat);
    return blob;
  }

  /** Near-field components register a callback so offscreen renders get correct camera-relative positions. */
  readonly preRender = new Set<() => void>();

  // ─── WebGL context loss (§13.2) ───────────────────────────────────────

  private onContextLost = (e: Event) => {
    e.preventDefault();
    void import('@sentry/nextjs')
      .then((S) => S.captureMessage('webglcontextlost', { level: 'warning', extra: { tier: this.tier } }))
      .catch(() => {});
  };

  private onContextRestored = () => {
    // Rebuild GPU resources from retained typed arrays (attributes keep their arrays).
    this.far.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (g) for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).needsUpdate = true;
    });
    this.shared.uLut.value.needsUpdate = true;
    this.shared.uHidden.value.needsUpdate = true;
    this.buildSkybox(TIERS[this.tier].skybox);
  };

  dispose() {
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.input.dispose();
    this.tiles.dispose();
    this.post.dispose();
    this.skyRT?.dispose();
  }
}
