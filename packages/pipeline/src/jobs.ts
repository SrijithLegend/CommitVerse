/** §8.2 job handlers + wiring. Every handler is idempotent (keyed by github_id + purpose + time bucket). */

import { CATALOG } from '@commitverse/contracts';
import type { Db } from '@commitverse/db';
import { backfillAchievementStardust, runAchievements, syncAchievementCatalog } from './achievements-job';
import { ingestArchiveHour } from './archive';
import { runBake } from './bake';
import { handleGitHubWebhook, pollEvents } from './comets';
import { buildDelta } from './delta';
import { budget, budgetFraction, GitHubError, graphql, hasGitHubCredentials } from './github';
import { ingestUser } from './ingest';
import { log } from './log';
import type { JobQueue } from './queue';
import { broadcast } from './realtime';
import { emitEvent, notify } from './social';
import { buildStarFetchQuery, PROBE_QUERY, type ProbeResult, parseStarFetch, type RawStarFetch } from './starfetch';
import { decryptToken } from './tokens';
import { getUniverse, setState } from './universe';

const MATERIALIZE_BUDGET_FLOOR = 0.15;

async function setJob(db: Db, jobId: string, status: string, extra: { error?: string; githubId?: number } = {}) {
  await db.query(
    'update materialize_jobs set status = $2, error = $3, github_id = coalesce($4, github_id), updated_at = now() where id = $1',
    [jobId, status, extra.error ?? null, extra.githubId ?? null],
  );
  void broadcast(`job:${jobId}`, 'status', { jobId, status, ...extra });
}

/** Fetch one user with the app token or their own delegated token. Returns null if not a GitHub *user*. */
export async function fetchUser(db: Db, login: string, token?: string) {
  const probe = await graphql<ProbeResult>(PROBE_QUERY, { login }, { token, shape: 'probe', db });
  const owner = probe.repositoryOwner;
  if (!owner) return { kind: 'not_found' as const };
  if (owner.__typename === 'Organization') return { kind: 'organization' as const, login: owner.login };
  if (owner.login.toLowerCase().endsWith('[bot]')) return { kind: 'bot' as const };
  const [tomb] = await db.query('select 1 from github_users where github_id = $1 and is_opted_out', [owner.databaseId]);
  if (tomb) return { kind: 'opted_out' as const };
  const raw = await graphql<RawStarFetch>(buildStarFetchQuery(owner.createdAt!), { login }, { token, shape: 'star_fetch', db });
  const fetched = parseStarFetch(raw);
  if (!fetched) return { kind: 'not_found' as const };
  return { kind: 'user' as const, fetched };
}

export async function materialize(db: Db, queue: JobQueue, data: { jobId: string; login: string }): Promise<void> {
  const { jobId, login } = data;
  if (budgetFraction() < MATERIALIZE_BUDGET_FLOOR) {
    // Budget guard: pause (stay queued) until the window resets.
    const waitS = Math.max(30, Math.ceil((Date.parse(budget.resetAt) - Date.now()) / 1000));
    await queue.send('materialize', data, {
      startAfterSeconds: Math.min(waitS, 900),
      singletonKey: `m:${login.toLowerCase()}:${Date.now()}`,
    });
    return;
  }
  await setJob(db, jobId, 'fetching');
  try {
    const r = await fetchUser(db, login);
    if (r.kind !== 'user') {
      await setJob(db, jobId, 'failed', { error: r.kind });
      return;
    }
    await setJob(db, jobId, 'placing', { githubId: r.fetched.githubId });
    const res = await ingestUser(db, r.fetched);
    if (!res.placed && !(await getUniverse(db, true))) {
      await runBake(db, { triggeredBy: 'bootstrap' });
    }
    await setJob(db, jobId, 'born', { githubId: r.fetched.githubId });
    await queue.send('achievements', { githubId: r.fetched.githubId }, { singletonKey: `ach:${r.fetched.githubId}` });
    await queue.send('delta', {}, { singletonKey: 'delta', startAfterSeconds: 3 });
  } catch (err) {
    const msg = err instanceof GitHubError ? err.kind : err instanceof Error ? err.message : String(err);
    await setJob(db, jobId, 'failed', { error: msg });
    throw err;
  }
}

