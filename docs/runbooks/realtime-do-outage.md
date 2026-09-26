# Runbook — Realtime (Durable Object) outage

**Alert:** DO connection count drops to ~0, WebSocket error rate spikes, or Cloudflare incident.
**Impact:** other explorers' ships and emotes disappear. **Everything else works.** Comets and the feed come over
SSE from the web app (`/api/v1/live`), not the DO. The client degrades silently and retries with backoff.

## 1. Triage
1. `curl -s https://$REALTIME_HOST/healthz` should return `ok`.
2. `pnpm --filter @commitverse/realtime exec wrangler tail` for live errors.
3. Cloudflare status page (Workers / Durable Objects).
4. All joins get `403`? Then the sector tokens don't verify: `REALTIME_SHARED_SECRET` differs between Vercel
   (signer) and the Worker (verifier). Compare them and reset both from one value:
   `wrangler secret put REALTIME_SHARED_SECRET`, then update Vercel and redeploy.

## 2. Mitigate
- **Kill multiplayer** so clients stop reconnect loops and the UI stops showing "connecting…":
  Admin → Flags → `kill.multiplayer` = on. The flag is broadcast to clients over SSE.
- Bad deploy: `wrangler rollback` (lists recent versions; pick the last good one).
- Cost runaway (DO duration billing): make sure the 5 Hz tick stops when a sector empties (`alarm()` returns early
  with no sockets). Kill multiplayer until fixed.

## 3. Verify
- Run the smoke test: `RT=wss://$REALTIME_HOST node apps/realtime/test/smoke.mjs` should print
  `snapshot ok` and `forged token: rejected`.
- Turn `kill.multiplayer` off, then open two browsers in the same galaxy and check that the ships appear.
