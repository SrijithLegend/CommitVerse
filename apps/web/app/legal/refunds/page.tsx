import type { Metadata } from 'next';
import { PageShell } from '@/ui/PageShell';
import { SceneIntent } from '@/ui/SceneIntent';

export const metadata: Metadata = { title: 'Refund policy' };

export default function Refunds() {
  return (
    <PageShell title="Refund policy" kicker="Last updated 2026-09-26">
      <SceneIntent intent={{ type: 'dim' }} dim />
      <article className="glass prose-cv p-6">
        <ul>
          <li>
            Premium items can be refunded within 14 days of purchase if they have not been equipped. Contact support@commitverse.dev with
            your order id.
          </li>
          <li>
            Gifts bought for an unclaimed star are held for 90 days; if the star isn’t claimed in time, the gift is refunded automatically
            to the original payment method.
          </li>
          <li>If you remove your star, unused (never equipped) premium items bought in the previous 14 days are refunded on request.</li>
          <li>Refunded items are removed from your inventory and unequipped. The reversal is recorded in your account history.</li>
          <li>Stardust has no monetary value and is never refundable.</li>
          <li>
            Where our payment provider acts as Merchant of Record (e.g. Paddle), its buyer terms also apply and taxes are refunded by the
            provider.
          </li>
        </ul>
      </article>
    </PageShell>
  );
}
