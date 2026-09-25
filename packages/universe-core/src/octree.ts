/**
 * §6.4 — Potree-style per-galaxy octree. Each node holds ≤ 4,096 points; inner nodes hold a
 * representative subset (brightest by L first, then spatially stratified); children refine.
 * Node key = path string: "r", "r0", "r03", …
 */

export const NODE_CAPACITY = 4096;
const BRIGHT_SHARE = 1024;
const STRATA = 16;
const MAX_DEPTH = 14;

export interface OctreePoint {
  x: number;
  y: number;
  z: number;
  lq: number;
  /** Tie-breaker for determinism (dense star index). */
  idx: number;
}

export interface OctreeNode<P extends OctreePoint> {
  key: string;
  /** Cube: [cx, cy, cz, halfSize] (galaxy-local). */
  cube: [number, number, number, number];
  points: P[];
  children: string[];
}

export function rootCube(points: OctreePoint[]): [number, number, number, number] {
  if (!points.length) return [0, 0, 0, 1];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    maxZ = Math.max(maxZ, p.z);
  }
  const half = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1) / 2 + 1;
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2, half];
}

const brighter = (a: OctreePoint, b: OctreePoint) => b.lq - a.lq || a.idx - b.idx;

export function buildOctree<P extends OctreePoint>(points: P[], capacity = NODE_CAPACITY): Map<string, OctreeNode<P>> {
  const nodes = new Map<string, OctreeNode<P>>();
  const build = (key: string, cube: [number, number, number, number], pts: P[], depth: number) => {
    const node: OctreeNode<P> = { key, cube, points: [], children: [] };
    nodes.set(key, node);
    if (pts.length <= capacity || depth >= MAX_DEPTH) {
      node.points = pts;
      return;
    }
    const sorted = [...pts].sort(brighter);
    const keep = new Set<P>(sorted.slice(0, BRIGHT_SHARE));
    // Stratify: one point per voxel (brightest first) until the node is full.
    const [cx, cy, cz, h] = cube;
    const seen = new Set<number>();
    const voxel = (p: P) => {
      const f = (v: number, c: number) => Math.min(STRATA - 1, Math.max(0, Math.floor(((v - (c - h)) / (2 * h)) * STRATA)));
      return (f(p.x, cx) * STRATA + f(p.y, cy)) * STRATA + f(p.z, cz);
    };
    for (const p of keep) seen.add(voxel(p));
    for (const p of sorted) {
      if (keep.size >= capacity) break;
      if (keep.has(p)) continue;
      const v = voxel(p);
      if (seen.has(v)) continue;
      seen.add(v);
      keep.add(p);
    }
    for (const p of sorted) {
      if (keep.size >= capacity) break;
      keep.add(p);
    }
    node.points = sorted.filter((p) => keep.has(p));
    const buckets: P[][] = Array.from({ length: 8 }, () => []);
    for (const p of pts) {
      if (keep.has(p)) continue;
      const o = (p.x >= cx ? 1 : 0) | (p.y >= cy ? 2 : 0) | (p.z >= cz ? 4 : 0);
      buckets[o]!.push(p);
    }
    const q = h / 2;
    buckets.forEach((b, o) => {
      if (!b.length) return;
      const childKey = key + o;
      node.children.push(childKey);
      build(childKey, [cx + (o & 1 ? q : -q), cy + (o & 2 ? q : -q), cz + (o & 4 ? q : -q), q], b, depth + 1);
    });
  };
  build('r', rootCube(points), points, 0);
  return nodes;
}

/** Presence sector = octree node at level 6 (key length 7), or the deepest ancestor available. */
export const sectorKey = (nodeKey: string): string => nodeKey.slice(0, 7);

/** Octant path for a point down to `level` inside a root cube (used for sector lookup without the tree). */
export function pathFor(p: { x: number; y: number; z: number }, root: [number, number, number, number], level: number): string {
  let [cx, cy, cz, h] = root;
  let key = 'r';
  for (let i = 0; i < level; i++) {
    const o = (p.x >= cx ? 1 : 0) | (p.y >= cy ? 2 : 0) | (p.z >= cz ? 4 : 0);
    key += o;
    h /= 2;
    cx += o & 1 ? h : -h;
    cy += o & 2 ? h : -h;
    cz += o & 4 ? h : -h;
  }
  return key;
}
