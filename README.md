# Commitverse

A real-time, explorable 3D universe generated from public GitHub data. Every developer is a star, every repo a planet,
every language a galaxy. Not affiliated with or endorsed by GitHub, Inc.

**Status:** feature-complete through milestone M8, green locally, **not yet deployed**. Production validation
(staging, load tests, sandbox payments, Marketplace, real devices) is tracked in
[`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md).

## Architecture

```
apps/web          Next.js (Vercel): pages, /api/v1, OG images, README embeds, 3D client (scene/), HUD (ui/)
apps/worker       pg-boss jobs on Fly: materialize, refresh, bake, delta, achievements, notify, GH Archive ingest
apps/realtime     Cloudflare Worker + one Durable Object per sector (multiplayer presence, HMAC join tokens)
packages/universe-core   formulas, placement, octree, tile codec (golden-tested; must match the spec)
packages/pipeline        GitHub fetch, ingest, bake. Node only: authoritative placement never runs in browsers
packages/contracts       Zod schemas + env validation · packages/db  Postgres / PGlite + migrations
packages/shaders · achievements · embed · ui-kit · vscode-extension (Beacon)
supabase/migrations      forward-only SQL + RLS · perf/  load tests + results · docs/  deployment, runbooks, checklist
```

Data: Supabase Postgres. Tiles: Cloudflare R2 (immutable, versioned). Rate limits: Upstash Redis. Payments: Stripe
or Paddle.

## Local development (zero config)

Requires Node ≥ 22 and pnpm (version pinned in `package.json` → `packageManager`; `corepack enable`).

```sh
pnpm install
pnpm dev            # http://localhost:3000
```

Local mode needs no accounts or keys. It runs an embedded Postgres (PGlite, under `.data/`), seeds and bakes a synthetic
universe of 20,000 stars on first boot (`LOCAL_SEED_COUNT` changes the size), keeps tiles on disk, and uses dev sign-in
(`/auth/dev`) and mock payments. Set `GITHUB_TOKEN` to materialize real users. Delete `.data/` to start fresh.

## Commands

| Command | What |
|---|---|
| `pnpm typecheck` / `pnpm lint` | TypeScript strict / Biome |
| `pnpm test` | Unit, formula goldens, determinism, DB/RLS, payments/economy integration, realtime tokens (Vitest) |
| `pnpm --filter @commitverse/web e2e --project=desktop --project=mobile` | Playwright: flows, security headers, axe, cosmetic integrity (starts `pnpm dev`) |
| `pnpm --filter @commitverse/web e2e --project=visual` | Visual regression (`?freeze=1` deterministic frames; `--update-snapshots` to rebaseline) |
| `SKIP_ENV_VALIDATION=1 pnpm build` | Production build without secrets (as CI does) |
| `node scripts/check-bundle-size.mjs` | §12 bundle budgets (after a build): landing ≤ 180 KB, 3D chunk ≤ 650 KB gzip |
| `pnpm --filter @commitverse/web bench [url] [tier]` | Scripted `/bench` flight in real Chrome → JSON for `perf/RESULTS.md` |
| `pnpm --filter @commitverse/web poster [url]` | Re-render `public/poster.avif` + `public/opengraph.png` from the app |
| `pnpm seed [n]` / `pnpm bake` | Synthetic universe / run a bake now |
| `pnpm --filter @commitverse/worker exec tsx src/cli.ts <cmd>` | Operator CLI: `migrate`, `materialize <login>`, `enqueue <file>`, `rollback <version>` |

Load tests (`perf/k6-api.js`, `perf/ws-sector.mjs`) run against **staging only**. See `perf/RESULTS.md`.

E2E tips: WebGL runs on SwiftShader (CPU) by default, as in CI. On a throttled laptop, set `E2E_GPU=1` to run the same
tests on the local GPU (never for `--project=visual`). If nested API routes suddenly 404 in `pnpm dev` (e.g. after the
machine sleeps), Turbopack's dev cache is stale: stop the server and delete `apps/web/.next/dev`.

## Deploy and release

- **Deployment:** [`docs/deployment.md`](docs/deployment.md) has the environment/secret matrix, first-time setup click
  paths and the order of operations. Copy `.env.example` into each host's secret store. With `NODE_ENV=production`,
  the web app and worker refuse to boot if anything marked `[required]` is missing.
- **CI/CD** (`.github/workflows/ci.yml`): every PR runs checks, build, bundle budget, secret-in-bundle grep, E2E and
  visual regression. `main` deploys Supabase migrations → Fly worker → Vercel web → Cloudflare realtime, then runs
  smoke tests and tags a Sentry release. Each deploy step skips until its secrets exist. Deploys never run for pull
  requests.
- **Extension:** push a `v*` tag → `release.yml` tests, packages and publishes Beacon to the VS Code Marketplace
  (`VSCE_PAT`).
- **Runbooks** ([`docs/runbooks/`](docs/runbooks)): deploy/rollback/release, bake failure, GitHub budget exhaustion,
  payment webhook outage, realtime outage, data-removal requests. Kill switches (Admin → Flags): `kill.comets`,
  `kill.multiplayer`, `kill.shop`, `kill.materialize`.

## Known limitations

- **Turnstile:** the server verifies challenge tokens, but no client widget ships yet. Keep `TURNSTILE_*` unset (IP rate
  limits apply). Setting the secret would block users after 3 lookups.
- **Domain:** code and legal pages assume `commitverse.dev`, which hasn't been bought yet. See the checklist (E1).
- **Visual baselines:** only generated locally (Windows) so far. Linux baselines come from the first CI run's
  `visual-baselines` artifact and must be committed to arm the check. O- and B-class shots skip when no such star is in
  the top 50.
- **Performance:** only bundle budgets are verified. The FPS/LCP/API budgets in `perf/RESULTS.md` still need a production
  build on reference hardware, a real phone and a staging environment.
- **Census/achievement aggregates** are cached per server instance for 1 h (not shared), which is fine at launch scale.
