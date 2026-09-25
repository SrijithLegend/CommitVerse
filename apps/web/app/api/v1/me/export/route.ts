/** §11.4 — export everything stored about the signed-in user. */
import { json, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';

const TABLES: [string, string][] = [
  [
    'github_user',
    'select github_id, login, name, avatar_url, bio, created_at_gh, first_seen_at, last_fetched_at, refresh_tier from github_users where github_id = $1',
  ],
  ['metrics', 'select * from user_metrics where github_id = $1'],
  ['body', 'select * from bodies where github_id = $1'],
  ['rank_history', 'select * from rank_history where github_id = $1'],
  ['repos', 'select * from repos where owner_id = $1'],
  ['orgs', 'select o.login, o.name from org_members m join orgs o on o.github_org_id = m.org_id where m.github_id = $1'],
  [
    'account',
    'select role, claimed_at, referral_code, bio_override, pinned_override, country, settings, stardust_balance, (sync_token_enc is not null) as sync_token_stored from accounts where github_id = $1',
  ],
  ['stardust_ledger', 'select delta, reason, ref_id, created_at from stardust_ledger where github_id = $1 order by id'],
  ['inventory', 'select item_id, source, acquired_at, revoked_at from inventory where owner_id = $1'],
  ['equipped', 'select slot, inventory_id from equipped where github_id = $1'],
  [
    'orders',
    'select id, item_id, recipient_id, provider, status, amount_minor, currency, created_at, paid_at, refunded_at from orders where buyer_id = $1',
  ],
  ['signals_sent', 'select to_id, message, created_at from signals where from_id = $1'],
  ['signals_received', 'select from_id, message, created_at from signals where to_id = $1'],
  ['gifts', 'select id, from_id, to_id, anonymous, state, expires_at from gifts where from_id = $1 or to_id = $1'],
  ['bindings', 'select a_id, b_id, status, created_at from bindings where a_id = $1 or b_id = $1'],
  ['achievements', 'select achievement_id, unlocked_at from user_achievements where github_id = $1'],
  ['notifications', 'select type, payload, read_at, created_at from notifications where recipient_id = $1'],
  ['explorer_stats', 'select * from explorer_stats where github_id = $1'],
  [
    'referrals',
    'select referee_id, referrer_id, clicked_at, claimed_at, verified_at from referrals where referee_id = $1 or referrer_id = $1',
  ],
  ['banner', 'select text, status, created_at from banners where github_id = $1'],
  ['beacon_tokens', 'select id, created_at, revoked_at from beacon_tokens where github_id = $1'],
  ['events', `select type, target_id, payload, visibility, created_at from events where actor_id = $1 order by created_at desc limit 5000`],
];

export const GET = route({ auth: 'user', limits: [{ name: 'export', max: 5, windowS: 3600, by: 'user' }] }, async ({ session }) => {
  const d = await db();
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), githubId: session!.githubId };
  for (const [key, sql] of TABLES) out[key] = await d.query(sql, [session!.githubId]);
  return json(out, { headers: { 'content-disposition': `attachment; filename="commitverse-${session!.login}.json"` } });
});
