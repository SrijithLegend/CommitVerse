# Deployment

Four targets, deployed by `.github/workflows/ci.yml` on every push to `main` once `check` and `e2e` pass. Each deploy
step skips cleanly until its credentials exist, so CI stays green on a fork or a fresh repo.

| Target | What | How CI deploys it |
|---|---|---|
| Supabase | Postgres, Auth (GitHub OAuth), migrations | `supabase db push --db-url $SUPABASE_DB_URL` (forward-only `supabase/migrations/*.sql`) |
| Vercel | `apps/web` (Next.js: pages, `/api/v1`, OG, embeds) | `vercel pull/build/deploy --prebuilt --prod` |
| Fly.io | `apps/worker` (pg-boss jobs: materialize, refresh, bake, delta) | `flyctl deploy . --config apps/worker/fly.toml` |
| Cloudflare | `apps/realtime` (Worker + Durable Objects, multiplayer) | `wrangler deploy` |

**Order matters on the first deploy:** Supabase migrations → worker (it installs the pg-boss schema; the web app is a
send-only queue client and does not) → web → realtime. CI runs them in that order.

**One migration path.** CI uses `supabase db push`. `pnpm --filter @commitverse/worker migrate` exists for non-Supabase
Postgres. Never run both against the same database: they record applied migrations in different tables. The first
`supabase db push` has not been run yet. Validate it against staging before production.

## Environment and secret matrix

Legend: **S** secret · **P** public (shipped to browsers) · **C** deployment credential (GitHub Actions only).
`.env.example` has the same list with inline notes. Production refuses to boot when a `[required]` variable is missing
(`packages/contracts/src/env.ts`, covered by `packages/contracts/test/env.test.ts`). The worker runs the same check, so it's
not enough to give Fly only what the worker reads: every `[required]` variable must be set on **both** Vercel and Fly.

| Variable | Purpose | Local | CI | Vercel (web) | Fly (worker) | Cloudflare | Type |
|---|---|---|---|---|---|---|---|
| `APP_URL` | Public origin (OG URLs, sitemap, redirects) | – | – | ✔ | ✔ | – | config |
| `DATABASE_URL` | Postgres. **Web: pooler :6543 (transaction mode). Worker: direct :5432** | – | – | ✔ | ✔ | – | S |
| `DB_POOL_MAX` | Connections per instance (web 1–3, worker 10) | – | – | ✔ (2) | opt | – | config |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser auth client (the worker validates them too) | – | – | ✔ | ✔ | – | P |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server writes | – | – | ✔ | ✔ | – | S |
| `SESSION_SECRET` | Signing (sessions, mock/test signatures) | – | – | ✔ | ✔ | – | S |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_INSTALLATION_ID` | App token for GitHub fetches | – | – | ✔ | ✔ | – | S |
| `GITHUB_WEBHOOK_SECRET` | Verifies GitHub App webhooks | – | – | ✔ | ✔ | – | S |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | Sign-in (entered in **Supabase Auth → GitHub**, not in env) | – | – | – | – | – | S |
| `GITHUB_TOKEN` | Local dev only: materialize real users | opt | – | ✗ | ✗ | – | S |
| `TOKEN_ENC_ACTIVE_KID` + `TOKEN_ENC_KEY_<kid>` | Encrypts users' sync tokens | – | – | ✔ | ✔ | – | S |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Rate limits, leaderboards | – | – | ✔ | ✔ | – | S |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | Tile uploads | – | – | ✔ | ✔ | – | S |
| `NEXT_PUBLIC_TILES_BASE_URL` | Tile CDN origin | – | – | ✔ | ✔ | – | P |
| `NEXT_PUBLIC_REALTIME_URL` | Multiplayer WebSocket origin | – | – | ✔ | – | – | P |
| `REALTIME_SHARED_SECRET` | Signs sector-join tokens (web) / verifies them (Worker) | – | – | ✔ | – | ✔ (`wrangler secret`) | S |
| `PAYMENT_PROVIDER` | `stripe` or `paddle` (`mock` is refused in production) | – | – | ✔ | ✔ | – | config |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe | – | – | ✔ | ✔ | – | S |
| `PADDLE_API_KEY` / `PADDLE_WEBHOOK_SECRET` / `PADDLE_ENV` | Paddle | – | – | ✔ | ✔ | – | S |
| `RESEND_API_KEY` / `EMAIL_FROM` | Email | – | – | – | ✔ | – | S |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | **Leave unset**: no client widget ships yet (see Known limitations in the README) | – | – | ✗ | – | – | S |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Error reporting | – | – | ✔ | ✔ | – | P (DSNs are public by design) |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` | Analytics + RUM | – | – | ✔ | – | – | P |
| `ADMIN_GITHUB_LOGINS` | Admin allow-list (plus the DB role) | – | – | ✔ | – | – | config |
| `BAKE_CRON` / `LAUNCH_DATE` / `LOG_LEVEL` / `ARCHIVE_INGEST` | Operations | – | – | opt | opt | – | config |
| `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_URL` | Migrations from CI (`SUPABASE_DB_URL` = direct :5432) | – | ✔ | – | – | – | C |
| `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | Web deploy | – | ✔ | – | – | – | C |
| `FLY_API_TOKEN` | Worker deploy | – | ✔ | – | – | – | C |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | Realtime deploy | – | ✔ | – | – | – | C |
| `SENTRY_AUTH_TOKEN` | Releases / source maps | – | ✔ | – | – | – | C |
| `VSCE_PAT` | Publish the VS Code extension (`release.yml`) | – | ✔ | – | – | – | C |

Only `NEXT_PUBLIC_*` values reach the browser. CI fails the build if a server secret name shows up in
`apps/web/.next/static` (see "Secret-in-bundle grep" in `ci.yml`).

## First-time setup (click paths)

### 1. Supabase (make two projects: `commitverse-staging` and `commitverse-prod`)
1. supabase.com → New project. Save the database password in your password manager.
2. **Project Settings → Database → Connection string**:
   - "Direct connection" (port 5432) → `SUPABASE_DB_URL` (GitHub) and `DATABASE_URL` (Fly).
   - "Transaction pooler" (port 6543) → `DATABASE_URL` (Vercel).
3. **Project Settings → API**: URL → `NEXT_PUBLIC_SUPABASE_URL`; `anon` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
   `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only).