export async function refresh(db: Db, queue: JobQueue, data: { githubId: number }): Promise<void> {
  const [u] = await db.query<{
    login: string;
    synthetic: boolean;
    is_opted_out: boolean;
    sync_token_enc: Uint8Array | null;
    sync_token_nonce: Uint8Array | null;
    sync_token_kid: string | null;
  }>(
    `select g.login::text as login, g.synthetic, g.is_opted_out, a.sync_token_enc, a.sync_token_nonce, a.sync_token_kid
     from github_users g left join accounts a using (github_id) where g.github_id = $1`,
    [data.githubId],
  );
  if (!u || u.synthetic || u.is_opted_out) return;
  let token: string | undefined;
  if (u.sync_token_enc && u.sync_token_nonce && u.sync_token_kid) {
    try {
      token = decryptToken(u.sync_token_enc, u.sync_token_nonce, u.sync_token_kid);
    } catch {
      token = undefined;
    }
  }
  try {
    const r = await fetchUser(db, u.login, token);
    if (r.kind !== 'user') {
      await db.query(`update github_users set fetch_error = $2, next_refresh_at = now() + interval '1 day' where github_id = $1`, [
        data.githubId,
        r.kind,
      ]);
      return;
    }
    await ingestUser(db, r.fetched);
    await queue.send('achievements', { githubId: data.githubId }, { singletonKey: `ach:${data.githubId}` });
  } catch (err) {
    if (err instanceof GitHubError && err.kind === 'unauthorized' && token) {
      // §11.2: a rejected sync token is deleted; the user is told and falls back to tier T1.
      await db.query('update accounts set sync_token_enc = null, sync_token_nonce = null, sync_token_kid = null where github_id = $1', [
        data.githubId,
      ]);
      await notify(db, data.githubId, 'sync_token_revoked', {});
      await queue.send('refresh', data, { singletonKey: `r:${data.githubId}:retry` });
      return;
    }
    throw err;
  }
}

/** Every minute: enqueue due refreshes within the budget (keep a 10% reserve) and due event polls. */
export async function scheduler(db: Db, queue: JobQueue): Promise<void> {
  if (!hasGitHubCredentials()) return;
  const reserve = 0.1 * budget.limit;
  const cap = Math.max(0, Math.min(200, Math.floor((budget.remaining - reserve) / 4 / 30)));
  if (cap > 0) {
    const due = await db.query<{ github_id: number; refresh_tier: number }>(
      `select github_id, refresh_tier from github_users where next_refresh_at <= now() and not is_opted_out and not synthetic
       order by refresh_tier, next_refresh_at limit $1`,
      [cap],
    );
    const bucket = Math.floor(Date.now() / 600_000);
    for (const u of due)
      await queue.send(
        'refresh',
        { githubId: u.github_id },
        { priority: 80 - u.refresh_tier * 15, singletonKey: `r:${u.github_id}:${bucket}` },
      );
  }
  const polls = await db.query<{ github_id: number }>(
    `select a.github_id from accounts a join github_users g using (github_id)
     left join poll_state p using (github_id)
     where not g.is_opted_out and a.banned_at is null and coalesce(p.next_poll_at, now()) <= now() limit 500`,
  );
  const minute = Math.floor(Date.now() / 60_000);
  for (const p of polls) await queue.send('events-poll', { githubId: p.github_id }, { singletonKey: `p:${p.github_id}:${minute}` });
  await setState(db, 'github_budget', budget);
}

export async function syncItems(db: Db): Promise<void> {
  for (const i of CATALOG) {
    await db.query(
      `insert into items (id, slot, name, description, rarity, track, price_stardust, price_minor, available_from, available_until, max_supply, render_config)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (id) do update set slot = excluded.slot, name = excluded.name, description = excluded.description, rarity = excluded.rarity,
         track = excluded.track, price_stardust = excluded.price_stardust, price_minor = excluded.price_minor,
         available_from = excluded.available_from, available_until = excluded.available_until, max_supply = excluded.max_supply,
         render_config = excluded.render_config`,
      [
        i.id,
        i.slot,
        i.name,
        i.description,
        i.rarity,
        i.track,
        i.priceStardust,
        i.priceMinor ? JSON.stringify(i.priceMinor) : null,
        i.availableFrom ?? null,
        i.availableUntil ?? null,
        i.maxSupply ?? null,
        JSON.stringify(i.renderConfig),
      ],
    );
  }
}

/** Daily housekeeping: partitions, gift expiry, opt-out purge, ledger reconciliation. */
export async function maintenance(db: Db, refundGift?: (orderId: string) => Promise<void>): Promise<void> {
  await db.query('select ensure_event_partitions(2)');
  const old = await db.query<{ relname: string }>(
    `select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid
     where i.inhparent = 'events'::regclass and c.relname ~ '^events_[0-9]{6}$'
       and to_date(substr(c.relname, 8), 'YYYYMM') < date_trunc('month', now()) - interval '12 months'`,
  );
  for (const p of old) await db.query(`drop table if exists ${p.relname.replace(/[^a-z0-9_]/g, '')}`);

  // Gifts held for unclaimed users expire after 90 days → auto-refund.
  const expired = await db.query<{ id: string; order_id: string }>(
    `update gifts set state = 'expired' where state = 'pending' and expires_at < now() returning id, order_id`,
  );
  for (const g of expired)
    await refundGift?.(g.order_id).catch((e) => log.error({ err: String(e), order: g.order_id }, 'gift refund failed'));

  // §11.4: opted-out stars — delete metrics, repos, bodies, social data and inventory within 24 h; keep the tombstone.
  const purge = await db.query<{ github_id: number }>(
    `select github_id from github_users where is_opted_out and (name is not null or avatar_url is not null or bio is not null
       or exists (select 1 from user_metrics m where m.github_id = github_users.github_id))`,
  );
  for (const { github_id } of purge) await purgeUserData(db, github_id);

  // Ledger reconciliation: materialized balance must equal the ledger sum.
  const mismatches = await db.query<{ github_id: number; balance: number; ledger: number }>(
    `select a.github_id, a.stardust_balance as balance, coalesce(sum(l.delta), 0)::int as ledger
     from accounts a left join stardust_ledger l using (github_id) group by a.github_id, a.stardust_balance
     having a.stardust_balance <> coalesce(sum(l.delta), 0)`,
  );
  if (mismatches.length) {
    log.error({ alert: 'ledger_mismatch', count: mismatches.length, sample: mismatches.slice(0, 5) }, 'stardust ledger mismatch');
    await emitEvent(db, { type: 'ledger_mismatch', payload: { count: mismatches.length }, visibility: 'private' });
  }
  await db.query(`delete from materialize_jobs where updated_at < now() - interval '7 days'`);
  await db.query(`delete from beacon_heartbeats where minute < now() - interval '60 days'`);
  await db.query(`delete from beacon_device_codes where expires_at < now()`);
  await db.query(`delete from github_cost_log where created_at < now() - interval '30 days'`);
}

