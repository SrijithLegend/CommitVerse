import { PatchMe } from '@commitverse/contracts';
import { broadcast, getState, setState } from '@commitverse/pipeline';
import { cookies } from 'next/headers';
import { body, route } from '@/lib/server/api';
import { db, queue } from '@/lib/server/app';
import { DEV_COOKIE, supabaseConfigured, supabaseServer } from '@/lib/server/auth';
import { ApiError } from '@/lib/server/errors';
import { cleanUserText } from '@/lib/server/moderation';

export const GET = route({ auth: 'user', limits: [{ name: 'me', max: 60, windowS: 60, by: 'user' }] }, async ({ session }) => {
  const d = await db();
  const s = session!;
  const [acct] = await d.query<{
    role: string;
    claimed_at: Date;
    referral_code: string;
    bio_override: string | null;
    pinned_override: number[] | null;
    country: string | null;
    settings: Record<string, unknown>;
    stardust_balance: number;
    onboarding_done: boolean;
    sync: boolean;
  }>(
    `select role, claimed_at, referral_code, bio_override, pinned_override, country, settings, stardust_balance, onboarding_done,
       (sync_token_enc is not null) as sync from accounts where github_id = $1`,
    [s.githubId],
  );
  const [inventory, equipped, gifts, bindings, unread, banner, checkin] = await Promise.all([
    d.query<{ id: string; item_id: string; slot: string; name: string; rarity: string; source: string; acquired_at: Date }>(
      `select v.id, v.item_id, i.slot, i.name, i.rarity, v.source, v.acquired_at from inventory v join items i on i.id = v.item_id
       where v.owner_id = $1 and v.revoked_at is null order by v.acquired_at desc`,
      [s.githubId],
    ),
    d.query<{ slot: string; inventory_id: string; item_id: string }>(
      `select e.slot, e.inventory_id, v.item_id from equipped e join inventory v on v.id = e.inventory_id where e.github_id = $1`,
      [s.githubId],
    ),
    d.query<{ id: string; item_id: string; from_login: string | null; anonymous: boolean; state: string; expires_at: Date }>(
      `select g.id, o.item_id, case when g.anonymous then null else u.login::text end as from_login, g.anonymous, g.state, g.expires_at
       from gifts g join orders o on o.id = g.order_id join github_users u on u.github_id = g.from_id
       where g.to_id = $1 and g.state in ('delivered','pending') and o.status = 'paid'`,
      [s.githubId],
    ),
    d.query<{ id: string; status: string; other: string; requested_by_me: boolean }>(
      `select b.id, b.status, u.login::text as other, (b.requested_by = $1) as requested_by_me from bindings b
       join github_users u on u.github_id = case when b.a_id = $1 then b.b_id else b.a_id end
       where (b.a_id = $1 or b.b_id = $1) and b.status in ('pending','active')`,
      [s.githubId],
    ),
    d.query<{ n: number }>('select count(*)::int as n from notifications where recipient_id = $1 and read_at is null', [s.githubId]),
    d.query<{ text: string; status: string }>('select text, status from banners where github_id = $1', [s.githubId]),
    d.query<{ last_checkin_on: string | null; checkin_streak: number }>(
      'select last_checkin_on, checkin_streak from explorer_stats where github_id = $1',
      [s.githubId],
    ),
  ]);
  return {
    githubId: s.githubId,
    login: s.login,
    claimed: s.claimed,
    isAdmin: s.isAdmin,
    account: acct
      ? {
          role: acct.role,
          claimedAt: acct.claimed_at.toISOString(),
          referralCode: acct.referral_code,
          bioOverride: acct.bio_override,
          pinnedOverride: acct.pinned_override,
          country: acct.country,
          settings: acct.settings,
          stardust: acct.stardust_balance,
          onboardingDone: acct.onboarding_done,
          syncEnabled: acct.sync,
        }
      : null,
    inventory: inventory.map((i) => ({
      id: i.id,
      itemId: i.item_id,
      slot: i.slot,
      name: i.name,
      rarity: i.rarity,
      source: i.source,
      acquiredAt: i.acquired_at.toISOString(),
    })),
    equipped: Object.fromEntries(equipped.map((e) => [e.slot, { inventoryId: e.inventory_id, itemId: e.item_id }])),
    gifts: gifts.map((g) => ({
      id: g.id,
      itemId: g.item_id,
      from: g.from_login,
      anonymous: g.anonymous,
      state: g.state,
      expiresAt: g.expires_at.toISOString(),
    })),
    bindings: bindings.map((b) => ({ id: b.id, status: b.status, other: b.other, requestedByMe: b.requested_by_me })),
    unreadNotifications: unread[0]?.n ?? 0,
    banner: banner[0] ?? null,
    checkin: { lastOn: checkin[0]?.last_checkin_on ?? null, streak: checkin[0]?.checkin_streak ?? 0 },
  };
});

