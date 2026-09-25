/** Worker-side integrations: Resend email and provider refunds for expired gifts. */
import type { Db } from '@commitverse/db';
import { log } from '@commitverse/pipeline';

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? 'Commitverse <stars@commitverse.dev>', to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
}

/** Refunds the order at the provider, then records the reversal (gift expiry, §F8). */
export async function refundOrder(db: Db, orderId: string): Promise<void> {
  const [o] = await db.query<{ provider: string; provider_session_id: string | null; status: string }>(
    'select provider, provider_session_id, status from orders where id = $1',
    [orderId],
  );
  if (!o || o.status !== 'paid') return;
  if (o.provider === 'stripe' && process.env.STRIPE_SECRET_KEY && o.provider_session_id) {
    const auth = { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` };
    const session = (await (
      await fetch(`https://api.stripe.com/v1/checkout/sessions/${o.provider_session_id}`, { headers: auth })
    ).json()) as {
      payment_intent?: string;
    };
    if (session.payment_intent) {
      const res = await fetch('https://api.stripe.com/v1/refunds', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': `refund-${orderId}` },
        body: new URLSearchParams({ payment_intent: session.payment_intent }),
      });
      if (!res.ok) throw new Error(`Stripe refund ${res.status}`);
    }
  } else if (o.provider === 'paddle' && process.env.PADDLE_API_KEY && o.provider_session_id) {
    const base = process.env.PADDLE_ENV === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
    const res = await fetch(`${base}/adjustments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.PADDLE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'refund', transaction_id: o.provider_session_id, reason: 'Gift expired unclaimed', type: 'full' }),
    });
    if (!res.ok) throw new Error(`Paddle refund ${res.status}`);
  }
  await db.tx(async (q) => {
    await q.query(`update orders set status = 'refunded', refunded_at = now() where id = $1 and status = 'paid'`, [orderId]);
    await q.query(`update gifts set state = 'refunded' where order_id = $1`, [orderId]);
  });
  log.info({ order: orderId }, 'expired gift refunded');
}
