/** Local-mode test checkout page; the form posts to ./complete (see route.ts there). Refused outside local mode. */
import { notFound } from 'next/navigation';
import { db, localMode } from '@/lib/server/app';

export default async function MockCheckout({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  if (!localMode()) notFound();
  const { order } = await searchParams;
  const [o] =
    order && /^[0-9a-f-]{36}$/.test(order)
      ? await (await db()).query<{ id: string; item_id: string; amount_minor: number; currency: string; status: string }>(
          'select id, item_id, amount_minor, currency, status from orders where id = $1',
          [order],
        )
      : [];
  if (!o) notFound();
  return (
    <div className="pointer-events-auto flex min-h-dvh items-center justify-center px-4">
      <form action="/checkout/mock/complete" method="post" className="glass w-full max-w-sm p-6">
        <div className="label">Test checkout · local mode</div>
        <h1 className="mt-1 text-lg font-semibold text-[var(--ink-1)]">{o.item_id}</h1>
        <p className="mt-1 font-mono text-sm text-[var(--ink-2)]">
          {(o.amount_minor / 100).toFixed(2)} {o.currency} · {o.status}
        </p>
        <input type="hidden" name="order" value={o.id} />
        <div className="mt-5 flex gap-2">
          <button
            type="submit"
            name="outcome"
            value="pay"
            className="h-10 flex-1 rounded-[10px] bg-[var(--accent)] text-sm font-medium text-[var(--space-0)]"
          >
            Pay (test)
          </button>
          <button
            type="submit"
            name="outcome"
            value="fail"
            className="h-10 flex-1 rounded-[10px] border border-[var(--panel-border)] text-sm text-[var(--ink-2)]"
          >
            Decline
          </button>
        </div>
        <p className="mt-4 text-[11px] text-[var(--ink-3)]">No money moves. Production uses Stripe Checkout or Paddle.</p>
      </form>
    </div>
  );
}
