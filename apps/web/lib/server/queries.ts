/** Read models shared by API routes and SSR pages: galaxies, leaderboards, feed, census, achievements. */
import 'server-only';
import { ACHIEVEMENTS } from '@commitverse/achievements';
import type { FeedEvent, LeaderboardMetric, LeaderboardRow } from '@commitverse/contracts';
import type { Sql } from '@commitverse/db';
import { getUniverse, rarityMap } from '@commitverse/pipeline';
import type { SpectralClass } from '@commitverse/universe-core';
import { ApiError } from './errors';

export const PAGE = 50;

/**
 * Per-instance TTL memo for expensive aggregates (census, achievement rarity). Pages can't use ISR because the root
 * layout reads the per-request CSP nonce, so without this every view would rerun full-table counts.
 * ponytail: per-instance, not shared; move to Redis if instance count makes the DB load matter.
 */
const memo = new Map<string, { at: number; v: Promise<unknown> }>();
export function cachedFor<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as Promise<T>;
  const v = fn();
  memo.set(key, { at: Date.now(), v });
  v.catch(() => memo.delete(key)); // never cache a failure
  return v;
}

export async function galaxyOverview(db: Sql, lang: string) {
  const [g] = await db.query<{
    id: number;
    language: string;
    tier: string;
    arms: number | null;
    radius: number;
    population: number;
    center: number[];
  }>('select id, language, tier, arms, radius, population, center from galaxies where lower(language) = lower($1) or id::text = $1', [
    lang,
  ]);
  if (!g) throw new ApiError(404, 'galaxy_not_found', `No ${lang} galaxy in this universe`);
  const [stats] = await db.query<Record<string, number>>(
    `select count(*)::int as stars,
       count(*) filter (where (b.flags & 1) = 1)::int as claimed,
       count(*) filter (where b.state = 'protostar')::int as protostars,
       count(*) filter (where b.state = 'red_giant')::int as red_giants,
       count(*) filter (where b.state = 'white_dwarf')::int as white_dwarfs,
       count(*) filter (where (b.flags & 2) = 2)::int as pulsars,
       count(*) filter (where b.spectral_class in ('O','B'))::int as hot,
       coalesce(sum(m.c_30), 0)::int as c30,
       coalesce(sum(m.stars_total), 0)::bigint as stars_total
     from bodies b join user_metrics m using (github_id) where b.galaxy_id = $1`,
    [g.id],
  );
  const classes = await db.query<{ cls: SpectralClass; n: number }>(
    `select spectral_class as cls, count(*)::int as n from bodies where galaxy_id = $1 group by spectral_class`,
    [g.id],
  );
  const top = await leaderboard(db, `galaxy:${g.id}`, 'impact', 0);
  return { galaxy: g, stats: stats ?? {}, classes: Object.fromEntries(classes.map((c) => [c.cls, c.n])), top: top.rows };
}

const METRIC_SQL: Record<Exclude<LeaderboardMetric, 'rising' | 'signals'>, string> = {
  impact: 'b.impact',
  c_total: 'm.c_total',
  c_30: 'm.c_30',
  streak: 'm.streak_longest',
  stars: 'm.stars_total',
};

function scopeFilter(scope: string, params: unknown[]): string {
  if (scope === 'global') return '';
  const [kind, value] = scope.split(':');
  if (kind === 'galaxy' && value && /^\d+$/.test(value)) {
    params.push(Number(value));
    return `and b.galaxy_id = $${params.length}`;
  }
  if (kind === 'org' && value) {
    params.push(value);
    return `and b.github_id in (select om.github_id from org_members om join orgs o on o.github_org_id = om.org_id where o.login = $${params.length})`;
  }
  if (kind === 'country' && value && /^[A-Za-z]{2}$/.test(value)) {
    params.push(value.toUpperCase());
    return `and b.github_id in (select github_id from accounts where country = $${params.length})`;
  }
  throw new ApiError(400, 'bad_scope', 'scope must be global, galaxy:<id>, org:<login> or country:<cc>');
}

export async function leaderboard(
  db: Sql,
  scope: string,
  metric: LeaderboardMetric,
  cursor: number,
  me?: string,
): Promise<{ rows: LeaderboardRow[]; nextCursor: number | null; total: number; meRank?: number | null }> {
  const params: unknown[] = [];
  const filter = scopeFilter(scope, params);
  const value =
    metric === 'signals'
      ? '(select count(*) from signals s where s.to_id = b.github_id)'
      : metric === 'rising'
        ? `coalesce((select rh.pct_galaxy from rank_history rh where rh.github_id = b.github_id and rh.baked_at <= now() - interval '30 days'
             order by rh.baked_at desc limit 1) - b.pct_galaxy, 0) * 100`
        : METRIC_SQL[metric];
  const base = `from bodies b join user_metrics m using (github_id) join github_users u using (github_id) join galaxies g on g.id = b.galaxy_id
    left join accounts a on a.github_id = b.github_id
    where not u.is_opted_out and not coalesce((a.settings->>'hideFromLeaderboards')::boolean, false) ${filter}`;
  let offset = cursor;
  let meRank: number | null | undefined;
  if (me) {
    params.push(me);
    const [r] = await db.query<{ rank: number }>(
      `select rank from (select u.login, rank() over (order by ${value} desc, b.github_id) as rank ${base}) x where x.login = $${params.length}`,
      params,
    );
    params.pop();
    meRank = r?.rank ?? null;
    if (meRank) offset = Math.floor((meRank - 1) / PAGE) * PAGE;
  }
  const [{ total }] = (await db.query<{ total: number }>(`select count(*)::int as total ${base}`, params)) as [{ total: number }];
  const rows = await db.query<{
    github_id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
    value: number;
    temperature: number;
    spectral_class: SpectralClass;
    language: string;
  }>(
    `select b.github_id, u.login::text as login, u.name, u.avatar_url, (${value})::float8 as value, b.temperature, b.spectral_class, g.language
     ${base} order by ${value} desc, b.github_id limit ${PAGE} offset ${offset}`,
    params,
  );
  return {
    rows: rows.map((r, i) => ({
      rank: offset + i + 1,
      githubId: r.github_id,
      login: r.login,
      name: r.name,
      avatarUrl: r.avatar_url,
      value: r.value,
      temperature: r.temperature,
      spectralClass: r.spectral_class,
      galaxy: r.language,
    })),
    nextCursor: offset + PAGE < total ? offset + PAGE : null,
    total,
    ...(me ? { meRank } : {}),
  };
}

