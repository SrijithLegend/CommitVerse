/** F5 claim + F9 referral attribution. */
import 'server-only';
import type { Db } from '@commitverse/db';
import type { JobQueue } from '@commitverse/pipeline';
import {
  canEncryptTokens,
  emitEvent,
  encryptToken,
  fetchUser,
  getUniverse,
  grantStardust,
  hasGitHubCredentials,
  ingestUser,
  log,
  nanoid,
  notify,
  starInput,
  upsertBody,
} from '@commitverse/pipeline';
import { ApiError } from './errors';

export interface ClaimInput {
  authUserId: string;
  githubId: number;
  login: string;
  avatarUrl?: string | null;
  providerToken?: string | null;
  sync?: boolean;
  refCookie?: string | null;
}

/** Recompute a star's flags (claimed / binary / beacon) and push it into the delta layer. */
export async function refreshBodyFlags(db: Db, githubId: number): Promise<void> {
  const [m] = await db.query<{
    c_total: number;
    c_30: number;
    c_90: number;
    stars_total: number;
    followers: number;
    streak_current: number;
    last_active_on: string | null;
    primary_language: string | null;
    created_at_gh: Date;
  }>(
    `select m.c_total, m.c_30, m.c_90, m.stars_total, m.followers, m.streak_current, m.last_active_on, m.primary_language, u.created_at_gh
     from user_metrics m join github_users u using (github_id) where m.github_id = $1`,
    [githubId],
  );
  if (!m) return;
  await upsertBody(
    db,
    githubId,
    { primaryLanguage: m.primary_language ?? 'Void', input: starInput(m, m.created_at_gh) },
    await getUniverse(db),
  );
  await db.query('update bodies set delta_at = now() where github_id = $1', [githubId]);
}

export async function claimStar(db: Db, queue: JobQueue, c: ClaimInput): Promise<{ firstClaim: boolean }> {
  // The star must exist; fetch it now if we can, otherwise create a minimal mirror row and materialize later.
  const [exists] = await db.query<{ is_opted_out: boolean }>('select is_opted_out from github_users where github_id = $1', [c.githubId]);
  if (exists?.is_opted_out) throw new ApiError(410, 'removed', 'This star was removed. Contact support to restore it.');
  if (!exists) {
    let ingested = false;
    if (hasGitHubCredentials()) {
      try {
        const r = await fetchUser(db, c.login, c.providerToken ?? undefined);
        if (r.kind === 'user') {
          await ingestUser(db, r.fetched);
          ingested = true;
        }
      } catch (err) {
        log.warn({ err: String(err), login: c.login }, 'claim: inline fetch failed; queuing');
      }
    }
    if (!ingested) {
      await db.query(
        `insert into github_users (github_id, login, avatar_url, created_at_gh) values ($1, $2, $3, now()) on conflict do nothing`,
        [c.githubId, c.login, c.avatarUrl ?? null],
      );
      const [job] = await db.query<{ id: string }>(
        `insert into materialize_jobs (login, priority) values ($1, 100) on conflict do nothing returning id`,
        [c.login],
      );
      if (job) await queue.send('materialize', { jobId: job.id, login: c.login }, { priority: 100 });
    }
  }

  const inserted = await db.query(
    `insert into accounts (auth_user_id, github_id, referral_code) values ($1, $2, $3)
     on conflict (auth_user_id) do nothing returning github_id`,
    [c.authUserId, c.githubId, nanoid(8)],
  );
  const firstClaim = inserted.length > 0;
  if (!firstClaim) {
    const [mine] = await db.query('select 1 from accounts where auth_user_id = $1 and github_id = $2', [c.authUserId, c.githubId]);
    if (!mine) throw new ApiError(409, 'already_claimed', 'This star is already claimed by another account');
  }

  if (c.sync && c.providerToken && canEncryptTokens()) {
    const t = encryptToken(c.providerToken);
    await db.query('update accounts set sync_token_enc = $2, sync_token_nonce = $3, sync_token_kid = $4 where github_id = $1', [
      c.githubId,
      t.ciphertext,
      t.nonce,
      t.kid,
    ]);
  }

  if (firstClaim) {
    await db.query(`update github_users set refresh_tier = 1, next_refresh_at = now() where github_id = $1`, [c.githubId]);
    await attributeReferral(db, queue, c.githubId, c.refCookie ?? null);
    // Gifts bought for this star while it was unclaimed become openable now (F8).
    await db.query(
      `update gifts g set state = 'delivered' from orders o where o.id = g.order_id and o.status = 'paid' and g.to_id = $1 and g.state = 'pending'`,
      [c.githubId],
    );
    await emitEvent(db, { type: 'claimed', actorId: c.githubId, payload: {} });
    await notify(db, c.githubId, 'claimed', { message: 'Your star ignited. Welcome to the universe.' });
    await refreshBodyFlags(db, c.githubId);
    await queue.send('refresh', { githubId: c.githubId }, { priority: 80, singletonKey: `r:${c.githubId}:claim` });
    await queue.send('notify', { kind: 'claimed', githubId: c.githubId });
    await queue.send('achievements', { githubId: c.githubId }, { singletonKey: `ach:${c.githubId}:claim` });
    await queue.send('delta', {}, { singletonKey: 'delta', startAfterSeconds: 2 });
  }
  return { firstClaim };
}

/** F9: first-touch cookie (30 days). Reward only verified referees: claimed + account ≥ 30 days + c_total ≥ 10 + not claimed before the click. */
async function attributeReferral(db: Db, queue: JobQueue, refereeId: number, cookie: string | null): Promise<void> {
  if (!cookie) return;
  const [code, ts] = cookie.split('|');
  const clickedAt = new Date(Number(ts));
  if (!code || Number.isNaN(clickedAt.getTime()) || Date.now() - clickedAt.getTime() > 30 * 86_400_000) return;
  const [ref] = await db.query<{ github_id: number }>('select github_id from accounts where referral_code = $1', [code]);
  if (!ref || ref.github_id === refereeId) return;
  await db.query(
    `insert into referrals (referee_id, referrer_id, clicked_at, claimed_at) values ($1, $2, $3, now()) on conflict (referee_id) do nothing`,
    [refereeId, ref.github_id, clickedAt],
  );
  const [ok] = await db.query<{ verified: boolean }>(
    `select (u.created_at_gh < now() - interval '30 days' and coalesce(m.c_total, 0) >= 10) as verified
     from github_users u left join user_metrics m using (github_id) where u.github_id = $1`,
    [refereeId],
  );
  if (!ok?.verified) return;
  const upd = await db.query(
    `update referrals set verified_at = now(), rewarded = true where referee_id = $1 and referrer_id = $2 and not rewarded returning referrer_id`,
    [refereeId, ref.github_id],
  );
  if (!upd.length) return;
  await grantStardust(db, ref.github_id, 100, 'referral', String(refereeId));
  await notify(db, ref.github_id, 'referral_verified', { refereeId });
  await queue.send('achievements', { githubId: ref.github_id }, { singletonKey: `ach:${ref.github_id}:ref:${refereeId}` });
  const [{ n }] = (await db.query<{ n: number }>(
    `select count(*)::int as n from referrals where referrer_id = $1 and verified_at > now() - interval '1 day'`,
    [ref.github_id],
  )) as [{ n: number }];
  if (n > 20) log.warn({ alert: 'referral_anomaly', referrer: ref.github_id, verifiedToday: n }, 'referral farming suspected');
}
