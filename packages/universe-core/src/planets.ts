/** §3.4 — planets, moons, rings, belts, Oort cloud. Orbits are closed-form functions of time (§6.9). */
import { hash32, hashUnit } from './random';

export const MAX_PLANETS = 8;
export const SYSTEM_EXTENT_MAX = 42;
export const ORBIT_CAP = 40;

export interface RepoInput {
  repoId: number;
  name: string;
  stars: number;
  forks: number;
  releases: number;
  pushedAt: string | null;
  createdAt?: string | null;
  isArchived: boolean;
  language: string | null;
}

export type PlanetType = 'gas_giant' | 'ocean' | 'rocky';

export interface Planet extends RepoInput {
  slot: number;
  orbitRadius: number;
  radius: number;
  type: PlanetType;
  moons: number;
  ringBands: number;
  aurora: boolean;
  period: number;
  inclination: number; // radians
  phase: number; // radians
  axialTilt: number; // radians
  spinPeriod: number; // seconds
  greatSpot: boolean;
}

/** Top 8 by stars (ties: pushedAt desc, then repoId), or the claimed user's pinned override order. */
export function selectPlanets(repos: RepoInput[], pinnedOverride?: number[] | null): RepoInput[] {
  if (pinnedOverride?.length) {
    const byId = new Map(repos.map((r) => [r.repoId, r]));
    const picked = pinnedOverride.map((id) => byId.get(id)).filter((r): r is RepoInput => !!r);
    if (picked.length) return picked.slice(0, MAX_PLANETS);
  }
  return [...repos]
    .sort(
      (a, b) =>
        b.stars - a.stars ||
        (Date.parse(b.pushedAt ?? '1970-01-01') || 0) - (Date.parse(a.pushedAt ?? '1970-01-01') || 0) ||
        a.repoId - b.repoId,
    )
    .slice(0, MAX_PLANETS);
}

export function orbitRadii(starRadius: number, count: number): number[] {
  const a = Array.from({ length: count }, (_, i) => 2 * starRadius + 2.2 * (i + 1) ** 1.3);
  const last = a[a.length - 1];
  if (last !== undefined && last > ORBIT_CAP) {
    const k = ORBIT_CAP / last;
    return a.map((x) => x * k);
  }
  return a;
}

export const planetRadius = (stars: number): number => 0.12 + 0.55 * Math.max(0, Math.min(1, Math.log10(1 + stars) / 5));

export const planetType = (stars: number): PlanetType => (stars >= 1000 ? 'gas_giant' : stars >= 100 ? 'ocean' : 'rocky');

export const moonCount = (forks: number): number => Math.min(5, Math.floor(Math.log10(1 + forks)));

export const ringBands = (releases: number): number => (releases >= 1 ? Math.min(6, 1 + Math.floor(Math.log2(releases))) : 0);

export const orbitalPeriod = (a: number, a0: number): number => 20 * (a / a0) ** 1.5;

const DEG = Math.PI / 180;

export function buildPlanets(starRadius: number, repos: RepoInput[], now = Date.now()): Planet[] {
  const radii = orbitRadii(starRadius, repos.length);
  const a0 = radii[0] ?? 1;
  return repos.map((r, i) => {
    const a = radii[i]!;
    const h = hash32(r.repoId);
    return {
      ...r,
      slot: i,
      orbitRadius: a,
      radius: planetRadius(r.stars),
      type: planetType(r.stars),
      moons: moonCount(r.forks),
      ringBands: ringBands(r.releases),
      aurora: !!r.pushedAt && now - Date.parse(r.pushedAt) <= 7 * 86_400_000,
      period: orbitalPeriod(a, a0),
      inclination: (hashUnit(h, 0x11) * 2 - 1) * 6 * DEG,
      phase: hashUnit(h, 0x22) * Math.PI * 2,
      axialTilt: hashUnit(h, 0x33) * 35 * DEG,
      spinPeriod: 6 + hashUnit(h, 0x44) * 24,
      greatSpot: r.stars >= 10_000,
    };
  });
}

/** Closed-form orbital position (system-local). Archived planets are frozen at their phase. */
export function planetPosition(
  p: Pick<Planet, 'orbitRadius' | 'period' | 'phase' | 'inclination' | 'isArchived'>,
  t: number,
): [number, number, number] {
  const ang = p.isArchived ? p.phase : p.phase + (2 * Math.PI * t) / p.period;
  const x = p.orbitRadius * Math.cos(ang);
  const z = p.orbitRadius * Math.sin(ang);
  return [x, z * Math.sin(p.inclination), z * Math.cos(p.inclination)];
}

export const beltCount = (reposPublic: number, planetsShown: number): number => {
  const n = Math.max(0, reposPublic - planetsShown);
  return n === 0 ? 0 : Math.min(2000, Math.round(40 * Math.sqrt(n)));
};

/** Belt sits between planets 5 and 6, or just outside the last planet. Returns [inner, outer]. */
export function beltRange(orbits: number[]): [number, number] {
  if (orbits.length >= 7) return [orbits[5]! + 0.25 * (orbits[6]! - orbits[5]!), orbits[5]! + 0.75 * (orbits[6]! - orbits[5]!)];
  const last = orbits[orbits.length - 1] ?? 8;
  return [last + 1.5, Math.min(SYSTEM_EXTENT_MAX, last + 4)];
}

export const OORT_RADIUS = 46;
export const oortDensity = (followers: number): number => Math.min(3000, Math.round(200 * Math.log10(1 + followers)));
