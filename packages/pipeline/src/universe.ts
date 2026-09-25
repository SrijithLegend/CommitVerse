/** Current-universe state (last bake): population context + galaxy parameters, cached in memory. */
import type { Db, Sql } from '@commitverse/db';
import {
  type GalaxyDef,
  hash32,
  impactQuantiles,
  type Manifest,
  type ManifestGalaxy,
  POLYGLOT,
  type PopulationContext,
  VOID,
} from '@commitverse/universe-core';

export interface UniverseSummary {
  bakeVersion: string;
  createdAt: string;
  impactP999: number;
  cTotalP80: number;
  hypergiantImpact: number;
  c30Quantiles: number[];
  galaxies: Omit<ManifestGalaxy, 'nodes'>[];
  starCount: number;
}

let cache: { at: number; value: UniverseSummary | null } | null = null;

export function summaryFromManifest(m: Manifest): UniverseSummary {
  return {
    bakeVersion: m.bakeVersion,
    createdAt: m.createdAt,
    impactP999: m.impactP999,
    cTotalP80: m.cTotalP80,
    hypergiantImpact: m.hypergiantImpact,
    c30Quantiles: m.c30Quantiles,
    galaxies: m.galaxies.map(({ nodes: _nodes, ...g }) => g),
    starCount: m.counts.stars,
  };
}

export async function getUniverse(db: Sql, fresh = false): Promise<UniverseSummary | null> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.value;
  const [row] = await db.query<{ value: UniverseSummary }>(`select value from universe_state where key = 'current'`);
  cache = { at: Date.now(), value: row?.value ?? null };
  return cache.value;
}

export const invalidateUniverseCache = (): void => {
  cache = null;
};

export function contextOf(u: UniverseSummary | null): PopulationContext {
  if (!u) return { c30ActiveSorted: [], cTotalP80: 1000, impactP999: 3, hypergiantImpact: Number.POSITIVE_INFINITY };
  return { c30ActiveSorted: u.c30Quantiles, cTotalP80: u.cTotalP80, impactP999: u.impactP999, hypergiantImpact: u.hypergiantImpact };
}

export const galaxyDef = (g: Omit<ManifestGalaxy, 'nodes'>): GalaxyDef => ({
  id: g.id,
  language: g.language,
  tier: g.tier,
  form: g.form,
  population: g.population,
  arms: g.arms,
  radius: g.radius,
  coreRadius: g.coreRadius,
  thickness: g.thickness,
  pitch: g.pitch,
  tilt: g.tilt,
  center: g.center,
  seed: hash32(g.language),
});

/** Galaxy a language belongs to in the current bake (tail languages → Polyglot; unknown → Polyglot → Void). */
export function galaxyForLanguage(u: UniverseSummary, language: string): Omit<ManifestGalaxy, 'nodes'> | null {
  const byMember = u.galaxies.find((g) => g.members.includes(language));
  if (byMember) return byMember;
  if (language === VOID) return u.galaxies.find((g) => g.language === VOID) ?? u.galaxies.find((g) => g.language === POLYGLOT) ?? null;
  return u.galaxies.find((g) => g.language === POLYGLOT) ?? u.galaxies.find((g) => g.language === VOID) ?? u.galaxies[0] ?? null;
}

/** Atomically reserves the next dense star index for a provisional star. */
export async function nextStarIndex(db: Sql): Promise<number> {
  const [row] = await db.query<{ n: number }>(
    `insert into universe_state (key, value) values ('next_star_index', '0'::jsonb)
     on conflict (key) do update set value = to_jsonb((universe_state.value)::text::bigint + 1), updated_at = now()
     returning (value)::text::bigint as n`,
  );
  return row!.n;
}

export async function setState(db: Sql, key: string, value: unknown): Promise<void> {
  await db.query(
    `insert into universe_state (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export async function getState<T>(db: Sql, key: string): Promise<T | null> {
  const [row] = await db.query<{ value: T }>('select value from universe_state where key = $1', [key]);
  return row?.value ?? null;
}

export type { Db };
export { impactQuantiles };
