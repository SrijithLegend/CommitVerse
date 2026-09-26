import { describe, expect, it } from 'vitest';
import { buildOctree, decodeTile, encodeTile, mulberry32, pathFor, readTileHeader, TileFormatError, tileViews } from '../src';

const rng = mulberry32(42);
const records = Array.from({ length: 4096 }, (_, i) => ({
  x: (rng() - 0.5) * 20000,
  y: (rng() - 0.5) * 800,
  z: (rng() - 0.5) * 20000,
  rq: i % 256,
  tq: (i * 7) % 256,
  lq: (i * 13) % 256,
  flags: i % 256,
  cosmetic: i % 65536,
  starIndex: i * 3 + 1,
}));

describe('§6.4 tile codec', () => {
  it('round-trips with quantization error ≤ AABB/65535', () => {
    const buf = encodeTile(records);
    expect(buf.byteLength).toBe(32 + 16 * 4096);
    const { header, records: out } = decodeTile(buf);
    const b = header.aabb;
    const tol = [(b[3] - b[0]) / 65535, (b[4] - b[1]) / 65535, (b[5] - b[2]) / 65535];
    out.forEach((r, i) => {
      const s = records[i]!;
      expect(Math.abs(r.x - s.x)).toBeLessThanOrEqual(tol[0]! + 1e-6);
      expect(Math.abs(r.y - s.y)).toBeLessThanOrEqual(tol[1]! + 1e-6);
      expect(Math.abs(r.z - s.z)).toBeLessThanOrEqual(tol[2]! + 1e-6);
      expect([r.rq, r.tq, r.lq, r.flags, r.cosmetic, r.starIndex]).toEqual([s.rq, s.tq, s.lq, s.flags, s.cosmetic, s.starIndex]);
    });
    const v = tileViews(buf);
    expect(v.uint32[3]).toBe(1);
    expect(v.uint8[9]).toBe(0);
  });
  it('decodes 4,096 records fast', () => {
    const buf = encodeTile(records);
    const t = performance.now();
    for (let i = 0; i < 50; i++) tileViews(buf);
    expect((performance.now() - t) / 50).toBeLessThan(2);
  });
  it('rejects fuzzed headers', () => {
    const good = encodeTile(records.slice(0, 10));
    const r = mulberry32(7);
    let rejected = 0;
    for (let i = 0; i < 500; i++) {
      const bad = good.slice(0);
      const u8 = new Uint8Array(bad);
      const pos = Math.floor(r() * 32);
      u8[pos] = (u8[pos]! + 1 + Math.floor(r() * 254)) & 255;
      try {
        readTileHeader(bad);
      } catch (e) {
        expect(e).toBeInstanceOf(TileFormatError);
        rejected++;
      }
    }
    expect(rejected).toBeGreaterThan(100); // AABB byte flips can stay valid; magic/count/length flips must not
    expect(() => readTileHeader(new ArrayBuffer(8))).toThrow(TileFormatError);
    expect(() => readTileHeader(good.slice(0, good.byteLength - 1))).toThrow(TileFormatError);
  });
});

describe('§6.4 octree', () => {
  it('nodes hold ≤ 4,096 points and every point appears exactly once', () => {
    const r = mulberry32(1);
    const pts = Array.from({ length: 30_000 }, (_, i) => ({ x: r() * 1e4, y: r() * 100, z: r() * 1e4, lq: Math.floor(r() * 256), idx: i }));
    const tree = buildOctree(pts);
    const seen = new Set<number>();
    for (const n of tree.values()) {
      expect(n.points.length).toBeLessThanOrEqual(4096);
      for (const p of n.points) {
        expect(seen.has(p.idx)).toBe(false);
        seen.add(p.idx);
      }
    }
    expect(seen.size).toBe(30_000);
    const root = tree.get('r')!;
    // root keeps the brightest
    const brightest = [...pts].sort((a, b) => b.lq - a.lq || a.idx - b.idx).slice(0, 1024);
    const rootIds = new Set(root.points.map((p) => p.idx));
    for (const p of brightest) expect(rootIds.has(p.idx)).toBe(true);
  });
  it('pathFor matches tree octants', () => {
    expect(pathFor({ x: 1, y: 1, z: 1 }, [0, 0, 0, 10], 2)).toBe('r70');
    expect(pathFor({ x: 6, y: 6, z: 6 }, [0, 0, 0, 10], 2)).toBe('r77');
    expect(pathFor({ x: -1, y: -1, z: -1 }, [0, 0, 0, 10], 1)).toBe('r0');
  });
});

import { minimumSpanningTree } from '../src';

describe('§3.5 constellation MST', () => {
  it('connects n points with n−1 shortest edges', () => {
    const pts: [number, number, number][] = [
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
      [100, 100, 0],
      [11, 0, 0],
    ];
    const e = minimumSpanningTree(pts);
    expect(e).toHaveLength(4);
    const len = e.reduce((s, [a, b]) => s + Math.hypot(pts[a]![0] - pts[b]![0], pts[a]![1] - pts[b]![1]), 0);
    expect(len).toBeCloseTo(10 + 10 + 1 + Math.hypot(89, 100), 6);
  });
});
