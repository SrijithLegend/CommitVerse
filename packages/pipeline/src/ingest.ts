/**
 * Ingest a fetched user: mirror → metrics → repos/planets → orgs → body (provisional placement if new) →
 * supernova detection. Positions only change at the nightly bake; attributes update immediately (delta layer).
 */
import type { Db, Sql } from '@commitverse/db';
import {
  type DerivedStar,
  deriveStar,
  type Milestone,
  milestonesCrossed,
  placeStar,
  provisionalPercentile,
  type StarMetricsInput,
  selectPlanets,
} from '@commitverse/universe-core';
import { log } from './log';
import { emitEvent, grantStardust, notify } from './social';
import { type ComputedMetrics, computeMetrics, type FetchedUser } from './starfetch';
import { contextOf, galaxyDef, galaxyForLanguage, getUniverse, nextStarIndex, type UniverseSummary } from './universe';

const DAY = 86_400_000;

export function starInput(
  m: {
    c_total: number;
    c_30: number;
    c_90: number;
    stars_total: number;
    followers: number;
    streak_current: number;
    last_active_on: string | null;
  },
  createdAtGh: string | Date,
  now = Date.now(),
): StarMetricsInput {
  return {
    cTotal: m.c_total,
    c30: m.c_30,
    c90: m.c_90,
    starsTotal: m.stars_total,
    followers: m.followers,
    streakCurrent: m.streak_current,
    accountAgeDays: Math.floor((now - new Date(createdAtGh).getTime()) / DAY),
    daysSinceActive: m.last_active_on ? Math.floor((now - Date.parse(`${m.last_active_on}T00:00:00Z`)) / DAY) : null,
  };
}

export interface SocialFlags {
  claimed: boolean;
  binary: boolean;
  online: boolean;
}

export async function socialFlags(db: Sql, githubId: number): Promise<SocialFlags> {
  const [r] = await db.query<{ claimed: boolean; binary: boolean; online: boolean }>(
    `select exists(select 1 from accounts where github_id = $1 and banned_at is null) as claimed,
            exists(select 1 from bindings where status = 'active' and (a_id = $1 or b_id = $1)) as binary,
            exists(select 1 from accounts where github_id = $1 and beacon_last_at > now() - interval '2 minutes'
                   and not coalesce((settings->>'hideBeacon')::boolean, false)) as online`,
    [githubId],
  );
  return r ?? { claimed: false, binary: false, online: false };
}

/** Next refresh by tier (§8.5). */
export async function scheduleRefresh(db: Sql, githubId: number): Promise<void> {
  await db.query(
    `with t as (
       select case
         when a.sync_token_enc is not null then 0
         when a.github_id is not null then 1
         when u.last_viewed_at > now() - interval '7 days' then 2
         when b.rank_global <= 50000 then 3
         else 4 end as tier
       from github_users u
       left join accounts a on a.github_id = u.github_id
       left join bodies b on b.github_id = u.github_id
       where u.github_id = $1)
     update github_users set refresh_tier = t.tier,
       next_refresh_at = now() + case t.tier when 0 then interval '6 hours' when 1 then interval '12 hours'
         when 2 then interval '24 hours' when 3 then interval '7 days' else interval '30 days' end
     from t where github_users.github_id = $1`,
    [githubId],
  );
}

/** Writes (or updates) the body row. New stars get a provisional position from the galaxy quantile table. */
export async function upsertBody(
  db: Sql,
  githubId: number,
  metrics: { primaryLanguage: string; input: StarMetricsInput },
  u: UniverseSummary | null,
): Promise<{ derived: DerivedStar; created: boolean } | null> {
  const flags = await socialFlags(db, githubId);
  const derived = deriveStar(metrics.input, contextOf(u), flags);
  const [existing] = await db.query<{ spectral_class: string; state: string; flags: number; temperature: number }>(
    'select spectral_class, state, flags, temperature from bodies where github_id = $1',
    [githubId],
  );
  if (existing) {
    const changed = existing.spectral_class !== derived.cls || existing.state !== derived.state || existing.flags !== derived.flags;
    await db.query(
      `update bodies set radius = $2, base_radius = $3, temperature = $4, spectral_class = $5, luminosity = $6, impact = $7,
         state = $8, flags = $9, delta_at = case when $10 then now() else delta_at end where github_id = $1`,
      [
        githubId,
        derived.radius,
        derived.baseRadius,
        derived.T,
        derived.cls,
        derived.L,
        derived.impact,
        derived.state,
        derived.flags,
        changed,
      ],
    );
    return { derived, created: false };
  }
  if (!u) return null; // no universe yet — the first bake will place this star
  const g = galaxyForLanguage(u, metrics.primaryLanguage);
  if (!g) return null;
  const p = provisionalPercentile(g.quantiles, derived.impact);
  const [x, y, z] = placeStar(p, githubId, galaxyDef(g));
  const starIndex = await nextStarIndex(db);
  await db.query(
    `insert into bodies (github_id, bake_version, provisional, galaxy_id, star_index, x, y, z, radius, base_radius, temperature,
       spectral_class, luminosity, impact, state, flags, rank_galaxy, pct_galaxy, delta_at)
     values ($1, $2, true, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now())`,
    [
      githubId,
      u.bakeVersion,
      g.id,
      starIndex,
      x,
      y,
      z,
      derived.radius,
      derived.baseRadius,
      derived.T,
      derived.cls,
      derived.L,
      derived.impact,
      derived.state,
      derived.flags,
      Math.max(1, Math.round(p * g.population) + 1),
      p,
    ],
  );
  return { derived, created: true };
}

