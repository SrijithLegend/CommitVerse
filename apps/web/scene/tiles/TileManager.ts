/**
 * §6.4–6.6 streaming: node selection every 100 ms by projected screen size, 6 in-flight requests, abort stale on warp,
 * LRU eviction by point budget (with geometry.dispose()), prefetch along the warp target's path, delta + hidden layers.
 */
import { type Manifest, type ManifestGalaxy, pathFor, tilePath } from '@commitverse/universe-core';
import * as THREE from 'three';
import {
  createHiddenTexture,
  createPointGeometry,
  createPointMaterial,
  HIDDEN_WIDTH,
  type PointArrays,
  type SharedPointUniforms,
} from './materials';
import type { PointHit, WorkerIn } from './tile.worker';

interface NodeState {
  id: string; // `${galaxyId}/${key}`
  galaxy: ManifestGalaxy;
  key: string;
  count: number;
  radius: number;
  center: [number, number, number]; // galaxy-local cube centre
  children: string[];
  status: 'idle' | 'queued' | 'loading' | 'loaded' | 'failed';
  object: THREE.Points | null;
  lastVisible: number;
  priority: number;
  failures: number;
}

export interface TileStats {
  loadedNodes: number;
  loadedPoints: number;
  inFlight: number;
  queued: number;
  lastDecodeMs: number;
  bytes: number;
}

const MAX_IN_FLIGHT = 6;
const tmpSphere = new THREE.Sphere();
const tmpFrustum = new THREE.Frustum();
const tmpMat = new THREE.Matrix4();

export class TileManager {
  readonly group = new THREE.Group();
  readonly deltaGroup = new THREE.Group();
  private worker: Worker;
  private nodes = new Map<string, NodeState>();
  private galaxies: ManifestGalaxy[] = [];
  private queue: NodeState[] = [];
  private inFlight = new Set<string>();
  private lastSelect = 0;
  private reqId = 0;
  private pending = new Map<number, (v: unknown) => void>();
  private deltaEtag: string | null = null;
  private deltaUrl: string | null = null;
  private deltaTimer = 0;
  private hiddenIndices = new Set<number>();
  private replayHidden: Set<number> | null = null;
  private disposed = false;
  pointBudget = 1_000_000;
  openThresholdPx = 140;
  galaxyFade = new Map<number, number>();
  stats: TileStats = { loadedNodes: 0, loadedPoints: 0, inFlight: 0, queued: 0, lastDecodeMs: 0, bytes: 0 };
  onRootLoaded: ((galaxyId: number, object: THREE.Points) => void) | null = null;
  onDelta: ((groups: number) => void) | null = null;

