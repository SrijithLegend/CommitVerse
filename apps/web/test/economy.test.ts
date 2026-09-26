/**
 * §13.1 "Payments" + economy/social integration tests against real Postgres (PGlite):
 * webhook replay never double-grants, out-of-order events, refunds revoke + unequip, signature/staleness checks,
 * Stardust redemption and daily check-in, signal limits, claims + verified referrals.
 */
import { createHmac } from 'node:crypto';
import { createTestDb, type Db } from '@commitverse/db';
import { createLocalQueue, type JobQueue, syncAchievementCatalog, syncItems } from '@commitverse/pipeline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimStar } from '@/lib/server/claim';
import { checkin, equip, redeem } from '@/lib/server/economy';
import { fulfillOrder, markRefunded, providerByName, WebhookSignatureError } from '@/lib/server/payments';
import { sendSignal } from '@/lib/server/social';

let db: Db;
let queue: JobQueue;
let seq = 0;

async function user(login: string, opts: { ageDays?: number; cTotal?: number } = {}): Promise<number> {
  const id = 100_000 + ++seq;
  await db.query(`insert into github_users (github_id, login, created_at_gh) values ($1, $2, now() - make_interval(days => $3))`, [
    id,
    login,
    opts.ageDays ?? 1000,
  ]);
  await db.query(`insert into user_metrics (github_id, c_total) values ($1, $2)`, [id, opts.cTotal ?? 500]);
  await db.query(
    `insert into bodies (github_id, bake_version, galaxy_id, star_index, x, y, z, radius, base_radius, temperature, spectral_class, luminosity, impact, state)
     values ($1, 'v', 1, $2, 0, 0, 0, 3, 3, 5000, 'K', 0.5, 1, 'main')`,
    [id, seq],
  );
  return id;
}

async function claim(login: string, id: number, refCookie?: string) {
  const [au] = await db.query<{ id: string }>('insert into auth.users default values returning id');
  await claimStar(db, queue, { authUserId: au!.id, githubId: id, login, refCookie });
  return au!.id;
}

beforeAll(async () => {
  db = await createTestDb();
  queue = createLocalQueue(db); // no workers registered: jobs just queue
  await db.query(`insert into bake_runs (version, status, params_hash) values ('v', 'live', 'x')`);
  await db.query(
    `insert into galaxies (id, language, tier, radius, center, population, bake_version) values (1, 'TypeScript', 'major', 1000, '{0,0,0}', 1, 'v')`,
  );
  await syncAchievementCatalog(db);
  await syncItems(db);
});
afterAll(async () => {
  await queue.stop();
  await db.close();
});

async function order(buyer: number, recipient: number, itemId = 'corona.halo_ring') {
  const [o] = await db.query<{ id: string }>(
    `insert into orders (buyer_id, recipient_id, item_id, provider, provider_session_id, idempotency_key, status, amount_minor, currency)
     values ($1, $2, $3, 'stripe', 'cs_' || gen_random_uuid(), gen_random_uuid()::text, 'pending', 499, 'USD') returning id`,
    [buyer, recipient, itemId],
  );
  const [s] = await db.query<{ provider_session_id: string }>('select provider_session_id from orders where id = $1', [o!.id]);
  return { id: o!.id, session: s!.provider_session_id };
}

describe('F7 payments', () => {
  it('a replayed webhook never double-grants', async () => {
    const id = await user('buyer1');
    await claim('buyer1', id);
    const o = await order(id, id);
    expect(await fulfillOrder(db, 'stripe', o.session, o.id)).toBe('granted');
    expect(await fulfillOrder(db, 'stripe', o.session, o.id)).toBe('duplicate');
    await Promise.all([fulfillOrder(db, 'stripe', o.session, o.id), fulfillOrder(db, 'stripe', o.session, o.id)]);
    const inv = await db.query('select 1 from inventory where owner_id = $1 and item_id = $2', [id, 'corona.halo_ring']);
    expect(inv).toHaveLength(1);
  });

  it('refunds revoke the item, unequip it and record a ledger reversal; late "paid" events are ignored', async () => {
    const id = await user('buyer2');
    await claim('buyer2', id);
    const o = await order(id, id);
    await fulfillOrder(db, 'stripe', o.session, o.id);
    const [inv] = await db.query<{ id: string }>('select id from inventory where order_id = $1', [o.id]);
    await equip(db, id, 'corona', inv!.id);
    await markRefunded(db, o.id);
    expect((await db.query('select 1 from equipped where github_id = $1', [id])).length).toBe(0);
    expect(
      (await db.query<{ revoked_at: Date | null }>('select revoked_at from inventory where id = $1', [inv!.id]))[0]!.revoked_at,
    ).not.toBeNull();
    expect((await db.query(`select 1 from stardust_ledger where github_id = $1 and reason = 'refund'`, [id])).length).toBe(1);
    // out of order: a delayed "paid" webhook after the refund must not re-grant
    expect(await fulfillOrder(db, 'stripe', o.session, o.id)).toBe('duplicate');
    expect((await db.query('select 1 from inventory where owner_id = $1 and revoked_at is null', [id])).length).toBe(0);
  });

  it('gifts to unclaimed stars wait as pending pods and become deliverable on claim', async () => {
    const buyer = await user('gifter');
    await claim('gifter', buyer);
    const to = await user('lucky');
    const o = await order(buyer, to, 'aura.crab_filaments');
    await db.query(
      `insert into gifts (order_id, from_id, to_id, state, expires_at) values ($1, $2, $3, 'pending', now() + interval '90 days')`,
      [o.id, buyer, to],
    );
    await fulfillOrder(db, 'stripe', o.session, o.id);
    expect((await db.query<{ state: string }>('select state from gifts where order_id = $1', [o.id]))[0]!.state).toBe('pending');
    await claim('lucky', to);
    expect((await db.query<{ state: string }>('select state from gifts where order_id = $1', [o.id]))[0]!.state).toBe('delivered');
  });

  it('Stripe signatures: valid accepted, forged and stale (> 5 min) rejected', () => {
    const stripe = providerByName('stripe')!;
    const raw = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid', metadata: { order_id: 'o1' } } },
    });
    const sign = (t: number) => `t=${t},v1=${createHmac('sha256', 'whsec_test').update(`${t}.${raw}`).digest('hex')}`;
    const now = Math.floor(Date.now() / 1000);
    expect(stripe.verifyWebhook(raw, new Headers({ 'stripe-signature': sign(now) }))).toEqual({
      kind: 'paid',
      sessionId: 'cs_1',
      orderId: 'o1',
    });
    expect(() => stripe.verifyWebhook(raw, new Headers({ 'stripe-signature': `t=${now},v1=deadbeef` }))).toThrow(WebhookSignatureError);
    expect(() => stripe.verifyWebhook(raw, new Headers({ 'stripe-signature': sign(now - 301) }))).toThrow(/stale/);
  });
});

