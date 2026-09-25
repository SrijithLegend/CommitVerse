/// <reference lib="webworker" />
/**
 * §6.5 tile worker: fetch + validate + hand the ArrayBuffer back transferred (zero-copy); keeps a compact copy of
 * positions/props/ids for CPU picking (§6.7), nearest-star queries (T2 upgrades) and cinematic target finding.
 */
import { decodeDelta, HEADER_BYTES, readTileHeader, TileFormatError } from '@commitverse/universe-core';

interface NodeData {
  key: string;
  galaxyId: number;
  center: [number, number, number];
  aabb: [number, number, number, number, number, number];
  count: number;
  pos: Int16Array; // xyz per point
  props: Uint8Array; // rq tq lq flags
  index: Uint32Array;
  cosmetic: Uint16Array;
  ids: Uint32Array | null;
  sphere: [number, number, number, number]; // world-ish centre (relative to galaxy centre) + radius
}

const nodes = new Map<string, NodeData>();
const controllers = new Map<string, AbortController>();

export type WorkerIn =
  | { type: 'load'; key: string; url: string; idsUrl: string; galaxyId: number; center: [number, number, number] }
  | { type: 'abort'; key: string }
  | { type: 'evict'; key: string }
  | { type: 'delta'; url: string; etag: string | null; centers: Record<number, [number, number, number]> }
  | { type: 'pick'; id: number; cam: [number, number, number]; viewProj: number[]; width: number; height: number; x: number; y: number; scale: number; dpr: number }
  | { type: 'nearest'; id: number; pos: [number, number, number]; count: number; maxDist: number }
  | { type: 'find'; id: number; kind: 'hot' | 'hyper' | 'bright'; seed: number }
  | { type: 'labels'; id: number; cam: [number, number, number]; viewProj: number[]; width: number; height: number; max: number };

export interface PointHit {
  githubId: number;
  starIndex: number;
  position: [number, number, number];
  rq: number;
  tq: number;
  lq: number;
  flags: number;
  galaxyId: number;
}

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

function ingest(key: string, galaxyId: number, center: [number, number, number], buf: ArrayBuffer, ids: Uint32Array | null): NodeData {
  const h = readTileHeader(buf);
  const n = h.count;
  const src16 = new Int16Array(buf, HEADER_BYTES, n * 8);
  const src8 = new Uint8Array(buf, HEADER_BYTES, n * 16);
  const src32 = new Uint32Array(buf, HEADER_BYTES, n * 4);
  const srcU16 = new Uint16Array(buf, HEADER_BYTES, n * 8);
  const cosmetic = new Uint16Array(n);
  const pos = new Int16Array(n * 3);
  const props = new Uint8Array(n * 4);
  const index = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = src16[i * 8]!;
    pos[i * 3 + 1] = src16[i * 8 + 1]!;
    pos[i * 3 + 2] = src16[i * 8 + 2]!;
    props[i * 4] = src8[i * 16 + 6]!;
    props[i * 4 + 1] = src8[i * 16 + 7]!;
    props[i * 4 + 2] = src8[i * 16 + 8]!;
    props[i * 4 + 3] = src8[i * 16 + 9]!;
    index[i] = src32[i * 4 + 3]!;
    cosmetic[i] = srcU16[i * 8 + 5]!;
  }
  const b = h.aabb;
  const cx = (b[0] + b[3]) / 2;
  const cy = (b[1] + b[4]) / 2;
  const cz = (b[2] + b[5]) / 2;
  const r = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2;
  const node: NodeData = { key, galaxyId, center, aabb: b, count: n, pos, props, index, cosmetic, ids, sphere: [cx, cy, cz, r] };
  nodes.set(key, node);
  return node;
}

const dq = (q: number, min: number, max: number) => ((q + 32768) / 65535) * (max - min) + min;

function worldOf(nd: NodeData, i: number): [number, number, number] {
  const b = nd.aabb;
  return [
    nd.center[0] + dq(nd.pos[i * 3]!, b[0], b[3]),
    nd.center[1] + dq(nd.pos[i * 3 + 1]!, b[1], b[4]),
    nd.center[2] + dq(nd.pos[i * 3 + 2]!, b[2], b[5]),
  ];
}

/** Compact per-attribute copies for the GPU (transferred) — the worker keeps its own for picking. */
function gpuArrays(nd: NodeData) {
  return { pos: nd.pos.slice(), props: nd.props.slice(), cosmetic: nd.cosmetic.slice(), index: nd.index.slice() };
}

function hit(nd: NodeData, i: number): PointHit {
  return {
    githubId: nd.ids?.[i] ?? 0,
    starIndex: nd.index[i]!,
    position: worldOf(nd, i),
    rq: nd.props[i * 4]!,
    tq: nd.props[i * 4 + 1]!,
    lq: nd.props[i * 4 + 2]!,
    flags: nd.props[i * 4 + 3]!,
    galaxyId: nd.galaxyId,
  };
}

