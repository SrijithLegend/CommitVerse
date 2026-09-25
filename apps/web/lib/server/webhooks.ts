/** Shared payment-webhook handling: verify with the raw body → idempotent fulfilment → alert after 3 failures. */
import 'server-only';
import { log } from '@commitverse/pipeline';
import { json } from './api';
import { db } from './app';
import { problem } from './errors';
import { fulfillOrder, markRefunded, providerByName, WebhookSignatureError } from './payments';

export async function handlePaymentWebhook(providerName: 'stripe' | 'paddle' | 'mock', req: Request): Promise<Response> {
  const provider = providerByName(providerName)!;
  const raw = await req.text();
  const d = await db();
  let outcome: ReturnType<typeof provider.verifyWebhook>;
  try {
    outcome = provider.verifyWebhook(raw, req.headers);
  } catch (err) {
    if (err instanceof WebhookSignatureError) return problem(400, 'bad_signature', err.message);
    throw err;
  }
  const deliveryId =
    req.headers.get('stripe-signature')?.slice(0, 64) ?? req.headers.get('paddle-signature')?.slice(0, 64) ?? `${Date.now()}`;
  try {
    if (outcome.kind === 'paid') await fulfillOrder(d, providerName, outcome.sessionId, outcome.orderId);
    else if (outcome.kind === 'failed' || outcome.kind === 'expired') {
      await d.query(
        `update orders set status = $3 where provider = $1 and (provider_session_id = $2 or id::text = $4) and status = 'pending'`,
        [providerName, outcome.sessionId, outcome.kind, outcome.orderId ?? ''],
      );
    } else if (outcome.kind === 'refunded') {
      const [o] = await d.query<{ id: string }>(
        `select id from orders where provider = $1 and (provider_session_id = $2 or id::text = $3)`,
        [providerName, outcome.sessionId, outcome.orderId ?? ''],
      );
      if (o) await markRefunded(d, o.id);
    }
    await d.query(
      `insert into webhook_deliveries (provider, delivery_id, processed_at) values ($1, $2, now())
       on conflict (provider, delivery_id) do update set processed_at = now(), attempts = webhook_deliveries.attempts + 1`,
      [providerName, deliveryId],
    );
    return json({ received: true });
  } catch (err) {
    const [row] = await d.query<{ attempts: number }>(
      `insert into webhook_deliveries (provider, delivery_id, last_error) values ($1, $2, $3)
       on conflict (provider, delivery_id) do update set attempts = webhook_deliveries.attempts + 1, last_error = excluded.last_error
       returning attempts`,
      [providerName, deliveryId, String(err)],
    );
    if ((row?.attempts ?? 1) >= 3)
      log.error({ alert: 'webhook_failure', provider: providerName, attempts: row?.attempts, err: String(err) }, 'payment webhook failing');
    return problem(500, 'webhook_failed', 'Processing failed; the provider will retry');
  }
}