describe('F7 Stardust', () => {
  it('redeem spends Stardust once; the balance can never go negative', async () => {
    const id = await user('saver');
    await claim('saver', id);
    await db.query(`insert into stardust_ledger (github_id, delta, reason, ref_id) values ($1, 120, 'admin', 'seed')`, [id]);
    const r = await redeem(db, id, 'corona.solar_flare'); // 100 ✦
    expect(r.balance).toBe(20);
    await expect(redeem(db, id, 'corona.solar_flare')).rejects.toThrow(/already own/);
    await expect(redeem(db, id, 'corona.crown_of_prominences')).rejects.toThrow(/Not enough Stardust/);
    await expect(redeem(db, id, 'corona.halo_ring')).rejects.toThrow(/can’t be bought with Stardust/);
  });

  it('daily check-in grants 5 ✦ once per UTC day', async () => {
    const id = await user('regular');
    await claim('regular', id);
    const before = (await db.query<{ b: number }>('select stardust_balance as b from accounts where github_id = $1', [id]))[0]!.b;
    const r = await checkin(db, id);
    expect(r.granted).toBe(5);
    expect(r.balance).toBe(before + 5);
    await expect(checkin(db, id)).rejects.toThrow(/Already checked in/);
  });

  it('equip validates ownership and slot', async () => {
    const id = await user('dresser');
    await claim('dresser', id);
    await expect(equip(db, id, 'corona', '00000000-0000-0000-0000-000000000000')).rejects.toThrow(/don’t own/);
    const [inv] = await db.query<{ id: string }>(
      `insert into inventory (owner_id, item_id, source) values ($1, 'aura.orion_veil', 'grant') returning id`,
      [id],
    );
    await expect(equip(db, id, 'corona', inv!.id)).rejects.toThrow(/aura slot/);
    await equip(db, id, 'aura', inv!.id);
  });
});

describe('F8 signals', () => {
  it('no self-signals, one per recipient per day, 10 per day total, moderated messages', async () => {
    const from = await user('sender');
    await claim('sender', from);
    await expect(sendSignal(db, queue, from, 'sender')).rejects.toThrow(/yourself/);
    const targets = await Promise.all(Array.from({ length: 11 }, (_, i) => user(`target${i}`)));
    await sendSignal(db, queue, from, 'target0', 'great work');
    await expect(sendSignal(db, queue, from, 'target0')).rejects.toThrow(/already signalled/);
    await expect(sendSignal(db, queue, from, 'target1', 'you are a f.u.c.k')).rejects.toThrow(/moderation/);
    for (let i = 1; i < 10; i++) await sendSignal(db, queue, from, `target${i}`);
    await expect(sendSignal(db, queue, from, 'target10')).rejects.toThrow(/10 signals today/);
    expect(targets).toHaveLength(11);
  });
});

describe('F5/F9 claims & referrals', () => {
  it('a GitHub account can be claimed by exactly one auth user', async () => {
    const id = await user('solo');
    await claim('solo', id);
    await expect(claim('solo', id)).rejects.toThrow(/already claimed/);
  });

  it('verified referrals pay the referrer 100 ✦ once; unverified ones pay nothing', async () => {
    const ref = await user('recruiter');
    await claim('recruiter', ref);
    const [{ referral_code }] = (await db.query<{ referral_code: string }>('select referral_code from accounts where github_id = $1', [
      ref,
    ])) as [{ referral_code: string }];
    const good = await user('newbie', { ageDays: 400, cTotal: 50 });
    await claim('newbie', good, `${referral_code}|${Date.now() - 1000}`);
    const young = await user('sybil', { ageDays: 3, cTotal: 50 });
    await claim('sybil', young, `${referral_code}|${Date.now() - 1000}`);
    const rows = await db.query<{ referee_id: number; verified_at: Date | null }>(
      'select referee_id, verified_at from referrals where referrer_id = $1',
      [ref],
    );
    expect(rows.find((r) => r.referee_id === good)!.verified_at).not.toBeNull();
    expect(rows.find((r) => r.referee_id === young)!.verified_at).toBeNull();
    expect((await db.query(`select 1 from stardust_ledger where github_id = $1 and reason = 'referral'`, [ref])).length).toBe(1);
  });
});