export const PATCH = route(
  { auth: 'claimed', limits: [{ name: 'me-patch', max: 20, windowS: 60, by: 'user' }] },
  async ({ req, session }) => {
    const p = await body(req, PatchMe);
    const d = await db();
    const s = session!;
    if (p.bioOverride !== undefined) {
      let bio: string | null = null;
      if (p.bioOverride) {
        const c = cleanUserText(p.bioOverride, 160);
        if (c.flagged) throw new ApiError(422, 'bio_rejected', 'That bio didn’t pass moderation');
        bio = c.text || null;
      }
      await d.query('update accounts set bio_override = $2 where github_id = $1', [s.githubId, bio]);
    }
    if (p.pinnedOverride !== undefined) {
      const ids = p.pinnedOverride ?? [];
      if (ids.length) {
        const owned = await d.query<{ github_repo_id: number }>(
          'select github_repo_id from repos where owner_id = $1 and github_repo_id = any($2::bigint[])',
          [s.githubId, ids],
        );
        if (owned.length !== new Set(ids).size) throw new ApiError(400, 'not_your_repos', 'Pinned planets must be your own public repos');
      }
      await d.tx(async (q) => {
        await q.query('update accounts set pinned_override = $2 where github_id = $1', [s.githubId, ids.length ? ids : null]);
        await q.query('update repos set planet_slot = null where owner_id = $1', [s.githubId]);
        if (ids.length) {
          for (let i = 0; i < ids.length; i++)
            await q.query('update repos set planet_slot = $3 where owner_id = $1 and github_repo_id = $2', [s.githubId, ids[i], i]);
        } else {
          await q.query(
            `update repos r set planet_slot = x.slot from (select github_repo_id, (row_number() over (order by stars desc, pushed_at desc nulls last, github_repo_id) - 1)::smallint as slot
             from repos where owner_id = $1) x where r.github_repo_id = x.github_repo_id and x.slot < 8`,
            [s.githubId],
          );
        }
      });
    }
    if (p.country !== undefined) await d.query('update accounts set country = $2 where github_id = $1', [s.githubId, p.country]);
    if (p.settings) {
      await d.query('update accounts set settings = settings || $2::jsonb where github_id = $1', [s.githubId, JSON.stringify(p.settings)]);
      if ('hideBeacon' in p.settings) await (await queue()).send('delta', {}, { singletonKey: 'delta', startAfterSeconds: 2 });
    }
    return { ok: true };
  },
);

/** §11.4 — Remove my star. Immediate hide (delta + live broadcast); data purged within 24 h; tombstone blocks re-materialization. */
export const DELETE = route({ auth: 'user', limits: [{ name: 'me-delete', max: 3, windowS: 86_400, by: 'user' }] }, async ({ session }) => {
  const d = await db();
  const s = session!;
  const [b] = await d.query<{ star_index: number }>('select star_index from bodies where github_id = $1', [s.githubId]);
  await d.tx(async (q) => {
    await q.query('update github_users set is_opted_out = true where github_id = $1', [s.githubId]);
    await q.query('delete from equipped where github_id = $1', [s.githubId]);
    await q.query('update accounts set sync_token_enc = null, sync_token_nonce = null, sync_token_kid = null where github_id = $1', [
      s.githubId,
    ]);
  });
  if (b) {
    const hidden = (await getState<number[]>(d, 'hidden_indices')) ?? [];
    await setState(d, 'hidden_indices', [...new Set([...hidden, b.star_index])]);
    void broadcast('cosmic:global', 'hide', { starIndex: b.star_index, githubId: s.githubId });
  }
  await d.query('delete from bodies where github_id = $1', [s.githubId]);
  await d.query('delete from accounts where github_id = $1', [s.githubId]);
  await (await queue()).send('delta', {}, { singletonKey: 'delta' });
  await (await queue()).send('maintenance', {}, { singletonKey: `purge:${s.githubId}`, startAfterSeconds: 60 });
  if (supabaseConfigured()) await (await supabaseServer()).auth.signOut();
  (await cookies()).delete(DEV_COOKIE);
  return { removed: true };
});