export async function purgeUserData(db: Db, githubId: number): Promise<void> {
  await db.tx(async (q) => {
    await q.query('delete from user_metrics where github_id = $1', [githubId]);
    await q.query('delete from repos where owner_id = $1', [githubId]);
    await q.query('delete from rank_history where github_id = $1', [githubId]);
    await q.query('delete from bodies where github_id = $1', [githubId]);
    await q.query('delete from org_members where github_id = $1', [githubId]);
    await q.query('delete from signals where from_id = $1 or to_id = $1', [githubId]);
    await q.query('delete from equipped where github_id = $1', [githubId]);
    await q.query('update inventory set revoked_at = now() where owner_id = $1 and revoked_at is null', [githubId]);
    await q.query(`update bindings set status = 'dissolved' where (a_id = $1 or b_id = $1) and status in ('pending','active')`, [githubId]);
    await q.query('delete from notifications where recipient_id = $1', [githubId]);
    await q.query('delete from visits where github_id = $1', [githubId]);
    await q.query('delete from explorer_stats where github_id = $1', [githubId]);
    await q.query('delete from banners where github_id = $1', [githubId]);
    await q.query('delete from poll_state where github_id = $1', [githubId]);
    await q.query('delete from archive_daily where github_id = $1', [githubId]);
    await q.query('delete from beacon_tokens where github_id = $1', [githubId]);
    await q.query(`update github_users set name = null, avatar_url = null, bio = null where github_id = $1`, [githubId]);
  });
}

export interface WorkerDeps {
  refundGift?: (orderId: string) => Promise<void>;
  sendEmail?: (to: string, subject: string, html: string) => Promise<void>;
}

/** Registers all handlers + schedules on a queue. Used by apps/worker (pg-boss) and local mode (in-process). */
export async function registerWorkers(db: Db, queue: JobQueue, deps: WorkerDeps = {}): Promise<void> {
  await syncAchievementCatalog(db);
  await syncItems(db);
  await queue.work('materialize', (d) => materialize(db, queue, d as { jobId: string; login: string }));
  await queue.work('refresh', (d) => refresh(db, queue, d as { githubId: number }));
  await queue.work('events-poll', async (d) => {
    await pollEvents(db, Number(d.githubId));
  });
  await queue.work('webhook', (d) => handleGitHubWebhook(db, String(d.event), d.payload as Record<string, unknown>));
  await queue.work('archive-ingest', async (d) => {
    const hour = d.hour ? new Date(String(d.hour)) : new Date(Date.now() - 2 * 3_600_000);
    await ingestArchiveHour(db, hour);
  });
  await queue.work('delta', async () => {
    await buildDelta(db);
  });
  await queue.work('bake', async (d) => {
    await runBake(db, { triggeredBy: String(d.triggeredBy ?? 'schedule') });
    await buildDelta(db);
  });
  await queue.work('achievements', async (d) => {
    await runAchievements(db, Number(d.githubId));
  });
  await queue.work('notify', async (d) => {
    if (d.kind === 'claimed') await backfillAchievementStardust(db, Number(d.githubId));
    if (d.email && deps.sendEmail) await deps.sendEmail(String(d.email), String(d.subject), String(d.html));
  });
  await queue.work('scheduler', () => scheduler(db, queue));
  await queue.work('maintenance', () => maintenance(db, deps.refundGift));

  await queue.schedule('scheduler', '* * * * *');
  await queue.schedule('delta', '*/5 * * * *');
  await queue.schedule('bake', process.env.BAKE_CRON ?? '0 2 * * *', { triggeredBy: 'schedule' });
  await queue.schedule('maintenance', '30 3 * * *');
  if (process.env.ARCHIVE_INGEST !== 'off' && !process.env.LOCAL_SKIP_ARCHIVE) await queue.schedule('archive-ingest', '15 * * * *');
  await emitEvent(db, { type: 'worker_started', visibility: 'private', payload: {} }).catch(() => {});
}
