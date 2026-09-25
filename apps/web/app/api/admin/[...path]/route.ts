/**
 * F20 — admin API. Allow-list (ADMIN_GITHUB_LOGINS) AND db role, both required; 8-hour sessions; every write audited.
 */
import { CATALOG_BY_ID } from '@commitverse/contracts';
import type { Sql } from '@commitverse/db';
import { broadcast, emitEvent, getState, notify, rollbackTo, setState } from '@commitverse/pipeline';
import { z } from 'zod';
import { body, type Ctx, route } from '@/lib/server/api';
import { db, queue } from '@/lib/server/app';
import { refreshBodyFlags } from '@/lib/server/claim';
import { ApiError } from '@/lib/server/errors';
import { refundOrderAdmin } from '@/lib/server/payments';

type P = { path: string[] };

async function audit(d: Sql, adminId: number, action: string, target: string | null, before: unknown, after: unknown) {
  await d.query('insert into admin_audit_log (admin_id, action, target, before, after) values ($1, $2, $3, $4, $5)', [
    adminId,
    action,
    target,
    before === undefined ? null : JSON.stringify(before),
    after === undefined ? null : JSON.stringify(after),
  ]);
}

const opts = { auth: 'admin' as const, limits: [{ name: 'admin', max: 120, windowS: 60, by: 'user' as const }] };

export const GET = route<P>(opts, async ({ params, url }: Ctx<P>) => {
  const d = await db();
  const [section, arg] = params.path;
  switch (section) {
    case 'moderation':
      return {
        banners: await d.query(
          `select b.github_id, u.login::text as login, b.text, b.status, b.created_at from banners b join github_users u using (github_id) where b.status = 'pending' order by b.created_at`,
        ),
        reports: await d.query(`select * from reports where status = 'open' order by created_at limit 200`),
        bios: await d.query(
          `select a.github_id, u.login::text as login, a.bio_override from accounts a join github_users u using (github_id)
           where a.bio_override is not null and a.github_id in (select target_id::bigint from reports where target_type = 'bio' and status = 'open' and target_id ~ '^[0-9]+$')`,
        ),
      };
    case 'users': {
      const [u] = await d.query(
        `select u.*, a.role, a.banned_at, a.stardust_balance, a.claimed_at, b.spectral_class, b.state, b.rank_global
         from github_users u left join accounts a using (github_id) left join bodies b using (github_id) where u.login = $1`,
        [arg ?? ''],
      );
      if (!u) throw new ApiError(404, 'not_found', 'No such user');
      const inventory = await d.query(`select * from inventory where owner_id = $1 order by acquired_at desc`, [
        (u as { github_id: number }).github_id,
      ]);
      return { user: u, inventory };
    }
    case 'orders':
      return {
        orders: await d.query(
          `select o.*, b.login::text as buyer, r.login::text as recipient from orders o join github_users b on b.github_id = o.buyer_id
           join github_users r on r.github_id = o.recipient_id where ($1::text is null or o.status = $1) order by o.created_at desc limit 200`,
          [url.searchParams.get('status')],
        ),
      };
    case 'bakes':
      return {
        runs: await d.query('select * from bake_runs order by started_at desc limit 30'),
        delta: await getState(d, 'delta'),
        budget: await getState(d, 'github_budget'),
        queue: {
          materializeOpen: (
            await d.query(`select count(*)::int as n from materialize_jobs where status in ('queued','fetching','placing')`)
          )[0],
          deadLetters: await d.query('select queue, error, failed_at from job_failures order by failed_at desc limit 20'),
        },
        cost: await d.query(`select shape, round(avg(cost), 2)::float8 as mean, count(*)::int as n from github_cost_log group by shape`),
      };
    case 'flags':
      return { flags: await d.query('select * from feature_flags order by key') };
    case 'events':
      return { events: await d.query('select * from cosmic_events order by starts_at desc limit 50') };
    case 'audit':
      return { log: await d.query('select * from admin_audit_log order by created_at desc limit 200') };
    default:
      throw new ApiError(404, 'not_found', 'Unknown admin resource');
  }
});