  constructor(
    readonly shared: SharedPointUniforms,
    readonly base: string,
  ) {
    this.group.name = 'tiles';
    this.deltaGroup.name = 'delta';
    this.worker = new Worker(new URL('./tile.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onMessage(e.data);
  }

  setManifest(m: Manifest) {
    this.clear();
    this.galaxies = m.galaxies;
    for (const g of m.galaxies) {
      const keys = new Set(g.nodes.map((n) => n.key));
      for (const n of g.nodes) {
        const children: string[] = [];
        for (let o = 0; o < 8; o++) if (keys.has(n.key + o)) children.push(`${g.id}/${n.key}${o}`);
        this.nodes.set(`${g.id}/${n.key}`, {
          id: `${g.id}/${n.key}`,
          galaxy: g,
          key: n.key,
          count: n.count,
          radius: n.cube[3] * Math.SQRT2 * 1.2247,
          center: [n.cube[0], n.cube[1], n.cube[2]],
          children,
          status: 'idle',
          object: null,
          lastVisible: 0,
          priority: 0,
          failures: 0,
        });
      }
      this.galaxyFade.set(g.id, 1);
    }
    // Roots first: they're tiny and give every galaxy an immediate silhouette + impostor.
    for (const g of m.galaxies) this.enqueue(this.nodes.get(`${g.id}/r`)!, 1e9 + g.population);
    this.pump();
  }

  private clear() {
    for (const n of this.nodes.values()) this.unload(n);
    this.nodes.clear();
    this.queue = [];
  }

  private enqueue(n: NodeState | undefined, priority: number) {
    if (!n || n.status === 'loaded' || n.status === 'loading' || n.failures > 3) return;
    n.priority = Math.max(n.priority, priority);
    if (n.status !== 'queued') {
      n.status = 'queued';
      this.queue.push(n);
    }
  }

  private pump() {
    if (this.disposed) return;
    this.queue.sort((a, b) => b.priority - a.priority);
    while (this.inFlight.size < MAX_IN_FLIGHT && this.queue.length) {
      const n = this.queue.shift()!;
      if (n.status !== 'queued') continue;
      n.status = 'loading';
      this.inFlight.add(n.id);
      const g = n.galaxy;
      const msg: WorkerIn = {
        type: 'load',
        key: n.id,
        url: `${this.base}/${tilePath(this.version, g.id, n.key)}`,
        idsUrl: `${this.base}/${tilePath(this.version, g.id, n.key, 'ids.bin')}`,
        galaxyId: g.id,
        center: g.center,
      };
      this.worker.postMessage(msg);
    }
    this.stats.inFlight = this.inFlight.size;
    this.stats.queued = this.queue.length;
  }

  version = '';

  private onMessage(msg: { type: string } & Record<string, unknown>) {
    if (this.disposed) return;
    if (msg.type === 'loaded') {
      const n = this.nodes.get(msg.key as string);
      this.inFlight.delete(msg.key as string);
      if (!n) return this.pump();
      const arrays = msg as unknown as PointArrays & { aabb: number[]; decodeMs: number; bytes: number };
      const geo = createPointGeometry(arrays);
      const mat = createPointMaterial(this.shared, arrays.aabb);
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.matrixAutoUpdate = false;
      pts.renderOrder = 1;
      pts.userData = { galaxyId: n.galaxy.id, center: n.galaxy.center };
      n.object = pts;
      n.status = 'loaded';
      n.lastVisible = performance.now();
      this.group.add(pts);
      this.stats.loadedNodes++;
      this.stats.loadedPoints += n.count;
      this.stats.lastDecodeMs = arrays.decodeMs;
      this.stats.bytes += arrays.bytes;
      if (n.key === 'r') this.onRootLoaded?.(n.galaxy.id, pts);
      this.pump();
    } else if (msg.type === 'failed') {
      const n = this.nodes.get(msg.key as string);
      this.inFlight.delete(msg.key as string);
      if (n) {
        n.status = 'idle';
        if (!msg.aborted) n.failures++;
      }
      this.pump();
    } else if (msg.type === 'delta') this.onDeltaMessage(msg);
    else if (msg.type === 'pick' || msg.type === 'nearest' || msg.type === 'find' || msg.type === 'labels') {
      const cb = this.pending.get(msg.id as number);
      this.pending.delete(msg.id as number);
      cb?.(msg);
    }
  }

  private unload(n: NodeState) {
    if (n.object) {
      this.group.remove(n.object);
      n.object.geometry.dispose();
      (n.object.material as THREE.Material).dispose();
      this.stats.loadedNodes--;
      this.stats.loadedPoints -= n.count;
      n.object = null;
    }
    if (n.status === 'loading') this.worker.postMessage({ type: 'abort', key: n.id } satisfies WorkerIn);
    this.worker.postMessage({ type: 'evict', key: n.id } satisfies WorkerIn);
    n.status = 'idle';
  }

  /** Per frame: floating-origin offsets + fades. Every 100 ms: LOD selection. */
  update(cam: Float64Array, camera: THREE.PerspectiveCamera, viewportH: number, now: number) {
    for (const n of this.nodes.values()) {
      const o = n.object;
      if (!o) continue;
      const u = (o.material as THREE.ShaderMaterial).uniforms;
      const c = n.galaxy.center;
      (u.uOffset!.value as THREE.Vector3).set(c[0] - cam[0]!, c[1] - cam[1]!, c[2] - cam[2]!);
      u.uFade!.value = this.galaxyFade.get(n.galaxy.id) ?? 1;
    }
    for (const o of this.deltaGroup.children as THREE.Points[]) {
      const c = o.userData.center as [number, number, number];
      const u = (o.material as THREE.ShaderMaterial).uniforms;
      (u.uOffset!.value as THREE.Vector3).set(c[0] - cam[0]!, c[1] - cam[1]!, c[2] - cam[2]!);
      u.uFade!.value = this.galaxyFade.get(o.userData.galaxyId as number) ?? 1;
    }
    if (now - this.lastSelect > 100) {
      this.lastSelect = now;
      this.select(cam, camera, viewportH, now);
    }
    if (this.deltaUrl && now - this.deltaTimer > 5 * 60_000) this.refreshDelta();
  }

  private select(cam: Float64Array, camera: THREE.PerspectiveCamera, viewportH: number, now: number) {
    tmpMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    tmpFrustum.setFromProjectionMatrix(tmpMat);
    const pxPerRad = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const visit = (n: NodeState) => {
      const g = n.galaxy;
      const cx = g.center[0] + n.center[0] - cam[0]!;
      const cy = g.center[1] + n.center[1] - cam[1]!;
      const cz = g.center[2] + n.center[2] - cam[2]!;
      const dist = Math.hypot(cx, cy, cz);
      tmpSphere.center.set(cx, cy, cz);
      tmpSphere.radius = n.radius;
      const inside = dist < n.radius;
      if (!inside && !tmpFrustum.intersectsSphere(tmpSphere)) return;
      n.lastVisible = now;
      if (n.status !== 'loaded') {
        this.enqueue(n, (inside ? 1e6 : (n.radius / Math.max(dist, 1)) * pxPerRad) + 1000 / (n.key.length + 1));
        return;
      }
      const size = inside ? Number.POSITIVE_INFINITY : (n.radius / Math.max(dist, 1e-3)) * pxPerRad;
      if (size > this.openThresholdPx && (this.galaxyFade.get(g.id) ?? 1) > 0.05) for (const c of n.children) visit(this.nodes.get(c)!);
    };
    for (const g of this.galaxies) {
      const root = this.nodes.get(`${g.id}/r`);
      if (root) visit(root);
      else continue;
      if (root.status === 'loaded') root.lastVisible = now;
    }
    // Drop queued work that is no longer wanted (stale after a warp).
    this.queue = this.queue.filter((n) => {
      if (n.lastVisible >= now - 1 || n.key === 'r') return true;
      n.status = 'idle';
      n.priority = 0;
      return false;
    });
    this.evict(now);
    this.pump();
  }

  private evict(now: number) {
    if (this.stats.loadedPoints <= this.pointBudget) return;
    const candidates = [...this.nodes.values()]
      .filter((n) => n.status === 'loaded' && n.key !== 'r' && n.lastVisible < now - 1)
      .sort((a, b) => a.lastVisible - b.lastVisible || b.key.length - a.key.length);
    for (const n of candidates) {
      if (this.stats.loadedPoints <= this.pointBudget * 0.9) break;
      if (n.children.some((c) => this.nodes.get(c)?.status === 'loaded')) continue; // leaves first
      this.unload(n);
    }
  }

  /** Warp prefetch: request the node path down to the target's leaf, abort everything else queued. */
  prefetch(pos: [number, number, number]) {
    const g = this.galaxies.find((x) => Math.hypot(pos[0] - x.center[0], pos[1] - x.center[1], pos[2] - x.center[2]) < x.radius * 1.3);
    if (!g) return;
    const root = g.nodes[0];
    if (!root) return;
    const local = { x: pos[0] - g.center[0], y: pos[1] - g.center[1], z: pos[2] - g.center[2] };
    const deepest = Math.max(...g.nodes.map((n) => n.key.length)) - 1;
    const path = pathFor(local, root.cube, deepest);
    for (let l = 1; l <= path.length; l++) this.enqueue(this.nodes.get(`${g.id}/${path.slice(0, l)}`), 5e6 - l);
    this.queue = this.queue.filter((n) => n.priority >= 5e6 - 100 || n.key === 'r');
    for (const id of this.inFlight) {
      const n = this.nodes.get(id);
      if (n && n.key !== 'r' && !path.startsWith(n.key)) this.unload(n);
    }
    this.pump();
  }

  galaxyAt(pos: [number, number, number]): ManifestGalaxy | null {
    let best: ManifestGalaxy | null = null;
    let bd = Number.POSITIVE_INFINITY;
    for (const g of this.galaxies) {
      const d = Math.hypot(pos[0] - g.center[0], pos[1] - g.center[1], pos[2] - g.center[2]) / g.radius;
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return bd < 1.4 ? best : null;
  }

  // ─── Worker queries ────────────────────────────────────────────────────

  private ask<T>(msg: WorkerIn & { id: number }): Promise<T> {
    return new Promise((resolve) => {
      this.pending.set(msg.id, resolve as (v: unknown) => void);
      this.worker.postMessage(msg);
    });
  }

  async pick(
    cam: Float64Array,
    viewProj: THREE.Matrix4,
    width: number,
    height: number,
    x: number,
    y: number,
    dpr: number,
  ): Promise<PointHit | null> {
    const r = await this.ask<{ hit: PointHit | null }>({
      type: 'pick',
      id: ++this.reqId,
      cam: [cam[0]!, cam[1]!, cam[2]!],
      viewProj: viewProj.elements.slice(),
      width,
      height,
      x,
      y,
      scale: this.shared.uScale.value,
      dpr,
    });
    return r.hit;
  }

  async nearest(pos: [number, number, number], count: number, maxDist: number): Promise<(PointHit & { distance: number })[]> {
    const r = await this.ask<{ stars: (PointHit & { distance: number })[] }>({ type: 'nearest', id: ++this.reqId, pos, count, maxDist });
    return r.stars;
  }

  async find(kind: 'hot' | 'hyper' | 'bright'): Promise<PointHit | null> {
    const r = await this.ask<{ hit: PointHit | null }>({ type: 'find', id: ++this.reqId, kind, seed: Math.random() });
    return r.hit;
  }

  async labels(cam: Float64Array, viewProj: THREE.Matrix4, width: number, height: number, max: number) {
    const r = await this.ask<{ labels: { h: PointHit; prio: number; x: number; y: number; dist: number }[] }>({
      type: 'labels',
      id: ++this.reqId,
      cam: [cam[0]!, cam[1]!, cam[2]!],
      viewProj: viewProj.elements.slice(),
      width,
      height,
      max,
    });
    return r.labels;
  }

  /** Loaded tile nodes (for the replay layer). */
  loadedNodes(): { galaxyId: number; key: string; object: THREE.Points }[] {
    return [...this.nodes.values()].filter((n) => n.object).map((n) => ({ galaxyId: n.galaxy.id, key: n.key, object: n.object! }));
  }

  // ─── Delta + hidden ──────────────────────────────────────────────────

  setDelta(url: string, etag: string | null) {
    this.deltaUrl = url;
    if (etag && etag === this.deltaEtag) return;
    this.refreshDelta();
  }

  refreshDelta() {
    if (!this.deltaUrl) return;
    this.deltaTimer = performance.now();
    const centers: Record<number, [number, number, number]> = {};
    for (const g of this.galaxies) centers[g.id] = g.center;
    this.worker.postMessage({ type: 'delta', url: this.deltaUrl, etag: this.deltaEtag, centers } satisfies WorkerIn);
  }

  private onDeltaMessage(msg: Record<string, unknown>) {
    if (msg.unchanged || msg.error) return;
    this.deltaEtag = (msg.etag as string | null) ?? null;
    for (const o of [...this.deltaGroup.children] as THREE.Points[]) {
      this.deltaGroup.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    const groups = msg.groups as (PointArrays & { galaxyId: number; aabb: number[] })[];
    for (const g of groups) {
      const gal = this.galaxies.find((x) => x.id === g.galaxyId);
      if (!gal) continue;
      const pts = new THREE.Points(createPointGeometry(g), createPointMaterial(this.shared, g.aabb, { ignoreHidden: true }));
      pts.frustumCulled = false;
      pts.renderOrder = 1;
      pts.userData = { galaxyId: g.galaxyId, center: gal.center };
      this.deltaGroup.add(pts);
    }
    this.setHidden(Array.from(msg.hidden as Uint32Array));
    this.onDelta?.(groups.length);
  }

  /** Replay: stars not yet born are hidden through the same bitmask (null restores the normal set). */
  setReplayHidden(indices: Set<number> | null) {
    this.replayHidden = indices;
    this.writeHidden();
  }

  /** Marks star indices hidden (opt-outs, stale baked copies) in the GPU bitmask. */
  setHidden(indices: number[], add = false) {
    if (!add) this.hiddenIndices = new Set(indices);
    else for (const i of indices) this.hiddenIndices.add(i);
    this.writeHidden();
  }

  private writeHidden() {
    const all = this.replayHidden ? new Set([...this.hiddenIndices, ...this.replayHidden]) : this.hiddenIndices;
    let max = 0;
    for (const i of all) if (i > max) max = i;
    const rows = Math.max(1, Math.ceil((max + 1) / 8 / HIDDEN_WIDTH));
    let tex = this.shared.uHidden.value;
    if (tex.image.height < rows) {
      tex.dispose();
      tex = createHiddenTexture(rows);
      this.shared.uHidden.value = tex;
    }
    const data = tex.image.data as Uint8Array;
    data.fill(0);
    for (const i of all) data[i >> 3] = data[i >> 3]! | (1 << (i & 7));
    tex.needsUpdate = true;
    this.shared.uHiddenRows.value = all.size ? tex.image.height : 0;
  }

  dispose() {
    this.disposed = true;
    this.clear();
    this.worker.terminate();
  }
}
