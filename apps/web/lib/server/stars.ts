/** Star lookups: resolve, detail (F3/F4), position, briefs, search. */
import 'server-only';
import type { PlanetDto, SearchResult, StarBrief, StarDetail } from '@commitverse/contracts';
import type { Sql } from '@commitverse/db';
import { rarityMap, starInput, syntheticCalendar, syntheticRepos } from '@commitverse/pipeline';
import {
  beltCount,
  buildPlanets,
  type DerivedStar,
  explainStar,
  languageColor,
  oortDensity,
  type RepoInput,
  type SpectralClass,
  spectralSubclass,
  unpackFlags,
} from '@commitverse/universe-core';
import { ApiError } from './errors';

export interface ResolvedUser {
  githubId: number;
  login: string;
  optedOut: boolean;
  synthetic: boolean;
  redirectedFrom: string | null;
}

/** Resolves a login (case-insensitive) or a rename alias. Throws 410 for opted-out stars. */
export async function resolveLogin(db: Sql, login: string): Promise<ResolvedUser | null> {
  const [u] = await db.query<{ github_id: number; login: string; is_opted_out: boolean; synthetic: boolean }>(
    'select github_id, login::text as login, is_opted_out, synthetic from github_users where login = $1',
    [login],
  );
  if (u) return { githubId: u.github_id, login: u.login, optedOut: u.is_opted_out, synthetic: u.synthetic, redirectedFrom: null };
  const [a] = await db.query<{ github_id: number; login: string; is_opted_out: boolean; synthetic: boolean }>(
    `select g.github_id, g.login::text as login, g.is_opted_out, g.synthetic from login_aliases a join github_users g using (github_id) where a.old_login = $1`,
    [login],
  );
  if (a) return { githubId: a.github_id, login: a.login, optedOut: a.is_opted_out, synthetic: a.synthetic, redirectedFrom: login };
  return null;
}

export async function requireStar(db: Sql, login: string): Promise<ResolvedUser> {
  const u = await resolveLogin(db, login);
  if (!u) throw new ApiError(404, 'not_mapped', `@${login} is not in the universe yet`);
  if (u.optedOut) throw new ApiError(410, 'removed', 'This star was removed at its owner’s request');
  return u;
}

interface DetailRow {
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  bio: string | null;
  bio_override: string | null;
  created_at_gh: Date;
  last_fetched_at: Date | null;
  synthetic: boolean;
  c_total: number;
  c_30: number;
  c_90: number;
  c_365: number;
  streak_current: number;
  streak_longest: number;
  stars_total: number;
  forks_total: number;
  followers: number;
  following: number;
  repos_public: number;
  stars_approx: boolean;
  last_active_on: string | null;
  lang_weights: Record<string, number>;
  calendar_52w: number[] | null;
  galaxy_id: number;
  galaxy_language: string;
  x: number;
  y: number;
  z: number;
  provisional: boolean;
  radius: number;
  base_radius: number;
  temperature: number;
  spectral_class: SpectralClass;
  luminosity: number;
  impact: number;
  state: DerivedStar['state'];
  flags: number;
  rank_galaxy: number | null;
  rank_global: number | null;
  pct_galaxy: number | null;
  bake_version: string;
  claimed: boolean;
  pinned_override: number[] | null;
  beacon_active: boolean;
}