export interface IngestResult {
  githubId: number;
  login: string;
  optedOut: boolean;
  milestones: Milestone[];
  placed: boolean;
  metrics: ComputedMetrics;
}

export async function ingestUser(db: Db, f: FetchedUser, now = new Date()): Promise<IngestResult> {
  const metrics = computeMetrics(f, now);
  const result = await db.tx(async (q) => {
    const [tomb] = await q.query<{ is_opted_out: boolean }>('select is_opted_out from github_users where github_id = $1', [f.githubId]);
    if (tomb?.is_opted_out) return { optedOut: true, milestones: [] as Milestone[], placed: false };

    // Login changes: keep an alias for 301s; free the login if a different account held it before.
    const [prevLogin] = await q.query<{ login: string }>('select login::text as login from github_users where github_id = $1', [
      f.githubId,
    ]);
    await q.query(`update github_users set login = login || '~' || github_id where login = $1 and github_id <> $2`, [f.login, f.githubId]);
    if (prevLogin && prevLogin.login.toLowerCase() !== f.login.toLowerCase()) {
      await q.query(
        `insert into login_aliases (old_login, github_id) values ($1, $2)
         on conflict (old_login) do update set github_id = excluded.github_id, changed_at = now()`,
        [prevLogin.login, f.githubId],
      );
    }
    await q.query(
      `insert into github_users (github_id, login, name, avatar_url, bio, created_at_gh, last_fetched_at, fetch_error)
       values ($1, $2, $3, $4, $5, $6, now(), null)
       on conflict (github_id) do update set login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url,
         bio = excluded.bio, last_fetched_at = now(), fetch_error = null`,
      [f.githubId, f.login, f.name, f.avatarUrl, f.bio, f.createdAt],
    );

    const [prev] = await q.query<{ c_total: number; stars_total: number; prev_state: string | null }>(
      'select c_total, stars_total, prev_state from user_metrics where github_id = $1',
      [f.githubId],
    );
    const prevRepoStars = new Map(
      (
        await q.query<{ github_repo_id: number; stars: number }>('select github_repo_id, stars from repos where owner_id = $1', [
          f.githubId,
        ])
      ).map((r) => [r.github_repo_id, r.stars] as [number, number]),
    );
    const [prevBody] = await q.query<{ state: string }>('select state from bodies where github_id = $1', [f.githubId]);

    await q.query(
      `insert into user_metrics (github_id, c_total, c_30, c_90, c_365, c_30_source, streak_current, streak_longest, last_active_on,
         stars_total, stars_approx, forks_total, followers, following, repos_public, lang_weights, primary_language, yearly_contrib,
         calendar_52w, prev_state, updated_at)
       values ($1,$2,$3,$4,$5,'api',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
       on conflict (github_id) do update set c_total = excluded.c_total, c_30 = excluded.c_30, c_90 = excluded.c_90,
         c_365 = excluded.c_365, c_30_source = 'api', streak_current = excluded.streak_current,
         streak_longest = greatest(user_metrics.streak_longest, excluded.streak_longest), last_active_on = excluded.last_active_on,
         stars_total = excluded.stars_total, stars_approx = excluded.stars_approx, forks_total = excluded.forks_total,
         followers = excluded.followers, following = excluded.following, repos_public = excluded.repos_public,
         lang_weights = excluded.lang_weights, primary_language = excluded.primary_language, yearly_contrib = excluded.yearly_contrib,
         calendar_52w = excluded.calendar_52w, prev_state = excluded.prev_state, updated_at = now()`,
      [
        f.githubId,
        metrics.cTotal,
        metrics.c30,
        metrics.c90,
        metrics.c365,
        metrics.streakCurrent,
        metrics.streakLongest,
        metrics.lastActiveOn,
        metrics.starsTotal,
        metrics.starsApprox,
        metrics.forksTotal,
        metrics.followers,
        metrics.following,
        metrics.reposPublic,
        JSON.stringify(metrics.langWeights),
        metrics.primaryLanguage,
        JSON.stringify(metrics.yearly),
        metrics.calendar52w,
        prevBody?.state ?? prev?.prev_state ?? null,
      ],
    );

    // Repos → planets. Claimed users may override the selection with pinned_override.
    const [acct] = await q.query<{ pinned_override: number[] | null }>('select pinned_override from accounts where github_id = $1', [
      f.githubId,
    ]);
    const planets = selectPlanets(f.repos, acct?.pinned_override ?? null);
    const slot = new Map(planets.map((p, i) => [p.repoId, i]));
    await q.query('delete from repos where owner_id = $1 and not (github_repo_id = any($2::bigint[]))', [
      f.githubId,
      f.repos.map((r) => r.repoId),
    ]);
    for (const r of f.repos) {
      await q.query(
        `insert into repos (github_repo_id, owner_id, name, description, stars, forks, primary_language, language_color, releases_count,
           pushed_at, created_at_gh, is_archived, planet_slot, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
         on conflict (github_repo_id) do update set owner_id = excluded.owner_id, name = excluded.name, description = excluded.description,
           stars = excluded.stars, forks = excluded.forks, primary_language = excluded.primary_language, language_color = excluded.language_color,
           releases_count = excluded.releases_count, pushed_at = excluded.pushed_at, created_at_gh = excluded.created_at_gh,
           is_archived = excluded.is_archived, planet_slot = excluded.planet_slot, updated_at = now()`,
        [
          r.repoId,
          f.githubId,
          r.name,
          r.description,
          r.stars,
          r.forks,
          r.language,
          r.languageColor,
          r.releases,
          r.pushedAt,
          r.createdAt,
          r.isArchived,
          slot.get(r.repoId) ?? null,
        ],
      );
    }

    // Orgs → constellations
    await q.query('delete from org_members where github_id = $1', [f.githubId]);
    for (const o of f.orgs) {
      await q.query(
        `insert into orgs (github_org_id, login, name, avatar_url) values ($1,$2,$3,$4)
         on conflict (github_org_id) do update set login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url`,
        [o.githubId, o.login, o.name, o.avatarUrl],
      );
      await q.query('insert into org_members (org_id, github_id) values ($1, $2) on conflict do nothing', [o.githubId, f.githubId]);
    }

    const u = await getUniverse(q);
    const body = await upsertBody(
      q,
      f.githubId,
      { primaryLanguage: metrics.primaryLanguage, input: starInput(toRow(metrics), f.createdAt, now.getTime()) },
      u,
    );
    await scheduleRefresh(q, f.githubId);

    const repoStars = new Map(f.repos.map((r) => [r.repoId, r.stars] as [number, number]));
    const milestones = milestonesCrossed(prev ? { cTotal: prev.c_total, starsTotal: prev.stars_total, repoStars: prevRepoStars } : null, {
      cTotal: metrics.cTotal,
      starsTotal: metrics.starsTotal,
      repoStars,
    });
    return { optedOut: false, milestones, placed: !!body };
  });

  for (const m of result.milestones) {
    const repo = m.repoId ? f.repos.find((r) => r.repoId === m.repoId) : undefined;
    const payload = {
      login: f.login,
      kind: m.kind,
      threshold: m.threshold,
      repo: repo?.name ?? null,
      remnantUntil: new Date(now.getTime() + 7 * DAY).toISOString(),
    };
    await emitEvent(db, { type: 'supernova', actorId: f.githubId, payload });
    await notify(db, f.githubId, 'supernova', payload);
    await grantStardust(db, f.githubId, 250, 'supernova', `${m.kind}:${m.threshold}:${m.repoId ?? ''}`);
    if (m.kind === 'repo_stars') await emitEvent(db, { type: 'repo_milestone', actorId: f.githubId, payload });
    const { broadcast } = await import('./realtime');
    void broadcast('cosmic:global', 'supernova', { githubId: f.githubId, ...payload });
    log.info({ github_id: f.githubId, milestone: m }, 'supernova');
  }
  return { githubId: f.githubId, login: f.login, metrics, ...result };
}

const toRow = (m: ComputedMetrics) => ({
  c_total: m.cTotal,
  c_30: m.c30,
  c_90: m.c90,
  stars_total: m.starsTotal,
  followers: m.followers,
  streak_current: m.streakCurrent,
  last_active_on: m.lastActiveOn,
});
