import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  D_MIN,
  galaxyParams,
  galaxyTiers,
  impactQuantiles,
  placeGalaxies,
  placeStar,
  placeStarSeparated,
  provisionalPercentile,
  SeparationHash,
} from '../src';

const galaxy = (lang: string, n: number) => placeGalaxies([galaxyParams(lang, 'major', n)])[0]!;

describe('§3.6 galaxy tiers', () => {
  it('top 12 major, next 12 minor, rest → polyglot, void separate', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 30; i++) counts.set(`L${String(i).padStart(2, '0')}`, 1000 - i);
    counts.set('Polyglot', 5);
    counts.set('Void', 7);
    const t = galaxyTiers(counts);
    expect(t.filter((g) => g.tier === 'major')).toHaveLength(12);
    expect(t.filter((g) => g.tier === 'minor')).toHaveLength(12);
    const poly = t.find((g) => g.tier === 'polyglot')!;
    expect(poly.population).toBe(5 + (1000 - 24) + (1000 - 25) + (1000 - 26) + (1000 - 27) + (1000 - 28) + (1000 - 29));
    expect(t.find((g) => g.tier === 'void')!.population).toBe(7);
  });
  it('arm counts', () => {
    expect(galaxyParams('A', 'major', 19_999).arms).toBe(2);
    expect(galaxyParams('A', 'major', 20_000).arms).toBe(3);
    expect(galaxyParams('A', 'major', 100_000).arms).toBe(4);
  });
  it('galaxies do not overlap after relaxation', () => {
    const defs = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((l, i) => galaxyParams(l, 'major', 50_000 / (i + 1)));
    const placed = placeGalaxies(defs);
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        const d = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1], a.center[2] - b.center[2]);
        expect(d).toBeGreaterThan(a.radius + b.radius);
      }
    expect(placed[0]!.population).toBeGreaterThanOrEqual(placed[1]!.population);
  });
});

describe('§3.6 star placement', () => {
  it('is deterministic', () => {
    const g = galaxy('TypeScript', 10_000);
    expect(placeStar(0.3, 12345, g)).toEqual(placeStar(0.3, 12345, g));
    expect(placeStar(0.3, 12345, g)).not.toEqual(placeStar(0.3, 12346, g));
  });
  it('better rank → closer to the core', () => {
    const g = galaxy('Python', 50_000);
    const dist = (p: number) => {
      let s = 0;
      for (let id = 1; id <= 200; id++) {
        const w = placeStar(p, id, g);
        s += Math.hypot(w[0] - g.center[0], w[1] - g.center[1], w[2] - g.center[2]);
      }
      return s / 200;
    };
    expect(dist(0.01)).toBeLessThan(dist(0.2));
    expect(dist(0.2)).toBeLessThan(dist(0.8));
    expect(dist(0.99)).toBeLessThan(g.radius * 1.2);
  });
  it('minimum separation pass reduces collisions', () => {
    const g = galaxy('Go', 2_000);
    const grid = new SeparationHash();
    const sep = Array.from({ length: 2000 }, (_, i) => placeStarSeparated(i / 2000, i + 1, g, grid));
    const raw = Array.from({ length: 2000 }, (_, i) => placeStar(i / 2000, i + 1, g));
    const closePairs = (pts: number[][]) => {
      let close = 0;
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i]!;
          const b = pts[j]!;
          if (Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) < D_MIN) close++;
        }
      return close;
    };
    expect(closePairs(sep)).toBeLessThan(closePairs(raw) * 0.5);
  });
  it('determinism snapshot: 100k synthetic users → SHA-256 of float64 positions', () => {
    // §13.1: V8's Math.* differs across Node majors, so this golden is pinned to the runtime that bakes the universe
    // (worker image node:22). Use .nvmrc; a different major would report a misleading hash mismatch.
    const pinned = readFileSync(new URL('../../../.nvmrc', import.meta.url), 'utf8').trim();
    expect(process.versions.node.split('.')[0], `run tests with Node ${pinned} (.nvmrc) — the production bake runtime`).toBe(pinned);
    const g = galaxy('Rust', 100_000);
    const out = new Float64Array(100_000 * 3);
    for (let i = 0; i < 100_000; i++) out.set(placeStar(i / 100_000, 1_000_000 + i * 7919, g), i * 3);
    const hash = createHash('sha256').update(Buffer.from(out.buffer)).digest('hex');
    expect(hash).toMatchSnapshot();
  });
  it('provisional percentile from quantile table', () => {
    const desc = Array.from({ length: 5000 }, (_, i) => 5000 - i);
    const t = impactQuantiles(desc);
    expect(t).toHaveLength(1000);
    expect(provisionalPercentile(t, 6000)).toBe(0);
    expect(provisionalPercentile(t, 2500)).toBeCloseTo(0.5, 2);
    expect(provisionalPercentile(t, -1)).toBe(0.999);
  });
});