export async function feed(db: Sql, cursor: number | null, limit = 40): Promise<{ events: FeedEvent[]; nextCursor: number | null }> {
  const rows = await db.query<{
    id: number;
    type: string;
    actor_id: number | null;
    actor_login: string | null;
    actor_avatar: string | null;
    target_id: number | null;
    target_login: string | null;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    `select e.id, e.type, e.actor_id, ua.login::text as actor_login, ua.avatar_url as actor_avatar, e.target_id, ut.login::text as target_login,
       e.payload, e.created_at
     from events e left join github_users ua on ua.github_id = e.actor_id left join github_users ut on ut.github_id = e.target_id
     where e.visibility = 'public' and e.created_at > now() - interval '30 days' and ($1::bigint is null or e.id < $1)
       and coalesce(not ua.is_opted_out, true)
       and e.type in ('claimed','supernova','achievement_unlocked','gift_opened','signal_sent','repo_milestone','binary_formed','new_hypergiant','release','meteor_shower')
     order by e.id desc limit $2`,
    [cursor, limit],
  );
  return {
    events: rows.map((r) => ({
      id: r.id,
      type: r.type,
      actor: r.actor_id && r.actor_login ? { githubId: r.actor_id, login: r.actor_login, avatarUrl: r.actor_avatar } : null,
      target: r.target_id && r.target_login ? { githubId: r.target_id, login: r.target_login } : null,
      payload: r.payload,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: rows.length === limit ? rows[rows.length - 1]!.id : null,
  };
}

export async function achievementsCatalog(db: Sql) {
  const rarity = await rarityMap(db);
  const [{ holders }] = (await db.query<{ holders: number }>('select count(*)::int as holders from accounts')) as [{ holders: number }];
  return {
    claimedUsers: holders,
    achievements: ACHIEVEMENTS.filter((a) => !a.hidden).map((a) => ({
      id: a.id,
      name: a.name,
      tier: a.tier,
      description: a.description,
      stardust: a.stardust,
      rarity: rarity.get(a.id) ?? 0,
    })),
  };
}

export async function census(db: Sql) {
  const u = await getUniverse(db);
  const [totals] = await db.query<Record<string, number>>(
    `select (select count(*) from bodies)::int as stars,
       (select count(*) from accounts)::int as claimed,
       (select count(*) from galaxies)::int as galaxies,
       (select count(*) from bodies where (flags & 2) = 2)::int as pulsars,
       (select count(*) from bodies where (flags & 4) = 4)::int as hypergiants,
       (select count(*) from bindings where status = 'active')::int as binaries,
       (select count(*) from events where type = 'supernova' and created_at > now() - interval '30 days')::int as supernovas_30d,
       (select count(*) from signals where created_at > now() - interval '30 days')::int as signals_30d,
       (select coalesce(sum(c_total), 0) from user_metrics)::bigint as contributions,
       (select coalesce(sum(c_30), 0) from user_metrics)::bigint as contributions_30d,
       (select count(*) from accounts where beacon_last_at > now() - interval '2 minutes')::int as coding_now`,
  );
  const classes = await db.query<{ cls: string; n: number }>(
    'select spectral_class as cls, count(*)::int as n from bodies group by 1 order by 1',
  );
  const states = await db.query<{ state: string; n: number }>('select state, count(*)::int as n from bodies group by 1');
  const galaxies = await db.query<{ id: number; language: string; tier: string; population: number }>(
    'select id, language, tier, population from galaxies order by population desc',
  );
  const recentSupernovas = await db.query<{ login: string; payload: Record<string, unknown>; created_at: Date }>(
    `select u.login::text as login, e.payload, e.created_at from events e join github_users u on u.github_id = e.actor_id
     where e.type = 'supernova' and e.visibility = 'public' order by e.created_at desc limit 10`,
  );
  return {
    bakeVersion: u?.bakeVersion ?? null,
    bakedAt: u?.createdAt ?? null,
    totals: totals ?? {},
    classes,
    states,
    galaxies,
    recentSupernovas: recentSupernovas.map((r) => ({ login: r.login, payload: r.payload, at: r.created_at.toISOString() })),
  };
}

export async function liveCounters(db: Sql) {
  const [r] = await db.query<{ stars: number; comets: number; claimed: number }>(
    `select (select count(*) from bodies)::int as stars,
       (select count(*) from events where type in ('supernova','release','claimed') and created_at > now() - interval '1 hour')::int as comets,
       (select count(*) from accounts)::int as claimed`,
  );
  return r!;
}