export async function starDetail(db: Sql, githubId: number): Promise<StarDetail> {
  const [r] = await db.query<DetailRow>(
    `select u.github_id, u.login::text as login, u.name, u.avatar_url, u.bio, a.bio_override, u.created_at_gh, u.last_fetched_at, u.synthetic,
       m.c_total, m.c_30, m.c_90, m.c_365, m.streak_current, m.streak_longest, m.stars_total, m.forks_total, m.followers, m.following,
       m.repos_public, m.stars_approx, m.last_active_on, m.lang_weights, m.calendar_52w,
       b.galaxy_id, g.language as galaxy_language, b.x, b.y, b.z, b.provisional, b.radius, b.base_radius, b.temperature, b.spectral_class,
       b.luminosity, b.impact, b.state, b.flags, b.rank_galaxy, b.rank_global, b.pct_galaxy, b.bake_version,
       (a.github_id is not null) as claimed, a.pinned_override,
       coalesce(a.beacon_last_at > now() - interval '2 minutes' and not coalesce((a.settings->>'hideBeacon')::boolean, false), false) as beacon_active
     from github_users u
     join user_metrics m using (github_id)
     join bodies b on b.github_id = u.github_id
     join galaxies g on g.id = b.galaxy_id
     left join accounts a on a.github_id = u.github_id
     where u.github_id = $1 and not u.is_opted_out`,
    [githubId],
  );
  if (!r) throw new ApiError(404, 'not_placed', 'This star has not been placed yet — try again in a moment');

  const now = Date.now();
  const repos: (RepoInput & { description: string | null; languageColor: string })[] = r.synthetic
    ? syntheticRepos(r.github_id, r.stars_total, r.repos_public, r.lang_weights, now)
    : (
        await db.query<{
          github_repo_id: number;
          name: string;
          description: string | null;
          stars: number;
          forks: number;
          releases_count: number;
          pushed_at: Date | null;
          created_at_gh: Date | null;
          is_archived: boolean;
          primary_language: string | null;
          language_color: string | null;
        }>(
          `select github_repo_id, name, description, stars, forks, releases_count, pushed_at, created_at_gh, is_archived, primary_language, language_color
           from repos where owner_id = $1 and planet_slot is not null order by planet_slot`,
          [githubId],
        )
      ).map((x) => ({
        repoId: x.github_repo_id,
        name: x.name,
        description: x.description,
        stars: x.stars,
        forks: x.forks,
        releases: x.releases_count,
        pushedAt: x.pushed_at?.toISOString() ?? null,
        createdAt: x.created_at_gh?.toISOString() ?? null,
        isArchived: x.is_archived,
        language: x.primary_language,
        languageColor: x.language_color ?? languageColor(x.primary_language),
      }));
  const planets: PlanetDto[] = buildPlanets(r.radius, repos, now).map((p, i) => ({
    repoId: p.repoId,
    name: p.name,
    description: repos[i]!.description,
    stars: p.stars,
    forks: p.forks,
    releases: p.releases,
    language: p.language,
    languageColor: repos[i]!.languageColor,
    pushedAt: p.pushedAt,
    isArchived: p.isArchived,
    type: p.type,
    moons: p.moons,
    ringBands: p.ringBands,
    slot: p.slot,
    orbitRadius: p.orbitRadius,
    radius: p.radius,
    period: p.period,
    inclination: p.inclination,
    phase: p.phase,
    axialTilt: p.axialTilt,
    spinPeriod: p.spinPeriod,
    aurora: p.aurora,
    greatSpot: p.greatSpot,
  }));

  const [equippedRows, achievements, orgs, social, history, rarity] = await Promise.all([
    db.query<{ slot: string; item_id: string }>(
      `select e.slot, i.item_id from equipped e join inventory i on i.id = e.inventory_id where e.github_id = $1 and i.revoked_at is null`,
      [githubId],
    ),
    db.query<{ id: string; name: string; tier: string; unlocked_at: Date }>(
      `select a.id, a.name, a.tier, ua.unlocked_at from user_achievements ua join achievements a on a.id = ua.achievement_id where ua.github_id = $1`,
      [githubId],
    ),
    db.query<{ login: string; name: string | null; avatar_url: string | null }>(
      `select o.login::text as login, o.name, o.avatar_url from org_members om join orgs o on o.github_org_id = om.org_id where om.github_id = $1 order by o.login limit 20`,
      [githubId],
    ),
    db.query<{ signals: number; binary_with: string | null; gift_pods: number; remnant: Date | null; banner: string | null }>(
      `select (select count(*)::int from signals where to_id = $1) as signals,
         (select g.login::text from bindings b join github_users g on g.github_id = case when b.a_id = $1 then b.b_id else b.a_id end
            where b.status = 'active' and (b.a_id = $1 or b.b_id = $1) limit 1) as binary_with,
         (select count(*)::int from gifts where to_id = $1 and state in ('pending','delivered')) as gift_pods,
         (select max(created_at) from events where actor_id = $1 and type = 'supernova' and created_at > now() - interval '7 days') as remnant,
         (select text from banners where github_id = $1 and status = 'approved') as banner`,
      [githubId],
    ),
    db.query<{ bake_version: string; rank_galaxy: number | null; pct_galaxy: number | null }>(
      `select bake_version, rank_galaxy, pct_galaxy from rank_history where github_id = $1 order by baked_at desc limit 30`,
      [githubId],
    ),
    rarityMap(db),
  ]);

  const input = starInput(r, r.created_at_gh, now);
  const { flags } = unpackFlags(r.flags);
  const derived = {
    radius: r.radius,
    baseRadius: r.base_radius,
    T: r.temperature,
    cls: r.spectral_class,
    L: r.luminosity,
    state: r.state,
    impact: r.impact,
    activityPct: null,
    pulsar: flags.includes('pulsar'),
    pulsarPeriod: flags.includes('pulsar') ? Math.max(0.4, Math.min(2.4, 2.4 - 0.6 * Math.log10(Math.max(1, r.streak_current)))) : null,
    hypergiant: flags.includes('hypergiant'),
    flags: r.flags,
  } satisfies DerivedStar;
  const why = explainStar(input, derived, r.spectral_class);
  const s = social[0]!;
  const remnantUntil = s.remnant ? new Date(s.remnant.getTime() + 7 * 86_400_000).toISOString() : null;
  const cosmetics: Record<string, string | null> = {};
  for (const e of equippedRows) cosmetics[e.slot] = e.item_id;

  return {
    user: {
      githubId: r.github_id,
      login: r.login,
      name: r.name,
      avatarUrl: r.avatar_url,
      bio: r.bio_override ?? r.bio,
      createdAt: r.created_at_gh.toISOString(),
    },
    metrics: {
      cTotal: r.c_total,
      c30: r.c_30,
      c90: r.c_90,
      c365: r.c_365,
      streakCurrent: r.streak_current,
      streakLongest: r.streak_longest,
      starsTotal: r.stars_total,
      forksTotal: r.forks_total,
      followers: r.followers,
      following: r.following,
      reposPublic: r.repos_public,
      starsApprox: r.stars_approx,
      lastActiveOn: r.last_active_on,
      langWeights: r.lang_weights,
      calendar52w:
        r.calendar_52w ?? syntheticCalendar(r.github_id, { c30: r.c_30, c90: r.c_90, c365: r.c_365, streakCurrent: r.streak_current }),
    },
    body: {
      galaxy: { id: r.galaxy_id, language: r.galaxy_language },
      position: [r.x, r.y, r.z],
      provisional: r.provisional,
      radius: r.radius,
      baseRadius: r.base_radius,
      temperature: r.temperature,
      spectralClass: r.spectral_class,
      subclass: spectralSubclass(r.temperature),
      luminosity: r.luminosity,
      impact: r.impact,
      state: r.state,
      flags: [...flags, ...(r.beacon_active ? (['beacon'] as const) : [])],
      pulsarPeriod: derived.pulsarPeriod,
      rankGalaxy: r.rank_galaxy,
      rankGlobal: r.rank_global,
      pctGalaxy: r.pct_galaxy,
      beltCount: beltCount(r.repos_public, planets.length),
      oortDensity: oortDensity(r.followers),
    },
    planets,
    cosmetics,
    achievements: achievements
      .map((a) => ({ id: a.id, name: a.name, tier: a.tier, rarity: rarity.get(a.id) ?? 0, unlockedAt: a.unlocked_at.toISOString() }))
      .sort((a, b) => a.rarity - b.rarity),
    orgs: orgs.map((o) => ({ login: o.login, name: o.name, avatarUrl: o.avatar_url })),
    social: {
      signalsReceived: s.signals,
      binaryWith: s.binary_with,
      claimed: r.claimed,
      giftPods: s.gift_pods,
      remnantUntil,
      beaconActive: r.beacon_active,
      bannerText: s.banner,
    },
    why,
    rankHistory: history.reverse().map((h) => ({ bakeVersion: h.bake_version, rankGalaxy: h.rank_galaxy, pctGalaxy: h.pct_galaxy })),
    bakeVersion: r.bake_version,
    fetchedAt: r.last_fetched_at?.toISOString() ?? null,
  };
}

