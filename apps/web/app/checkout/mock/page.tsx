/**
 * Local-mode payment simulator. It signs a "webhook" exactly like a provider would and posts it to
 * /api/v1/webhooks/mock — so the real fulfilment path (verify → one transaction → grant) is exercised end-to-end.
 * Refused outside local mode.
 */
import { createHmac } from 'node:crypto';
import { notFound, redirect } from 'next/navigation';
import { db, env, localMode } from '@/lib/server/app';
import { MOCK_SECRET } from '@/lib/server/payments';

async function complete(formData: FormData) {
  'use server';
  if (!localMode()) notFound();
  const orderId = String(formData.get('order'));
  const outcome = formData.get('outcome') === 'fail' ? 'failed' : 'paid';
  const raw = JSON.stringify({ type: outcome, orderId });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', MOCK_SECRET()).update(`${t}.${raw}`).digest('hex');
  await fetch(`${env().APP_URL}/api/v1/webhooks/mock`, { method: 'POST', body: raw, headers: { 'x-mock-timestamp': String(t), 'x-mock-signature': sig } });
  redirect(`/shop?order=${orderId}&status=${outcome === 'paid' ? 'success' : 'cancelled'}`);
}

export default async function MockCheckout({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  if (!localMode()) notFound();
  const { order } = await searchParams;
  const [o] = order && /^[0-9a-f-]{36}$/.test(order)
    ? await (await db()).query<{ id: string; item_id: string; amount_minor: number; currency: string; status: string }>('select id, item_id, amount_minor, currency, status from orders where id = $1', [order])
    : [];
  if (!o) notFound();
  return (
    <div className="pointer-events-auto flex min-h-dvh items-center justify-center px-4">
      <form action={complete} className="glass w-full max-w-sm p-6">
        <div className="label">Test checkout · local mode</div>
        <h1 className="mt-1 text-lg font-semibold text-[var(--ink-1)]">{o.item_id}</h1>
        <p className="mt-1 font-mono text-sm text-[var(--ink-2)]">
          {(o.amount_minor / 100).toFixed(2)} {o.currency} · {o.status}
        </p>
        <input type="hidden" name="order" value={o.id} />
        <div className="mt-5 flex gap-2">
          <button type="submit" name="outcome" value="pay" className="h-10 flex-1 rounded-[10px] bg-[var(--accent)] text-sm font-medium text-[var(--space-0)]">
            Pay (test)
          </button>
          <button type="submit" name="outcome" value="fail" className="h-10 flex-1 rounded-[10px] border border-[var(--panel-border)] text-sm text-[var(--ink-2)]">
            Decline
          </button>
        </div>
        <p className="mt-4 text-[11px] text-[var(--ink-3)]">No money moves. Production uses Stripe Checkout or Paddle.</p>
      </form>
    </div>
  );
}