async function load(msg: Extract<WorkerIn, { type: 'load' }>) {
  const ctrl = new AbortController();
  controllers.set(msg.key, ctrl);
  const t0 = performance.now();
  try {
    const [res, idsRes] = await Promise.all([fetch(msg.url, { signal: ctrl.signal }), fetch(msg.idsUrl, { signal: ctrl.signal })]);
    if (!res.ok) throw new Error(`tile ${res.status}`);
    const buf = await res.arrayBuffer();
    const ids = idsRes.ok ? new Uint32Array(await idsRes.arrayBuffer()) : null;
    const node = ingest(msg.key, msg.galaxyId, msg.center, buf, ids);
    const decodeMs = performance.now() - t0;
    const arrays = gpuArrays(node);
    post(
      { type: 'loaded', key: msg.key, ...arrays, count: node.count, aabb: node.aabb, decodeMs, bytes: buf.byteLength },
      [arrays.pos.buffer, arrays.props.buffer, arrays.cosmetic.buffer, arrays.index.buffer],
    );
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    post({ type: 'failed', key: msg.key, aborted, error: err instanceof TileFormatError ? `format: ${err.message}` : String(err) });
  } finally {
    controllers.delete(msg.key);
  }
}

async function loadDelta(msg: Extract<WorkerIn, { type: 'delta' }>) {
  try {
    const res = await fetch(msg.url, { headers: msg.etag ? { 'if-none-match': msg.etag } : {}, cache: 'no-cache' });
    if (res.status === 304) return post({ type: 'delta', unchanged: true });
    if (res.status === 404) return post({ type: 'delta', unchanged: false, hidden: new Uint32Array(0), groups: [], etag: null });
    if (!res.ok) throw new Error(`delta ${res.status}`);
    const buf = await res.arrayBuffer();
    const d = decodeDelta(buf);
    for (const k of [...nodes.keys()]) if (k.startsWith('delta:')) nodes.delete(k);
    const groups = d.groups.map((g) => {
      const center = msg.centers[g.galaxyId] ?? [0, 0, 0];
      const nd = ingest(`delta:${g.galaxyId}`, g.galaxyId, center, g.tile, g.ids);
      return { galaxyId: g.galaxyId, count: nd.count, aabb: nd.aabb, ...gpuArrays(nd) };
    });
    post(
      { type: 'delta', unchanged: false, hidden: d.hidden, groups, etag: res.headers.get('etag') },
      [d.hidden.buffer, ...groups.flatMap((g) => [g.pos.buffer, g.props.buffer, g.cosmetic.buffer, g.index.buffer])],
    );
  } catch (err) {
    post({ type: 'delta', error: String(err) });
  }
}

