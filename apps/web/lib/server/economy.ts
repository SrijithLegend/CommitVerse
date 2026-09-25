/** F6/F7 — Stardust redemptions, daily check-in, equip, checkout creation. */
import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Db } from '@commitverse/db';
import { grantStardust, notify } from '@commitverse/pipeline';
import { refreshBodyFlags } from './claim';
import { ApiError } from './errors';
import { paymentProvider } from './payments';

interface ItemRow {
  id: string;
  slot: string;
  name: string;
  rarity: string;
  track: 'earnable' | 'premium' | 'exclusive';
  price_stardust: number | null;
  price_minor: Record<string, number> | null;
  available_from: Date | null;
  available_until: Date | null;
  max_supply: number | null;
  active: boolean;
}

async function purchasableItem(db: Db, itemId: string): Promise<ItemRow> {
  const [item] = await db.query<ItemRow>('select * from items where id = $1', [itemId]);
  if (!item || !item.active) throw new ApiError(404, 'item_not_found', 'No such item');
  const now = Date.now();
  if ((item.available_from && item.available_from.getTime() > now) || (item.available_until && item.available_until.getTime() < now))
    throw new ApiError(409, 'not_available', 'This item is not available right now');
  if (item.max_supply !== null) {
    const [{ n }] = (await db.query<{ n: number }>(`select count(*)::int as n from inventory where item_id = $1 and revoked_at is null`, [
      itemId,
    ])) as [{ n: number }];
    if (n >= item.max_supply) throw new ApiError(409, 'sold_out', 'This item is sold out');
  }
  return item;
}

export async function redeem(db: Db, githubId: number, itemId: string): Promise<{ inventoryId: string; balance: number }> {
  const item = await purchasableItem(db, itemId);
  if (item.track !== 'earnable' || item.price_stardust === null)
    throw new ApiError(409, 'not_earnable', 'This item can’t be bought with Stardust');
  return db.tx(async (q) => {
    const [owned] = await q.query('select 1 from inventory where owner_id = $1 and item_id = $2 and revoked_at is null', [
      githubId,
      itemId,
    ]);
    if (owned) throw new ApiError(409, 'already_owned', 'You already own this item');
    const [acct] = await q.query<{ stardust_balance: number }>('select stardust_balance from accounts where github_id = $1 for update', [
      githubId,
    ]);
    if (!acct || acct.stardust_balance < item.price_stardust!) throw new ApiError(409, 'insufficient_stardust', 'Not enough Stardust');
    await q.query(`insert into stardust_ledger (github_id, delta, reason, ref_id) values ($1, $2, 'redeem', $3)`, [
      githubId,
      -item.price_stardust!,
      itemId,
    ]);
    const [inv] = await q.query<{ id: string }>(`insert into inventory (owner_id, item_id, source) values ($1, $2, 'earn') returning id`, [
      githubId,
      itemId,
    ]);
    const [bal] = await q.query<{ stardust_balance: number }>('select stardust_balance from accounts where github_id = $1', [githubId]);
    return { inventoryId: inv!.id, balance: bal!.stardust_balance };
  });
}

/** Daily check-in: 5✦, +1✦ per consecutive day, cap 15✦/day. Idempotent per UTC day. */
export async function checkin(db: Db, githubId: number): Promise<{ granted: number; streak: number; balance: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const [s] = await db.query<{ last_checkin_on: string | null; checkin_streak: number }>(
    'select last_checkin_on, checkin_streak from explorer_stats where github_id = $1',
    [githubId],
  );
  if (s?.last_checkin_on === today) throw new ApiError(409, 'already_checked_in', 'Already checked in today — come back tomorrow');
  const streak = s?.last_checkin_on === yesterday ? s.checkin_streak + 1 : 1;
  const amount = Math.min(15, 5 + (streak - 1));
  const granted = await grantStardust(db, githubId, amount, 'daily', today);
  if (!granted) throw new ApiError(409, 'already_checked_in', 'Already checked in today');
  await db.query(
    `insert into explorer_stats (github_id, last_checkin_on, checkin_streak) values ($1, $2, $3)
     on conflict (github_id) do update set last_checkin_on = excluded.last_checkin_on, checkin_streak = excluded.checkin_streak`,
    [githubId, today, streak],
  );
  const [bal] = await db.query<{ stardust_balance: number }>('select stardust_balance from accounts where github_id = $1', [githubId]);
  return { granted: amount, streak, balance: bal!.stardust_balance };
}

export async function equip(db: Db, githubId: number, slot: string, inventoryId: string | null): Promise<void> {
  if (inventoryId === null) {
    await db.query('delete from equipped where github_id = $1 and slot = $2', [githubId, slot]);
  } else {
    const [inv] = await db.query<{ slot: string }>(
      `select i.slot from inventory v join items i on i.id = v.item_id where v.id = $1 and v.owner_id = $2 and v.revoked_at is null`,
      [inventoryId, githubId],
    );
    if (!inv) throw new ApiError(404, 'not_owned', 'You don’t own that item');
    if (inv.slot !== slot) throw new ApiError(400, 'wrong_slot', `That item goes in the ${inv.slot} slot`);
    await db.query(
      `insert into equipped (github_id, slot, inventory_id) values ($1, $2, $3)
       on conflict (github_id, slot) do update set inventory_id = excluded.inventory_id`,
      [githubId, slot, inventoryId],
    );
  }
  if (slot === 'corona') await refreshBodyFlags(db, githubId); // far-field tint (cosmetic_hint) — never a physical attribute
}