export async function briefs(db: Sql, ids: number[]): Promise<StarBrief[]> {
  const rows = await db.query<{
    github_id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
    spectral_class: SpectralClass;
    state: StarBrief['state'];
    radius: number;
    temperature: number;
    luminosity: number;
    language: string;
    x: number;
    y: number;
    z: number;
  }>(
    `select b.github_id, u.login::text as login, u.name, u.avatar_url, b.spectral_class, b.state, b.radius, b.temperature, b.luminosity, g.language, b.x, b.y, b.z
     from bodies b join github_users u using (github_id) join galaxies g on g.id = b.galaxy_id
     where b.github_id = any($1::bigint[]) and not u.is_opted_out`,
    [ids],
  );
  return rows.map((r) => ({
    githubId: r.github_id,
    login: r.login,
    name: r.name,
    avatarUrl: r.avatar_url,
    spectralClass: r.spectral_class,
    state: r.state,
    radius: r.radius,
    temperature: r.temperature,
    luminosity: r.luminosity,
    galaxy: r.language,
    position: [r.x, r.y, r.z] as [number, number, number],
  }));
}

/** Prefix (B-tree) first, then trigram similarity on login and name; plus org matches. ≤ 8 results. */
export async function search(db: Sql, q: string): Promise<SearchResult[]> {
  const term = q.trim().replace(/^@/, '').slice(0, 39);
  if (!term) return [];
  const like = `${term.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`;
  const users = await db.query<{
    github_id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
    language: string | null;
    spectral_class: SpectralClass | null;
    score: number;
  }>(
    `with prefix as (
       select u.github_id, 2.0::float8 as score from github_users u
       where lower(u.login::text) like $1 and not u.is_opted_out order by length(u.login::text) limit 8),
     fuzzy as (
       select u.github_id, greatest(similarity(u.login::text, $2), similarity(coalesce(u.name, ''), $2))::float8 as score
       from github_users u where (u.login % $2 or u.name % $2) and not u.is_opted_out
       order by score desc limit 8),
     ranked as (select github_id, max(score) as score from (select * from prefix union all select * from fuzzy) x group by github_id)
     select u.github_id, u.login::text as login, u.name, u.avatar_url, g.language, b.spectral_class, r.score
     from ranked r join github_users u using (github_id)
     left join bodies b on b.github_id = u.github_id left join galaxies g on g.id = b.galaxy_id
     order by r.score desc, b.impact desc nulls last limit 8`,
    [like, term],
  );
  const results: SearchResult[] = users.map((u) => ({
    githubId: u.github_id,
    login: u.login,
    name: u.name,
    avatarUrl: u.avatar_url,
    galaxy: u.language,
    spectralClass: u.spectral_class,
    kind: 'user',
  }));
  if (results.length < 8) {
    const orgs = await db.query<{ github_org_id: number; login: string; name: string | null; avatar_url: string | null }>(
      `select o.github_org_id, o.login::text as login, o.name, o.avatar_url from orgs o
       where lower(o.login::text) like $1 and (select count(*) from org_members m where m.org_id = o.github_org_id) >= 3 limit $2`,
      [like, 8 - results.length],
    );
    for (const o of orgs)
      results.push({
        githubId: o.github_org_id,
        login: o.login,
        name: o.name,
        avatarUrl: o.avatar_url,
        galaxy: null,
        spectralClass: null,
        kind: 'org',
      });
  }
  return results;
}
