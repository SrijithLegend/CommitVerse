/**
 * Local-mode payment simulator: signs a "webhook" exactly like a provider would and posts it to /api/v1/webhooks/mock,
 * so the real fulfilment path (verify → one transaction → grant) runs end-to-end. A plain form POST + 303 so it also
 * works before hydration. Refused outside local mode.
 */
import { createHmac } from 'node:crypto';
import { env, localMode } from '@/lib/server/app';
import { MOCK_SECRET } from '@/lib/server/payments';

export async function POST(req: Request) {
  if (!localMode()) return new Response('Not found', { status: 404 });
  const form = await req.formData();
  const orderId = String(form.get('order'));
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return new Response('Bad order', { status: 400 });
  const outcome = form.get('outcome') === 'fail' ? 'failed' : 'paid';
  const raw = JSON.stringify({ type: outcome, orderId });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', MOCK_SECRET()).update(`${t}.${raw}`).digest('hex');
  await fetch(`${env().APP_URL}/api/v1/webhooks/mock`, {
    method: 'POST',
    body: raw,
    headers: { 'x-mock-timestamp': String(t), 'x-mock-signature': sig },
  });
  const to = new URL(`/shop?order=${orderId}&status=${outcome === 'paid' ? 'success' : 'cancelled'}`, env().APP_URL);
  return Response.redirect(to, 303);
}
