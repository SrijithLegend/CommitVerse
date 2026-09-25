/**
 * F7 — PaymentProvider { createCheckout, verifyWebhook, refund }. Stripe Checkout (hosted) or Paddle (Merchant of Record).
 * Grants happen ONLY from verified webhooks; prices are always read from the DB; the client sends only itemId.
 * "mock" exists for local mode only and is refused in production (env validation).
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from '@commitverse/db';
import { emitEvent, log, notify } from '@commitverse/pipeline';
import { env } from './app';

export interface CheckoutOrder {
  id: string;
  idempotencyKey: string;
  itemId: string;
  itemName: string;
  amountMinor: number;
  currency: string;
  buyerLogin: string;
  giftToLogin: string | null;
}

export type WebhookOutcome =
  | { kind: 'paid'; sessionId: string; orderId: string | null }
  | { kind: 'failed' | 'expired'; sessionId: string; orderId: string | null }
  | { kind: 'refunded'; sessionId: string; orderId: string | null }
  | { kind: 'ignored' };

export interface PaymentProvider {
  name: 'stripe' | 'paddle' | 'mock';
  createCheckout(order: CheckoutOrder, urls: { success: string; cancel: string }): Promise<{ url: string; sessionId: string }>;
  verifyWebhook(raw: string, headers: Headers): WebhookOutcome;
  refund(sessionId: string, orderId: string): Promise<void>;
}

const MAX_AGE_S = 300; // §11.3: reject webhook events older than 5 minutes

const hmacHex = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class WebhookSignatureError extends Error {}

const stripe: PaymentProvider = {
  name: 'stripe',
  async createCheckout(o, urls) {
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: urls.success,
      cancel_url: urls.cancel,
      client_reference_id: o.id,
      'metadata[order_id]': o.id,
      'payment_intent_data[metadata][order_id]': o.id,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': o.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(o.amountMinor),
      'line_items[0][price_data][product_data][name]': o.giftToLogin ? `${o.itemName} (gift for @${o.giftToLogin})` : o.itemName,
      expires_at: String(Math.floor(Date.now() / 1000) + 3600),
    });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': o.idempotencyKey,
      },
      body: form,
    });
    const j = (await res.json()) as { id?: string; url?: string; error?: { message: string } };
    if (!res.ok || !j.url || !j.id) throw new Error(`Stripe checkout failed: ${j.error?.message ?? res.status}`);
    return { url: j.url, sessionId: j.id };
  },
  verifyWebhook(raw, headers) {
    const sig = headers.get('stripe-signature') ?? '';
    const parts = Object.fromEntries(sig.split(',').map((kv) => kv.split('=') as [string, string]));
    const t = Number(parts.t);
    const v1s = sig
      .split(',')
      .filter((kv) => kv.startsWith('v1='))
      .map((kv) => kv.slice(3));
    const expected = hmacHex(process.env.STRIPE_WEBHOOK_SECRET ?? '', `${t}.${raw}`);
    if (!t || !v1s.some((v) => safeEq(v, expected))) throw new WebhookSignatureError('bad signature');
    if (Math.abs(Date.now() / 1000 - t) > MAX_AGE_S) throw new WebhookSignatureError('stale event');
    const evt = JSON.parse(raw) as { type: string; data: { object: Record<string, unknown> } };
    const obj = evt.data.object;
    const meta = (obj.metadata as Record<string, string> | undefined) ?? {};
    switch (evt.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        return obj.payment_status === 'paid'
          ? { kind: 'paid', sessionId: String(obj.id), orderId: meta.order_id ?? (obj.client_reference_id as string) ?? null }
          : { kind: 'ignored' };
      case 'checkout.session.async_payment_failed':
        return { kind: 'failed', sessionId: String(obj.id), orderId: meta.order_id ?? null };
      case 'checkout.session.expired':
        return { kind: 'expired', sessionId: String(obj.id), orderId: meta.order_id ?? null };
      case 'charge.refunded':
        return { kind: 'refunded', sessionId: '', orderId: meta.order_id ?? null };
      default:
        return { kind: 'ignored' };
    }
  },
  async refund(sessionId, orderId) {
    const auth = { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` };
    const s = (await (await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, { headers: auth })).json()) as {
      payment_intent?: string;
    };
    if (!s.payment_intent) throw new Error('no payment intent to refund');
    const res = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': `refund-${orderId}` },
      body: new URLSearchParams({ payment_intent: s.payment_intent }),
    });
    if (!res.ok) throw new Error(`Stripe refund failed: ${res.status}`);
  },
};

const paddleBase = () => (process.env.PADDLE_ENV === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com');

const paddle: PaymentProvider = {
  name: 'paddle',
  async createCheckout(o) {
    const res = await fetch(`${paddleBase()}/transactions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.PADDLE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          {
            quantity: 1,
            price: {
              description: o.itemName,
              name: o.itemName,
              unit_price: { amount: String(o.amountMinor), currency_code: o.currency },
              product: { name: o.itemName, tax_category: 'standard' },
            },
          },
        ],
        custom_data: { order_id: o.id },
      }),
    });
    const j = (await res.json()) as { data?: { id: string; checkout?: { url?: string } }; error?: { detail: string } };
    if (!res.ok || !j.data?.checkout?.url) throw new Error(`Paddle checkout failed: ${j.error?.detail ?? res.status}`);
    return { url: j.data.checkout.url, sessionId: j.data.id };
  },
  verifyWebhook(raw, headers) {
    const sig = headers.get('paddle-signature') ?? '';
    const parts = Object.fromEntries(sig.split(';').map((kv) => kv.split('=') as [string, string]));
    const ts = Number(parts.ts);
    const expected = hmacHex(process.env.PADDLE_WEBHOOK_SECRET ?? '', `${parts.ts}:${raw}`);
    if (!ts || !parts.h1 || !safeEq(parts.h1, expected)) throw new WebhookSignatureError('bad signature');
    if (Math.abs(Date.now() / 1000 - ts) > MAX_AGE_S) throw new WebhookSignatureError('stale event');
    const evt = JSON.parse(raw) as {
      event_type: string;
      data: { id: string; custom_data?: { order_id?: string }; transaction_id?: string };
    };
    const orderId = evt.data.custom_data?.order_id ?? null;
    if (evt.event_type === 'transaction.completed' || evt.event_type === 'transaction.paid')
      return { kind: 'paid', sessionId: evt.data.id, orderId };
    if (evt.event_type === 'transaction.payment_failed') return { kind: 'failed', sessionId: evt.data.id, orderId };
    if (evt.event_type === 'adjustment.updated' && evt.data.transaction_id)
      return { kind: 'refunded', sessionId: evt.data.transaction_id, orderId };
    return { kind: 'ignored' };
  },
  async refund(sessionId) {
    const res = await fetch(`${paddleBase()}/adjustments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.PADDLE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'refund', transaction_id: sessionId, reason: 'Refund issued by Commitverse', type: 'full' }),
    });
    if (!res.ok) throw new Error(`Paddle refund failed: ${res.status}`);
  },
};

/** Local-mode only. The mock checkout page posts a signed "webhook" to /api/webhooks/mock. */
export const MOCK_SECRET = () => `mock:${process.env.SESSION_SECRET ?? 'local-dev'}`;
const mock: PaymentProvider = {
  name: 'mock',
  async createCheckout(o) {
    return { url: `${env().APP_URL}/checkout/mock?order=${o.id}`, sessionId: `mock_${o.id}` };
  },
  verifyWebhook(raw, headers) {
    const t = Number(headers.get('x-mock-timestamp'));
    const sig = headers.get('x-mock-signature') ?? '';
    if (!t || !safeEq(sig, hmacHex(MOCK_SECRET(), `${t}.${raw}`))) throw new WebhookSignatureError('bad signature');
    if (Math.abs(Date.now() / 1000 - t) > MAX_AGE_S) throw new WebhookSignatureError('stale event');
    const e = JSON.parse(raw) as { type: 'paid' | 'failed' | 'refunded'; orderId: string };
    return { kind: e.type, sessionId: `mock_${e.orderId}`, orderId: e.orderId };
  },
  async refund() {},
};

