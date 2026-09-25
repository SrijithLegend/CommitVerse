/** F11 — evaluate achievements for one star; grant exactly once; Stardust + notification + (rare) feed event. */
import { ACHIEVEMENTS, type AchievementContext, emptyContext, evaluate } from '@commitverse/achievements';
import type { Db, Sql } from '@commitverse/db';
import { emitEvent, grantStardust, notify } from './social';
import { getUniverse } from './universe';

export async function syncAchievementCatalog(db: Sql): Promise<void> {
  for (const a of ACHIEVEMENTS) {
    await db.query(
      `insert into achievements (id, name, tier, description, stardust_reward, hidden) values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set name = excluded.name, tier = excluded.tier, description = excluded.description,
         stardust_reward = excluded.stardust_reward, hidden = excluded.hidden`,
      [a.id, a.name, a.tier, a.description, a.stardust, a.hidden ?? false],
    );
  }
}

export async function achievementContext(db: Sql, githubId: number): Promise<AchievementContext | null> {
  const [r] = await db.query<{
    created_at_gh: Date;
    c_total: number;
    streak_current: number;
    streak_longest: number;
    repos_public: number;
    lang_weights: Record<string, number>;
    spectral_class: string | null;
    state: string | null;
    prev_state: string | null;
    rank_global: number | null;
    pct_galaxy: number | null;
    claimed_at: Date | null;
    synthetic: boolean;
  }>(
    `select u.created_at_gh, m.c_total, m.streak_current, m.streak_longest, m.repos_public, m.lang_weights, b.spectral_class, b.state,
            m.prev_state, b.rank_global, b.pct_galaxy, a.claimed_at, u.synthetic
     from github_users u join user_metrics m using (github_id)
     left join bodies b on b.github_id = u.github_id
     left join accounts a on a.github_id = u.github_id
     where u.github_id = $1 and not u.is_opted_out`,
    [githubId],
  );
  if (!r) return null;
  const repos = await db.query<{
    stars: number;
    forks: number;
    releases_count: number;
    created_at_gh: Date | null;
    planet_slot: number | null;
  }>('select stars, forks, releases_count, created_at_gh, planet_slot from repos where owner_id = $1', [githubId]);
  const [c] = await db.query<Record<string, number | boolean>>(
    `select
       (select count(*)::int from events where type = 'supernova' and actor_id = $1) as supernovas,
       exists(select 1 from bindings where status = 'active' and (a_id = $1 or b_id = $1)) as binary,
       coalesce((select max(cnt) from (select count(*)::int as cnt from org_members om join accounts ac on ac.github_id = om.github_id
          where om.org_id in (select org_id from org_members where github_id = $1) group by om.org_id) x), 0) as max_org,
       (select count(*)::int from signals where from_id = $1) as sent,
       (select count(*)::int from signals where to_id = $1) as received,
       (select count(*)::int from gifts where from_id = $1 and state <> 'refunded') as gifts,
       (select count(*)::int from visits where github_id = $1) as visited,
       coalesce((select warps from explorer_stats where github_id = $1), 0) as warps,
       coalesce((select eyewitness from explorer_stats where github_id = $1), false) as eyewitness,
       coalesce((select comet_chased from explorer_stats where github_id = $1), false) as comet_chased,
       (select count(*)::int from referrals where referrer_id = $1 and verified_at is not null) as referrals,
       (select count(*)::int from beacon_heartbeats where github_id = $1) as beacon_minutes,
       (select count(*)::int from orders where buyer_id = $1 and status = 'paid') as purchases,
       (select count(*)::int from galaxies where tier = 'major') as majors,
       coalesce((select cardinality(array(select unnest(galaxies_visited) intersect select language from galaxies where tier = 'major'))
          from explorer_stats where github_id = $1), 0) as majors_visited`,
    [githubId],
  );
  const [hist] = await db.query<{ pct: number | null }>(
    `select pct_galaxy as pct from rank_history where github_id = $1 and baked_at <= now() - interval '30 days'
     order by baked_at desc limit 1`,
    [githubId],
  );
  const u = await getUniverse(db);
  const planets = r.synthetic ? 8 : repos.filter((x) => x.planet_slot !== null).length;
  return emptyContext({
    claimed: !!r.claimed_at,
    claimedAt: r.claimed_at?.toISOString() ?? null,
    launchDate: process.env.LAUNCH_DATE ?? '2026-10-01',
    accountAgeDays: Math.floor((Date.now() - r.created_at_gh.getTime()) / 86_400_000),
    cTotal: r.c_total,
    spectralClass: (r.spectral_class ?? 'M') as AchievementContext['spectralClass'],
    state: (r.state ?? 'main') as AchievementContext['state'],
    previousState: (r.prev_state as AchievementContext['previousState']) ?? null,
    globalImpactRank: r.rank_global,
    pctGalaxy: r.pct_galaxy,
    pctGalaxyDelta30: hist?.pct != null && r.pct_galaxy != null ? (hist.pct - r.pct_galaxy) * 100 : null,
    streakCurrent: r.streak_current,
    streakLongest: r.streak_longest,
    supernovas: Number(c!.supernovas),
    repos: repos.map((x) => ({
      stars: x.stars,
      forks: x.forks,
      releases: x.releases_count,
      createdAt: x.created_at_gh?.toISOString() ?? null,
    })),
    planets: Math.min(8, planets),
    reposPublic: r.repos_public,
    langWeights: r.lang_weights,
    binary: !!c!.binary,
    maxOrgClaimedMembers: Number(c!.max_org),
    signalsSent: Number(c!.sent),
    signalsReceived: Number(c!.received),
    giftsSent: Number(c!.gifts),
    systemsVisited: Number(c!.visited),
    majorGalaxiesVisited: Number(c!.majors_visited),
    majorGalaxiesTotal: Number(c!.majors) || (u?.galaxies.filter((g) => g.tier === 'major').length ?? 12),
    warps: Number(c!.warps),
    eyewitness: !!c!.eyewitness,
    cometChased: !!c!.comet_chased,
    verifiedReferrals: Number(c!.referrals),
    beaconHours: Number(c!.beacon_minutes) / 60,
    premiumPurchases: Number(c!.purchases),
    now: new Date().toISOString(),
  });
}

