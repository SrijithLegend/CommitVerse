# Commitverse

A real-time, explorable 3D universe generated from public GitHub data. Every developer is a star, every repo a planet,
every language a galaxy. Not affiliated with or endorsed by GitHub, Inc.

## Quick start (zero config)

```sh
pnpm install
pnpm dev            # http://localhost:3000
```

Local mode needs no accounts or keys. It runs an embedded Postgres (PGlite, under `.data/`), seeds and bakes a synthetic
universe of 20,000 stars on first boot (`LOCAL_SEED_COUNT` changes the size), stores tiles on disk, and swaps in dev
sign-in (`/auth/dev`) and mock payments. Set `GITHUB_TOKEN` to materialize real users.

## Commands

| | |
|---|---|
| `pnpm test` | Unit, golden, determinism and integration tests (Vitest) |
| `pnpm typecheck` / `pnpm lint` | TypeScript strict / Biome |
| `pnpm build` | Production build (`SKIP_ENV_VALIDATION=1` for CI builds without secrets) |
| `pnpm --filter @commitverse/web e2e` | Playwright E2E + axe + cosmetic integrity, against local mode |
| `node scripts/check-bundle-size.mjs` | §12 bundle budgets (after a build) |
| `pnpm seed [n]` / `pnpm bake` | Synthetic universe / run a bake now |
| `pnpm --filter @commitverse/worker exec tsx src/cli.ts rollback <version>` | Roll back to a previous bake |

## Layout

```
apps/web          Next.js app: pages, /api/v1, 3D client (scene/), HUD (ui/)
apps/worker       pg-boss jobs: materialize, refresh, bake, delta, achievements, notify (Fly)
apps/realtime     Cloudflare Worker + per-sector Durable Objects (multiplayer presence)
packages/universe-core   formulas, placement, octree, tile codec (golden-tested; the spec's source of truth)
packages/pipeline        GitHub fetch, ingest, bake (Node only; authoritative placement)
packages/contracts       Zod schemas + env validation · packages/db  Postgres/PGlite + migrations
packages/shaders · achievements · embed · ui-kit · vscode-extension (Beacon)
supabase/migrations      forward-only SQL · perf/  load tests + results · docs/runbooks  on-call
```

## Production

1. Copy `.env.example` into your hosting providers' secret stores. With `NODE_ENV=production` the app refuses to boot if
   anything marked `[required]` is missing.
2. Infrastructure: Supabase (Postgres + Auth with GitHub OAuth), a GitHub App (webhooks → `/api/v1/webhooks/github`),
   Cloudflare R2 for tiles, Upstash Redis, Stripe or Paddle, Fly for `apps/worker` (`apps/worker/fly.toml`, 4 GB for 1M
   stars) and Cloudflare for `apps/realtime` (`wrangler secret put REALTIME_SHARED_SECRET`).
3. CI (`.github/workflows/ci.yml`) runs checks and E2E on every PR. On `main` it migrates, deploys web, worker and
   realtime, runs smoke tests and tags a Sentry release. Each deploy step is skipped until its secrets exist. Pushing a
   `v*` tag publishes the Beacon extension (`release.yml`).
4. Before launch, work through the checklist in spec Appendix E. Record real-device numbers in `perf/RESULTS.md`. Keep
   `docs/runbooks/` open on launch day.

Kill switches (Admin → Flags): `kill.comets`, `kill.multiplayer`, `kill.shop`, `kill.materialize`.