function pick(msg: Extract<WorkerIn, { type: 'pick' }>) {
  const m = msg.viewProj;
  let best: { nd: NodeData; i: number; d2: number } | null = null;
  const cx = msg.cam[0];
  const cy = msg.cam[1];
  const cz = msg.cam[2];
  for (const nd of nodes.values()) {
    // node culling: project the bounding sphere; skip if it can't contain the cursor
    const sx = nd.center[0] + nd.sphere[0] - cx;
    const sy = nd.center[1] + nd.sphere[1] - cy;
    const sz = nd.center[2] + nd.sphere[2] - cz;
    const sw = m[3]! * sx + m[7]! * sy + m[11]! * sz + m[15]!;
    const distC = Math.hypot(sx, sy, sz);
    if (sw <= 0 && distC > nd.sphere[3]) continue;
    if (sw > 0 && distC > nd.sphere[3]) {
      const ndcX = (m[0]! * sx + m[4]! * sy + m[8]! * sz + m[12]!) / sw;
      const ndcY = (m[1]! * sx + m[5]! * sy + m[9]! * sz + m[13]!) / sw;
      const px = (ndcX * 0.5 + 0.5) * msg.width;
      const py = (1 - (ndcY * 0.5 + 0.5)) * msg.height;
      const rpx = (nd.sphere[3] / Math.max(1e-6, sw)) * msg.height * 0.9 + 60;
      if (Math.hypot(px - msg.x, py - msg.y) > rpx) continue;
    }
    const b = nd.aabb;
    const kx = (b[3] - b[0]) / 65535;
    const ky = (b[4] - b[1]) / 65535;
    const kz = (b[5] - b[2]) / 65535;
    const ox = nd.center[0] + b[0] - cx;
    const oy = nd.center[1] + b[1] - cy;
    const oz = nd.center[2] + b[2] - cz;
    for (let i = 0; i < nd.count; i++) {
      const x = ox + (nd.pos[i * 3]! + 32768) * kx;
      const y = oy + (nd.pos[i * 3 + 1]! + 32768) * ky;
      const z = oz + (nd.pos[i * 3 + 2]! + 32768) * kz;
      const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
      if (w <= 0.01) continue;
      const px = ((m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w * 0.5 + 0.5) * msg.width;
      const py = (1 - ((m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w * 0.5 + 0.5)) * msg.height;
      const ddx = px - msg.x;
      const ddy = py - msg.y;
      const d2 = ddx * ddx + ddy * ddy;
      const L = (nd.props[i * 4 + 2]! / 255) * 1.25;
      const size = Math.min(48, Math.max(1.5, (msg.scale * (0.35 + 0.65 * Math.min(1, L))) / Math.hypot(x, y, z)));
      const tol = Math.max(6, size / 2);
      if (d2 <= tol * tol && (!best || d2 < best.d2)) best = { nd, i, d2 };
    }
  }
  post({ type: 'pick', id: msg.id, hit: best ? hit(best.nd, best.i) : null });
}

function nearest(msg: Extract<WorkerIn, { type: 'nearest' }>) {
  const found: { nd: NodeData; i: number; d: number }[] = [];
  const [px, py, pz] = msg.pos;
  for (const nd of nodes.values()) {
    const sx = nd.center[0] + nd.sphere[0] - px;
    const sy = nd.center[1] + nd.sphere[1] - py;
    const sz = nd.center[2] + nd.sphere[2] - pz;
    if (Math.hypot(sx, sy, sz) - nd.sphere[3] > msg.maxDist) continue;
    for (let i = 0; i < nd.count; i++) {
      const w = worldOf(nd, i);
      const d = Math.hypot(w[0] - px, w[1] - py, w[2] - pz);
      if (d <= msg.maxDist) found.push({ nd, i, d });
    }
  }
  found.sort((a, b) => a.d - b.d);
  const seen = new Set<number>();
  const out: (PointHit & { distance: number })[] = [];
  for (const f of found) {
    const h = hit(f.nd, f.i);
    if (seen.has(h.starIndex)) continue;
    seen.add(h.starIndex);
    out.push({ ...h, distance: f.d });
    if (out.length >= msg.count) break;
  }
  post({ type: 'nearest', id: msg.id, stars: out });
}

function find(msg: Extract<WorkerIn, { type: 'find' }>) {
  const cands: { nd: NodeData; i: number }[] = [];
  for (const nd of nodes.values()) {
    for (let i = 0; i < nd.count; i++) {
      const tq = nd.props[i * 4 + 1]!;
      const flags = nd.props[i * 4 + 3]!;
      const lq = nd.props[i * 4 + 2]!;
      if (msg.kind === 'hot' && tq >= 237) cands.push({ nd, i }); // ≥ 30,000 K (class O)
      if (msg.kind === 'hyper' && flags & 4) cands.push({ nd, i });
      if (msg.kind === 'bright' && lq >= 180) cands.push({ nd, i });
    }
  }
  if (!cands.length) return post({ type: 'find', id: msg.id, hit: null });
  const c = cands[Math.floor(msg.seed * cands.length) % cands.length]!;
  post({ type: 'find', id: msg.id, hit: hit(c.nd, c.i) });
}

/** §5.4 label candidates in view, by priority: hypergiants > claimed > online > bright. */
function labels(msg: Extract<WorkerIn, { type: 'labels' }>) {
  const m = msg.viewProj;
  const out: { h: PointHit; prio: number; x: number; y: number; dist: number }[] = [];
  for (const nd of nodes.values()) {
    for (let i = 0; i < nd.count; i++) {
      const flags = nd.props[i * 4 + 3]!;
      const lq = nd.props[i * 4 + 2]!;
      const prio = flags & 4 ? 4 : flags & 1 ? 3 : flags & 8 ? 2 : lq >= 212 ? 1 : 0;
      if (!prio) continue;
      const w0 = worldOf(nd, i);
      const x = w0[0] - msg.cam[0];
      const y = w0[1] - msg.cam[1];
      const z = w0[2] - msg.cam[2];
      const dist = Math.hypot(x, y, z);
      const maxDist = prio === 4 ? 1e7 : prio === 3 ? 6000 : prio === 2 ? 4000 : 2500;
      if (dist > maxDist || dist < 20) continue;
      const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
      if (w <= 0) continue;
      const px = ((m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w * 0.5 + 0.5) * msg.width;
      const py = (1 - ((m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w * 0.5 + 0.5)) * msg.height;
      if (px < 0 || py < 0 || px > msg.width || py > msg.height) continue;
      out.push({ h: hit(nd, i), prio, x: px, y: py, dist });
    }
  }
  out.sort((a, b) => b.prio - a.prio || a.dist - b.dist);
  post({ type: 'labels', id: msg.id, labels: out.slice(0, msg.max) });
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'load':
      void load(msg);
      break;
    case 'abort':
      controllers.get(msg.key)?.abort();
      break;
    case 'evict':
      nodes.delete(msg.key);
      break;
    case 'delta':
      void loadDelta(msg);
      break;
    case 'pick':
      pick(msg);
      break;
    case 'nearest':
      nearest(msg);
      break;
    case 'find':
      find(msg);
      break;
    case 'labels':
      labels(msg);
      break;
  }
};
