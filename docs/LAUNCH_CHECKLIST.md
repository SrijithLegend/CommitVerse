# Launch checklist (spec Appendix E + release gates)

Status: **DONE** · **BLOCKED — credential required** · **BLOCKED — physical device required** ·
**BLOCKED — external approval required** · **NOT APPLICABLE**. Last reviewed 2026-09-27.

## Appendix E

| # | Item | Status | What's left |
|---|---|---|---|
| E1 | Domain, email and social handles secured under the final name | **BLOCKED — external approval required** | Buy the domain. The spec says "check before buying". The code already assumes **`commitverse.dev`** in 5 places: extension default `baseUrl` (`packages/vscode-extension/package.json` + `src/extension.ts`), worker default `EMAIL_FROM` (`apps/worker/src/services.ts`), `support@`/`privacy@` on `/legal/refunds` and `/legal/privacy`, and problem-type URIs (`apps/web/lib/server/errors.ts`). If the final domain differs, change those before launch. Set up `support@` and `privacy@` mailboxes: the legal pages promise them. |
| E2 | Seed: top ~50k developers pre-materialized | **BLOCKED — credential required** (GitHub App + production DB) | Tooling DONE: `DATABASE_URL=<prod direct> pnpm --filter @commitverse/worker exec tsx src/cli.ts enqueue logins.txt` queues a list at priority 10; the worker drains it within the GitHub budget guard. At about 5,000 points/h per App installation, 50k users takes days: start at least a week before launch. |
| E3 | Your own and friends' stars claimed and customized | **BLOCKED — credential required** | After the production deploy: sign in with GitHub, claim, equip cosmetics. |
| E4 | OG images and share cards verified on X, LinkedIn, Discord, WhatsApp | **BLOCKED — credential required** (needs a public production URL) | Code DONE: `/api/og/[login]` (E2E-tested: PNG), site-wide `public/opengraph.png`. Check with each platform's validator/preview once live. |
| E5 | Budget guard + queue UX tested under a synthetic flood | **BLOCKED — credential required** (staging) | Script DONE: the `materialize` scenario in `perf/k6-api.js` (must never 5xx). Run it against staging. |
| E6 | Kill switches verified | **PARTIAL** | Code paths exist for `kill.comets/multiplayer/shop/materialize`, and `materialize` returns 503 when killed. Flip each one in the staging admin console and watch the UI degrade. |
| E7 | Legal pages live; opt-out flow tested end to end | **DONE (local)** / **BLOCKED — credential required** (production) | E2E `remove my star → 410 Gone, and it cannot re-form` passes against local mode. Repeat once in production with a test account. |
| E8 | Launch posts (Show HN, r/webdev, r/threejs, X/LinkedIn) + 20-second flight video | **BLOCKED — external approval required** | Owner's call and accounts. Record the video from production (`/?tour=1` cinematic, or `/bench` at 1080p60 on a discrete GPU). |
| E9 | On-call for launch day: dashboards open, runbooks printed | **PARTIAL** | Runbooks DONE (`docs/runbooks/`: bake failure, GitHub budget, payment webhooks, realtime outage, data removal, deploy/rollback/release). Dashboards need Sentry/PostHog projects (credential required). |

## Release gates (beyond Appendix E)

| Gate | Status | Evidence / what's left |
|---|---|---|
| Typecheck, lint, unit + integration tests | **DONE** | See the release report / CI `check` job |
| Browser E2E (desktop + mobile) | **PARTIAL: confirm on CI** | 18/18 passed locally on 2026-09-27 before the final change (a server-only import move, since verified by typecheck, build, unit tests and route probes). Later local runs on the same laptop after it suspended ran about 2.5× slower and timed out waiting for SwiftShader frames (11/18). The CI `e2e` job on a clean runner is the arbiter, and deploys are gated on it. |
| Visual regression baselines | **BLOCKED — credential required** (push → CI) | Freeze-mode determinism verified locally (win32 baselines generate and re-compare clean). Linux baselines come from the first CI run's `visual-baselines` artifact; commit them to `apps/web/e2e/visual.spec.ts-snapshots/`. |
| Bundle budget | **DONE** | 162.1 KB / 180 KB |
| Client-bundle secret scan | **DONE** | No server secret names in `.next/static` |
| Staging deploy + k6 + WS load | **BLOCKED — credential required** | `docs/deployment.md`, `perf/RESULTS.md` |
| Real-device performance | **BLOCKED — physical device required** (phone); laptop PARTIAL | `perf/RESULTS.md` |
| Payments: sandbox purchase + refund end to end | **BLOCKED — credential required** | Mock provider E2E + webhook integration tests pass (signature, replay, out-of-order, refund revokes). Needs Stripe test keys or a Paddle sandbox. |
| Live purchase + refund | **BLOCKED — credential required** | After sandbox passes |
| VS Code Marketplace listing | **BLOCKED — credential required** (`VSCE_PAT`, publisher `commitverse`) | Packaging DONE: `vsce package` clean, VSIX installs into a clean VS Code 1.138 profile |
| Production deploy + smoke test | **BLOCKED — credential required** | `docs/deployment.md` → "Verifying a deploy" |
| Turnstile challenge widget | **NOT APPLICABLE for launch** (keep keys unset) | Server verification exists; no client widget. IP limits cover abuse until then. |