export function paymentProvider(): PaymentProvider {
  const p = env().PAYMENT_PROVIDER ?? (process.env.STRIPE_SECRET_KEY ? 'stripe' : process.env.PADDLE_API_KEY ? 'paddle' : 'mock');
  if (p === 'mock' && env().NODE_ENV === 'production') throw new Error('mock payments are disabled in production');
  return p === 'stripe' ? stripe : p === 'paddle' ? paddle : mock;
}

export const providerByName = (n: string): PaymentProvider | null =>
  n === 'stripe' ? stripe : n === 'paddle' ? paddle : n === 'mock' ? mock : null;

/**
 * Webhook fulfilment in ONE transaction: mark paid → inventory (or gift pod) → ledger → feed event.
 * Idempotent: a replayed or out-of-order webhook never double-grants.
 */
export async function fulfillOrder(
  db: Db,
  provider: string,
  sessionId: string,
  orderId: string | null,
): Promise<'granted' | 'duplicate' | 'unknown'> {
  const result = await db.tx(async (q) => {
    const [o] = await q.query<{ id: string; status: string; buyer_id: number; recipient_id: number; item_id: string }>(
      `select id, status, buyer_id, recipient_id, item_id from orders
       where provider = $1 and (provider_session_id = $2 or id::text = $3) for update`,
      [provider, sessionId, orderId ?? ''],
    );
    if (!o) return { r: 'unknown' as const };
    if (o.status === 'paid' || o.status === 'refunded') return { r: 'duplicate' as const };
    await q.query(
      `update orders set status = 'paid', paid_at = now(), provider_session_id = coalesce(provider_session_id, $2) where id = $1`,
      [o.id, sessionId],
    );
    const gift = o.buyer_id !== o.recipient_id;
    if (gift) {
      const [claimed] = await q.query('select 1 from accounts where github_id = $1', [o.recipient_id]);
      const [g] = await q.query<{ anonymous: boolean }>('select anonymous from gifts where order_id = $1', [o.id]);
      if (!g) {
        await q.query(
          `insert into gifts (order_id, from_id, to_id, state, expires_at) values ($1, $2, $3, $4, now() + interval '90 days')`,
          [o.id, o.buyer_id, o.recipient_id, claimed ? 'delivered' : 'pending'],
        );
      } else {
        await q.query(`update gifts set state = $2 where order_id = $1`, [o.id, claimed ? 'delivered' : 'pending']);
      }
    } else {
      await q.query(
        `insert into inventory (owner_id, item_id, source, order_id) values ($1, $2, 'purchase', $3)
         on conflict (owner_id, item_id) where revoked_at is null do nothing`,
        [o.buyer_id, o.item_id, o.id],
      );
    }
    await q.query(
      `insert into stardust_ledger (github_id, delta, reason, ref_id) select $1, 0, 'purchase', $2
       where exists (select 1 from accounts where github_id = $1) on conflict do nothing`,
      [o.buyer_id, o.id],
    );
    return { r: 'granted' as const, o, gift };
  });
  if (result.r === 'granted') {
    const { o, gift } = result;
    await emitEvent(db, { type: 'order_paid', actorId: o.buyer_id, payload: { itemId: o.item_id, gift }, visibility: 'private' });
    await notify(db, o.buyer_id, 'order_paid', { itemId: o.item_id, gift });
    if (gift) {
      const [g] = await db.query<{ anonymous: boolean }>('select anonymous from gifts where order_id = $1', [o.id]);
      await notify(db, o.recipient_id, 'gift_received', { itemId: o.item_id, from: g?.anonymous ? null : o.buyer_id });
    }
    log.info({ order: o.id, item: o.item_id }, 'order fulfilled');
  }
  return result.r;
}

