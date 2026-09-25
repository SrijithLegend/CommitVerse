/** §3.6 — galaxy tiers, parameters, supercluster placement, star placement. Authoritative in the worker only. */
import { POLYGLOT, VOID } from './languages';
import { gaussian, hash32, hashUnit, mulberry32, randomOnSphere } from './random';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x y z w

export type GalaxyTier = 'major' | 'minor' | 'polyglot' | 'void';
export type GalaxyForm = 'spiral' | 'elliptical' | 'irregular' | 'halo';

export interface GalaxyDef {
  id: number;
  language: string;
  tier: GalaxyTier;
  form: GalaxyForm;
  population: number;
  arms: number;
  radius: number;
  coreRadius: number;
  thickness: number;
  pitch: number; // radians
  tilt: Quat;
  center: Vec3; // float64 world
  seed: number;
}

export const MAJOR_COUNT = 12;
export const MINOR_COUNT = 12;
const DEG = Math.PI / 180;

export const galaxyRadius = (n: number): number => 90 * Math.sqrt(Math.max(1, n));

export function armsFor(tier: GalaxyTier, n: number, language: string): { form: GalaxyForm; arms: number } {
  if (tier === 'major') return { form: 'spiral', arms: n < 20_000 ? 2 : n < 100_000 ? 3 : 4 };
  if (tier === 'minor') return hash32(`${language}:form`) % 2 === 0 ? { form: 'spiral', arms: 2 } : { form: 'elliptical', arms: 0 };
  if (tier === 'polyglot') return { form: 'irregular', arms: 0 };
  return { form: 'halo', arms: 0 };
}

/** Quaternion from axis-angle. */
export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(angle / 2) / len;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

export const tiltFor = (language: string): Quat => {
  const ang = hashUnit(language, 0xa1) * 35 * DEG;
  const dir = hashUnit(language, 0xb2) * Math.PI * 2;
  return quatFromAxisAngle([Math.cos(dir), 0, Math.sin(dir)], ang);
};

/**
 * Groups language populations into galaxies and computes parameters (not positions).
 * `counts` maps primary_language (incl. Polyglot/Void) → user count.
 * Languages ranked ≥ 25 are merged into Polyglot (their users keep language colour-coding client-side).
 */
export function galaxyTiers(counts: Map<string, number>): { language: string; tier: GalaxyTier; population: number; members: string[] }[] {
  const real = [...counts.entries()].filter(([l]) => l !== POLYGLOT && l !== VOID).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const out: { language: string; tier: GalaxyTier; population: number; members: string[] }[] = [];
  real.slice(0, MAJOR_COUNT + MINOR_COUNT).forEach(([l, n], i) => {
    out.push({ language: l, tier: i < MAJOR_COUNT ? 'major' : 'minor', population: n, members: [l] });
  });
  const rest = real.slice(MAJOR_COUNT + MINOR_COUNT);
  const polyN = (counts.get(POLYGLOT) ?? 0) + rest.reduce((s, [, n]) => s + n, 0);
  if (polyN > 0) out.push({ language: POLYGLOT, tier: 'polyglot', population: polyN, members: [POLYGLOT, ...rest.map(([l]) => l)] });
  const voidN = counts.get(VOID) ?? 0;
  if (voidN > 0) out.push({ language: VOID, tier: 'void', population: voidN, members: [VOID] });
  return out;
}

export function galaxyParams(language: string, tier: GalaxyTier, population: number): Omit<GalaxyDef, 'id' | 'center'> {
  const radius = tier === 'void' ? 1.6 * galaxyRadius(population) : galaxyRadius(population);
  const { form, arms } = armsFor(tier, population, language);
  return {
    language,
    tier,
    form,
    population,
    arms,
    radius,
    coreRadius: 0.06 * radius,
    thickness: 0.04 * radius,
    pitch: (12 + hashUnit(language, 0xc3) * 6) * DEG,
    tilt: tiltFor(language),
    seed: hash32(language),
  };
}