4. **Authentication → Providers → GitHub**: enable it. Paste the OAuth app's client ID and secret. Scope: `read:user`.
   **Authentication → URL Configuration**: Site URL = `APP_URL`; redirect URL = `APP_URL/auth/callback`.
5. supabase.com → Account → Access Tokens → `SUPABASE_ACCESS_TOKEN` (GitHub).

### 2. GitHub App + OAuth app
1. github.com → Settings → Developer settings → **GitHub Apps → New**. Permissions: read-only metadata. Webhook
   URL `APP_URL/api/v1/webhooks/github`, with a random secret → `GITHUB_WEBHOOK_SECRET`. Generate a private key →
   `GITHUB_APP_PRIVATE_KEY` (PEM, newlines as `\n`). App ID → `GITHUB_APP_ID`. Install it on your account; the ID in the
   installation URL → `GITHUB_APP_INSTALLATION_ID`.
2. **OAuth Apps → New**. Callback = `https://<supabase-project>.supabase.co/auth/v1/callback`. Client ID and secret go
   into Supabase (step 1.4).

### 3. Cloudflare (R2 + realtime)
1. R2 → Create bucket `commitverse-tiles`. Settings → Custom domain (e.g. `tiles.<your-domain>`) →
   `NEXT_PUBLIC_TILES_BASE_URL`. **R2 → Manage API tokens** → Object Read & Write → `R2_ACCESS_KEY_ID` /
   `R2_SECRET_ACCESS_KEY`. Account ID → `R2_ACCOUNT_ID` and `CLOUDFLARE_ACCOUNT_ID`.
2. My Profile → API Tokens → "Edit Cloudflare Workers" template → `CLOUDFLARE_API_TOKEN` (GitHub).
3. Generate the realtime secret once: `openssl rand -base64 48`. Then
   `pnpm --filter @commitverse/realtime exec wrangler secret put REALTIME_SHARED_SECRET` and paste the same value into
   Vercel's `REALTIME_SHARED_SECRET`. After the first deploy, attach a custom domain (Workers → commitverse-realtime →
   Settings → Domains) → `NEXT_PUBLIC_REALTIME_URL=wss://…`.

### 4. Upstash
console.upstash.com → Create Redis database (same region as Vercel) → REST URL/token → `UPSTASH_REDIS_REST_*`.

### 5. Fly.io
1. `fly auth login`, then `fly apps create commitverse-worker`.
2. `fly secrets set -a commitverse-worker DATABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… …`: every row with ✔ in the
   Fly column. Type values into the shell. Never commit them.
3. `fly tokens create deploy -a commitverse-worker` → `FLY_API_TOKEN` (GitHub).

### 6. Vercel
1. vercel.com → Add New → Project → import the repo. **Root Directory: `apps/web`.** Framework: Next.js.
   `apps/web/vercel.json` stops Git pushes to `main` from deploying (CI deploys production after tests). PR previews
   still build.
2. Settings → Environment Variables: every row with ✔ in the Vercel column, **Production** scope (repeat with staging
   values under **Preview**).
3. Account Settings → Tokens → `VERCEL_TOKEN`. Project Settings → General → Project ID → `VERCEL_PROJECT_ID`; team
   settings → Team ID → `VERCEL_ORG_ID`.
4. Settings → Domains → add the production domain.

### 7. GitHub repository
1. Settings → Environments → New environment `production`. Add required reviewers if you want a manual gate on deploys.
2. Settings → Secrets and variables → Actions → **Secrets**: every row with type **C**.
   **Variables**: `APP_URL`, `REALTIME_HTTP_URL` (the `https://` form of the realtime host), `SENTRY_ORG`,
   `SENTRY_PROJECT`.
3. Settings → Branches → protect `main`: require the `check` and `e2e` status checks.

## Staging first
Point a second set of the values above at `commitverse-staging`. Seed it with a synthetic 1M-star universe for load
testing: `DATABASE_URL=<staging direct> pnpm seed 1000000` (worker CLI; ~4 GB RAM). Run the load tests in
`perf/RESULTS.md` against staging. Never load-test production.

## Verifying a deploy
The `Smoke tests` step in CI checks `/api/v1/universe/current`, `/`, `/leaderboards` and realtime `/healthz`. Run the
same checks by hand after the first deploy, plus:
```sh
curl -sI "$APP_URL/" | grep -iE 'strict-transport|content-security|x-content-type'   # security headers
curl -s "$APP_URL/api/v1/stars/torvalds" | head -c 300                              # DB + API
curl -s https://<worker>.fly.dev/healthz                                            # worker + DB
```