/** Admin refund: provider refund → revoke (unequip) → ledger reversal. */
export async function refundOrderAdmin(db: Db, orderId: string): Promise<void> {
  const [o] = await db.query<{
    id: string;
    provider: string;
    provider_session_id: string | null;
    status: string;
    buyer_id: number;
    recipient_id: number;
    item_id: string;
  }>('select id, provider, provider_session_id, status, buyer_id, recipient_id, item_id from orders where id = $1', [orderId]);
  if (!o || o.status !== 'paid') throw new Error('order is not refundable');
  const provider = providerByName(o.provider);
  if (provider && o.provider_session_id) await provider.refund(o.provider_session_id, o.id);
  await markRefunded(db, o.id);
}

export async function markRefunded(db: Db, orderId: string): Promise<void> {
  await db.tx(async (q) => {
    const [o] = await q.query<{ buyer_id: number; status: string }>('select buyer_id, status from orders where id = $1 for update', [
      orderId,
    ]);
    if (!o || o.status === 'refunded') return;
    await q.query(`update orders set status = 'refunded', refunded_at = now() where id = $1`, [orderId]);
    const revoked = await q.query<{ id: string }>(
      `update inventory set revoked_at = now() where order_id = $1 and revoked_at is null returning id`,
      [orderId],
    );
    for (const r of revoked) await q.query('delete from equipped where inventory_id = $1', [r.id]);
    await q.query(`update gifts set state = 'refunded' where order_id = $1`, [orderId]);
    await q.query(
      `insert into stardust_ledger (github_id, delta, reason, ref_id) select $1, 0, 'refund', $2
       where exists (select 1 from accounts where github_id = $1) on conflict do nothing`,
      [o.buyer_id, orderId],
    );
  });
}