/** Golden-angle spiral, biggest at the centre, then ≤ 200 deterministic relaxation iterations. */
export function placeGalaxies(defs: Omit<GalaxyDef, 'center' | 'id'>[]): GalaxyDef[] {
  const sorted = [...defs].sort((a, b) => b.population - a.population || (a.language < b.language ? -1 : 1));
  const S = 1.6 * (sorted[0]?.radius ?? 1000);
  const GOLDEN = 137.508 * DEG;
  const pos: Vec3[] = sorted.map((g, i) => {
    const rho = S * Math.sqrt(i + 0.5);
    const phi = i * GOLDEN;
    const y = (hashUnit(g.language, 0xd4) - 0.5) * 0.25 * rho;
    return [rho * Math.cos(phi), y, rho * Math.sin(phi)];
  });
  for (let iter = 0; iter < 200; iter++) {
    let moved = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i]!;
        const b = pos[j]!;
        const ra = sorted[i]!.radius;
        const rb = sorted[j]!.radius;
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let dz = b[2] - a[2];
        let d = Math.hypot(dx, dy, dz);
        const min = 1.4 * (ra + rb);
        if (d >= min) continue;
        if (d < 1e-9) {
          dx = 1;
          dy = 0;
          dz = 0;
          d = 1;
        }
        const push = (min - d) / d;
        const wa = rb / (ra + rb); // the smaller galaxy moves more
        const wb = ra / (ra + rb);
        a[0] -= dx * push * wa;
        a[1] -= dy * push * wa;
        a[2] -= dz * push * wa;
        b[0] += dx * push * wb;
        b[1] += dy * push * wb;
        b[2] += dz * push * wb;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return sorted.map((g, i) => ({ ...g, id: i + 1, center: pos[i]! }));
}

export const galaxyToWorld = (g: Pick<GalaxyDef, 'tilt' | 'center'>, local: Vec3): Vec3 => {
  const r = rotate(g.tilt, local);
  return [r[0] + g.center[0], r[1] + g.center[1], r[2] + g.center[2]];
};

// ─── Star placement (§3.6 reference; code MUST match) ─────────────────────

/** Galaxy-local sampler. Consumes rng in the exact order of the spec's placeStar. */
export function sampleLocal(
  p: number,
  rng: () => number,
  g: Pick<GalaxyDef, 'form' | 'arms' | 'radius' | 'coreRadius' | 'thickness' | 'pitch' | 'seed'>,
): { pos: Vec3; rejitter: () => Vec3 } {
  // Bulge: top 2% form a spherical-ish core around the black hole
  if (g.form === 'spiral' && p < 0.02) {
    const r = g.coreRadius * (0.25 + 0.75 * Math.cbrt(rng()));
    const make = (): Vec3 => {
      const [x, y, z] = randomOnSphere(rng);
      return [x * r, y * r * 0.6, z * r];
    };
    return { pos: make(), rejitter: make };
  }

  if (g.form === 'spiral') {
    const r = g.coreRadius + (g.radius - g.coreRadius) * p ** 0.7;
    const arm = Math.floor(rng() * g.arms);
    const armOffset = (arm / g.arms) * Math.PI * 2;
    const spiral = Math.log(r / g.coreRadius) / Math.tan(g.pitch); // logarithmic spiral
    const looseness = 0.35 + 0.65 * (r / g.radius); // arms fray at the rim
    const make = (): Vec3 => {
      const theta = armOffset + spiral + gaussian(rng) * 0.28 * looseness;
      const y = gaussian(rng) * g.thickness * Math.exp((-1.5 * r) / g.radius); // thicker near the core
      return [r * Math.cos(theta), y, r * Math.sin(theta)];
    };
    return { pos: make(), rejitter: make };
  }

  if (g.form === 'elliptical' || g.form === 'halo') {
    const r = g.radius * (0.05 + 0.95 * p ** 0.7);
    const flat = g.form === 'halo' ? 0.9 : 0.6;
    const make = (): Vec3 => {
      const [x, y, z] = randomOnSphere(rng);
      const jr = r * (1 + gaussian(rng) * 0.08);
      return [x * jr, y * jr * flat, z * jr];
    };
    return { pos: make(), rejitter: make };
  }

  // Irregular (Polyglot): 5 seeded clumps; better-ranked stars sit nearer their clump centre.
  const clumps = mulberry32(g.seed);
  const centres: Vec3[] = Array.from({ length: 5 }, () => {
    const [x, y, z] = randomOnSphere(clumps);
    const d = g.radius * (0.15 + 0.45 * clumps());
    return [x * d, y * d * 0.35, z * d];
  });
  const c = centres[Math.floor(rng() * centres.length)]!;
  const spread = g.radius * (0.08 + 0.3 * p ** 0.7);
  const make = (): Vec3 => [c[0] + gaussian(rng) * spread, c[1] + gaussian(rng) * spread * 0.4, c[2] + gaussian(rng) * spread];
  return { pos: make(), rejitter: make };
}

