# Runbook — Payment webhook outage

**Alert:** `webhook failure ×3`, `payment success rate` drop, or `ledger mismatch`.
**Impact:** buyers are charged but items aren't granted, or refunds aren't revoked.

## How it's built (why recovery is safe)
- Items are granted **only** from verified provider webhooks (`/api/v1/webhooks/{stripe,paddle}`), never from the
  checkout redirect.
- Webhooks are idempotent: `payment_events(provider, event_id)` is unique, so replays and duplicate deliveries are
  no-ops. Out-of-order events are handled (a refund that arrives before the paid event still ends up revoked).
- Providers retry for days (Stripe: up to 3 days). An outage of a few hours usually recovers on its own once we're up.

## 1. Triage
1. Provider dashboard → Webhooks → recent deliveries. Check the HTTP status we returned.
   - `400 signature` means the secret was rotated or is wrong: check `STRIPE_WEBHOOK_SECRET` / `PADDLE_WEBHOOK_SECRET`
     in Vercel and redeploy.
   - `5xx` means our bug or a DB outage: Sentry → filter `route:/api/v1/webhooks/*`.
   - Timeouts mean the DB is slow: check Supabase health.
2. Find paid orders that were never granted:
   ```sql
   select o.id, o.provider_ref, o.created_at from orders o
   left join inventory i on i.order_id = o.id
   where o.status = 'pending' and o.created_at < now() - interval '15 min';
   ```

## 2. Mitigate
- **Kill the shop** while it's broken so nobody else pays for an item that won't arrive: Admin → Flags →
  `kill.shop` = on.
- Fix the root cause (secret, deploy rollback via Vercel "Promote previous deployment", or DB).
- **Replay**: provider dashboard → resend the failed events. They're idempotent, so resending all of them is safe.
- A paid order with no item, once confirmed paid in the provider dashboard: Admin → Orders → **Re-grant**.

## 3. Verify
- The query above returns 0 rows.
- The ledger check passes (Admin → Overview → ledger mismatch = 0).
- Turn `kill.shop` off. Make one test purchase in provider test mode on staging.

## 4. Communicate
Email affected buyers (Admin → Orders shows them). Offer a refund if the grant was delayed more than 24 h.