/** Rarity = % of claimed users who have it (§F11). */
export async function rarityMap(db: Sql): Promise<Map<string, number>> {
  const rows = await db.query<{ id: string; pct: number }>(
    `select a.id, coalesce(100.0 * count(ua.github_id) filter (where ac.github_id is not null) / nullif((select count(*) from accounts), 0), 0)::float8 as pct
     from achievements a left join user_achievements ua on ua.achievement_id = a.id
     left join accounts ac on ac.github_id = ua.github_id group by a.id`,
  );
  return new Map(rows.map((r) => [r.id, r.pct]));
}

export async function runAchievements(db: Db, githubId: number): Promise<string[]> {
  const ctx = await achievementContext(db, githubId);
  if (!ctx) return [];
  const have = new Set(
    (await db.query<{ achievement_id: string }>('select achievement_id from user_achievements where github_id = $1', [githubId])).map(
      (r) => r.achievement_id,
    ),
  );
  const earned = evaluate(ctx, have);
  const granted: string[] = [];
  for (const a of earned) {
    const ins = await db.query(
      'insert into user_achievements (github_id, achievement_id) values ($1, $2) on conflict do nothing returning achievement_id',
      [githubId, a.id],
    );
    if (!ins.length) continue; // concurrent grant — exactly once
    granted.push(a.id);
    if (ctx.claimed) {
      await grantStardust(db, githubId, a.stardust, 'achievement', a.id);
      await notify(db, githubId, 'achievement', { id: a.id, name: a.name, tier: a.tier, stardust: a.stardust });
    }
    if (a.tier === 'gold' || a.tier === 'cosmic')
      await emitEvent(db, { type: 'achievement_unlocked', actorId: githubId, payload: { id: a.id, name: a.name, tier: a.tier } });
    if (a.id === 'hypergiant') await emitEvent(db, { type: 'new_hypergiant', actorId: githubId, payload: {} });
  }
  // Referral cosmetics (Recruiter corona line) are granted with the matching achievements.
  for (const id of granted.filter((x) => x.startsWith('recruiter_'))) {
    await db.query(
      `insert into inventory (owner_id, item_id, source) select $1, $2, 'achievement'
       where exists (select 1 from items where id = $2) on conflict do nothing`,
      [githubId, `corona.${id}`],
    );
  }
  return granted;
}

/** On claim: retroactively pay Stardust for achievements unlocked before the star was claimed. */
export async function backfillAchievementStardust(db: Sql, githubId: number): Promise<void> {
  const rows = await db.query<{ achievement_id: string; stardust_reward: number }>(
    `select ua.achievement_id, a.stardust_reward from user_achievements ua join achievements a on a.id = ua.achievement_id where ua.github_id = $1`,
    [githubId],
  );
  for (const r of rows) await grantStardust(db, githubId, r.stardust_reward, 'achievement', r.achievement_id);
}