/** p ∈ [0,1): rank percentile within galaxy by impact, 0 = best. Returns float64 world position. */
export function placeStar(p: number, userId: number, g: GalaxyDef): Vec3 {
  const rng = mulberry32(hash32(userId) ^ g.seed);
  return galaxyToWorld(g, sampleLocal(p, rng, g).pos);
}

export const D_MIN = 100;
const CELL = 100;

/** Spatial hash for the minimum-separation bake pass. */
export class SeparationHash {
  private cells = new Map<string, Vec3[]>();
  private key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  tooClose(p: Vec3): boolean {
    const cx = Math.floor(p[0] / CELL);
    const cy = Math.floor(p[1] / CELL);
    const cz = Math.floor(p[2] / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.cells.get(this.key(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const q of bucket) {
            const ddx = q[0] - p[0];
            const ddy = q[1] - p[1];
            const ddz = q[2] - p[2];
            if (ddx * ddx + ddy * ddy + ddz * ddz < D_MIN * D_MIN) return true;
          }
        }
    return false;
  }
  insert(p: Vec3): void {
    const k = this.key(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL), Math.floor(p[2] / CELL));
    const b = this.cells.get(k);
    if (b) b.push(p);
    else this.cells.set(k, [p]);
  }
}

/** placeStar + min-separation: re-jitter up to 8 times using the next RNG draws, then accept anyway. */
export function placeStarSeparated(p: number, userId: number, g: GalaxyDef, grid: SeparationHash): Vec3 {
  const rng = mulberry32(hash32(userId) ^ g.seed);
  const s = sampleLocal(p, rng, g);
  let world = galaxyToWorld(g, s.pos);
  for (let i = 0; i < 8 && grid.tooClose(world); i++) world = galaxyToWorld(g, s.rejitter());
  grid.insert(world);
  return world;
}

// ─── Provisional placement (§3.6) ─────────────────────────────────────────

export const QUANTILE_BUCKETS = 1000;

/** 1,000-bucket descending impact quantile table for a galaxy. */
export function impactQuantiles(impactsDesc: number[]): number[] {
  const n = impactsDesc.length;
  if (n === 0) return [];
  return Array.from({ length: QUANTILE_BUCKETS }, (_, i) => impactsDesc[Math.min(n - 1, Math.floor((i / QUANTILE_BUCKETS) * n))]!);
}

/** Estimated rank percentile p (0 = best) from the quantile table. */
export function provisionalPercentile(table: number[], impactValue: number): number {
  if (!table.length) return 0.5;
  let i = 0;
  while (i < table.length && table[i]! > impactValue) i++;
  return Math.min(0.999, i / table.length);
}