export const POST = route<P>(opts, async ({ params, req, session }: Ctx<P>) => {
  const d = await db();
  const q = await queue();
  const admin = session!.githubId;
  const [section, arg, action] = params.path;

  if (section === 'moderation' && arg === 'banner') {
    const b = await body(req, z.object({ githubId: z.number(), decision: z.enum(['approved', 'rejected']) }));
    await d.query('update banners set status = $2 where github_id = $1', [b.githubId, b.decision]);
    await notify(d, b.githubId, 'banner_moderated', { decision: b.decision });
    void broadcast('cosmic:global', 'equip', { githubId: b.githubId, slot: 'banner' });
    await audit(d, admin, `banner.${b.decision}`, String(b.githubId), null, b);
    return { ok: true };
  }
  if (section === 'reports' && arg) {
    const b = await body(req, z.object({ status: z.enum(['actioned', 'dismissed']) }));
    await d.query('update reports set status = $2 where id = $1', [Number(arg), b.status]);
    await audit(d, admin, `report.${b.status}`, arg, null, b);
    return { ok: true };
  }
  if (section === 'users' && arg) {
    const [u] = await d.query<{ github_id: number }>('select github_id from github_users where login = $1', [arg]);
    if (!u) throw new ApiError(404, 'not_found', 'No such user');
    const id = u.github_id;
    switch (action) {
      case 'refresh':
        await q.send('refresh', { githubId: id }, { priority: 90, singletonKey: `r:${id}:admin:${Date.now()}` });
        break;
      case 'reset-cosmetics':
        await d.query('delete from equipped where github_id = $1', [id]);
        await refreshBodyFlags(d, id);
        break;
      case 'grant-item': {
        const b = await body(req, z.object({ itemId: z.string() }));
        if (!CATALOG_BY_ID.has(b.itemId)) throw new ApiError(404, 'item_not_found', 'No such item');
        await d.query(
          `insert into inventory (owner_id, item_id, source) values ($1, $2, 'grant') on conflict (owner_id, item_id) where revoked_at is null do nothing`,
          [id, b.itemId],
        );
        await notify(d, id, 'item_granted', { itemId: b.itemId });
        break;
      }
      case 'ban':
        await d.query('update accounts set banned_at = now() where github_id = $1', [id]);
        break;
      case 'unban':
        await d.query('update accounts set banned_at = null where github_id = $1', [id]);
        break;
      case 'review': {
        const b = await body(req, z.object({ underReview: z.boolean() }));
        await d.query('update github_users set under_review = $2 where github_id = $1', [id, b.underReview]);
        break;
      }
      case 'hide': {
        const [b] = await d.query<{ star_index: number }>('select star_index from bodies where github_id = $1', [id]);
        await d.query('update github_users set is_opted_out = true where github_id = $1', [id]);
        if (b) {
          const hidden = (await getState<number[]>(d, 'hidden_indices')) ?? [];
          await setState(d, 'hidden_indices', [...new Set([...hidden, b.star_index])]);
          void broadcast('cosmic:global', 'hide', { starIndex: b.star_index, githubId: id });
        }
        await d.query('delete from bodies where github_id = $1', [id]);
        await q.send('delta', {}, { singletonKey: 'delta' });
        break;
      }
      case 'alias': {
        const b = await body(req, z.object({ oldLogin: z.string().regex(/^[a-zA-Z0-9-]{1,39}$/) }));
        await d.query(
          `insert into login_aliases (old_login, github_id) values ($1, $2) on conflict (old_login) do update set github_id = excluded.github_id`,
          [b.oldLogin, id],
        );
        break;
      }
      default:
        throw new ApiError(404, 'not_found', 'Unknown user action');
    }
    await audit(d, admin, `user.${action}`, arg, null, null);
    return { ok: true };
  }
  if (section === 'orders' && arg) {
    if (action === 'refund') {
      await refundOrderAdmin(d, arg);
    } else if (action === 'regrant') {
      const [o] = await d.query<{ recipient_id: number; item_id: string; status: string }>(
        'select recipient_id, item_id, status from orders where id = $1',
        [arg],
      );
      if (!o || o.status !== 'paid') throw new ApiError(409, 'not_paid', 'Only paid orders can be re-granted');
      await d.query(
        `insert into inventory (owner_id, item_id, source, order_id) values ($1, $2, 'grant', $3) on conflict (owner_id, item_id) where revoked_at is null do nothing`,
        [o.recipient_id, o.item_id, arg],
      );
    } else throw new ApiError(404, 'not_found', 'Unknown order action');
    await audit(d, admin, `order.${action}`, arg, null, null);
    return { ok: true };
  }
  if (section === 'bakes') {
    if (arg === 'rollback') {
      const b = await body(req, z.object({ version: z.string().min(10).max(40) }));
      await rollbackTo(d, b.version);
      await audit(d, admin, 'bake.rollback', b.version, null, null);
      return { ok: true };
    }
    await q.send('bake', { triggeredBy: `admin:${session!.login}` }, { singletonKey: `bake:admin:${Math.floor(Date.now() / 60_000)}` });
    await audit(d, admin, 'bake.trigger', null, null, null);
    return { queued: true };
  }
  if (section === 'flags') {
    const b = await body(req, z.object({ key: z.string().regex(/^[a-z0-9_.-]{2,64}$/), enabled: z.boolean() }));
    const [before] = await d.query('select * from feature_flags where key = $1', [b.key]);
    await d.query(
      `insert into feature_flags (key, enabled, updated_at) values ($1, $2, now()) on conflict (key) do update set enabled = excluded.enabled, updated_at = now()`,
      [b.key, b.enabled],
    );
    void broadcast('cosmic:global', 'flags', { key: b.key, enabled: b.enabled });
    await audit(d, admin, 'flag.set', b.key, before ?? null, b);
    return { ok: true };
  }
  if (section === 'events') {
    const b = await body(
      req,
      z.object({
        type: z.enum(['meteor_shower', 'census']),
        name: z.string().min(2).max(80),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
      }),
    );
    const [row] = await d.query<{ id: string }>(
      'insert into cosmic_events (type, name, starts_at, ends_at) values ($1, $2, $3, $4) returning id',
      [b.type, b.name, b.startsAt, b.endsAt],
    );
    if (b.type === 'meteor_shower')
      await emitEvent(d, { type: 'meteor_shower', payload: { name: b.name, startsAt: b.startsAt, endsAt: b.endsAt } });
    await audit(d, admin, 'event.create', row!.id, null, b);
    return { id: row!.id };
  }
  if (section === 'items' && arg) {
    const b = await body(
      req,
      z.object({
        active: z.boolean().optional(),
        availableFrom: z.string().datetime().nullable().optional(),
        availableUntil: z.string().datetime().nullable().optional(),
      }),
    );
    const [before] = await d.query('select active, available_from, available_until from items where id = $1', [arg]);
    if (!before) throw new ApiError(404, 'item_not_found', 'No such item');
    await d.query(
      `update items set active = coalesce($2, active),
         available_from = case when $3::boolean then $4::timestamptz else available_from end,
         available_until = case when $5::boolean then $6::timestamptz else available_until end where id = $1`,
      [
        arg,
        b.active ?? null,
        b.availableFrom !== undefined,
        b.availableFrom ?? null,
        b.availableUntil !== undefined,
        b.availableUntil ?? null,
      ],
    );
    await audit(d, admin, 'item.update', arg, before, b);
    return { ok: true };
  }
  throw new ApiError(404, 'not_found', 'Unknown admin action');
});