export async function createCheckout(
  db: Db,
  buyerId: number,
  buyerLogin: string,
  body: { itemId: string; giftTo?: string; anonymous?: boolean },
  appUrl: string,
): Promise<{ checkoutUrl: string; orderId: string }> {
  const item = await purchasableItem(db, body.itemId);
  if (item.track !== 'premium' || !item.price_minor) throw new ApiError(409, 'not_premium', 'This item isn’t sold for money');
  let recipientId = buyerId;
  let giftTo: string | null = null;
  if (body.giftTo) {
    const [r] = await db.query<{ github_id: number; login: string }>(
      'select github_id, login::text as login from github_users where login = $1 and not is_opted_out',
      [body.giftTo],
    );
    if (!r) throw new ApiError(404, 'recipient_not_found', `@${body.giftTo} is not in the universe`);
    if (r.github_id === buyerId) throw new ApiError(400, 'self_gift', 'Buy it for yourself instead');
    recipientId = r.github_id;
    giftTo = r.login;
  }
  const owned = await db.query('select 1 from inventory where owner_id = $1 and item_id = $2 and revoked_at is null', [
    recipientId,
    item.id,
  ]);
  if (owned.length) throw new ApiError(409, 'already_owned', giftTo ? `@${giftTo} already owns this item` : 'You already own this item');
  const currency = 'USD' in item.price_minor ? 'USD' : Object.keys(item.price_minor)[0]!;
  const amount = item.price_minor[currency]!;
  const provider = paymentProvider();
  const orderId = randomUUID();
  const idempotencyKey = `order-${orderId}`;
  await db.query(
    `insert into orders (id, buyer_id, recipient_id, item_id, provider, idempotency_key, status, amount_minor, currency)
     values ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)`,
    [orderId, buyerId, recipientId, item.id, provider.name, idempotencyKey, amount, currency],
  );
  if (giftTo) {
    await db.query(
      `insert into gifts (order_id, from_id, to_id, anonymous, state, expires_at) values ($1, $2, $3, $4, 'pending', now() + interval '90 days')`,
      [orderId, buyerId, recipientId, !!body.anonymous],
    );
  }
  const session = await provider.createCheckout(
    { id: orderId, idempotencyKey, itemId: item.id, itemName: item.name, amountMinor: amount, currency, buyerLogin, giftToLogin: giftTo },
    { success: `${appUrl}/shop?order=${orderId}&status=success`, cancel: `${appUrl}/shop?order=${orderId}&status=cancelled` },
  );
  await db.query('update orders set provider_session_id = $2 where id = $1', [orderId, session.sessionId]);
  return { checkoutUrl: session.url, orderId };
}

export async function openGift(db: Db, githubId: number, giftId: string, equipNow: boolean): Promise<{ itemId: string }> {
  const res = await db.tx(async (q) => {
    const [g] = await q.query<{ order_id: string; from_id: number; anonymous: boolean; state: string; item_id: string }>(
      `select g.order_id, g.from_id, g.anonymous, g.state, o.item_id from gifts g join orders o on o.id = g.order_id
       where g.id = $1 and g.to_id = $2 for update of g`,
      [giftId, githubId],
    );
    if (!g) throw new ApiError(404, 'gift_not_found', 'No such gift');
    if (g.state !== 'delivered') throw new ApiError(409, 'gift_not_openable', `This gift is ${g.state}`);
    await q.query(`update gifts set state = 'opened', opened_at = now() where id = $1`, [giftId]);
    const [inv] = await q.query<{ id: string }>(
      `insert into inventory (owner_id, item_id, source, order_id) values ($1, $2, 'gift', $3)
       on conflict (owner_id, item_id) where revoked_at is null do nothing returning id`,
      [githubId, g.item_id, g.order_id],
    );
    return { g, inventoryId: inv?.id ?? null };
  });
  const { g, inventoryId } = res;
  if (equipNow && inventoryId) {
    const [slot] = await db.query<{ slot: string }>('select slot from items where id = $1', [g.item_id]);
    if (slot) await equip(db, githubId, slot.slot, inventoryId);
  }
  const { emitEvent } = await import('@commitverse/pipeline');
  await emitEvent(db, {
    type: 'gift_opened',
    actorId: githubId,
    targetId: g.anonymous ? null : g.from_id,
    payload: { itemId: g.item_id, anonymous: g.anonymous },
  });
  await notify(db, g.from_id, 'gift_opened', { by: githubId, itemId: g.item_id });
  return { itemId: g.item_id };
}

/** When a star gets claimed, pending gifts become deliverable. */
export async function deliverPendingGifts(db: Db, githubId: number): Promise<number> {
  const rows = await db.query(
    `update gifts g set state = 'delivered' from orders o where o.id = g.order_id and o.status = 'paid' and g.to_id = $1 and g.state = 'pending' returning g.id`,
    [githubId],
  );
  return rows.length;
}
