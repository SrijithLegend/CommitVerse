# Runbook — Deploy, roll back, release

Setup and secrets: `docs/deployment.md`. Kill switches (Admin → Flags): `kill.comets`, `kill.multiplayer`,
`kill.shop`, `kill.materialize`. Flipping a switch is always faster than a rollback.

## Normal deploy
Merge to `main`. CI runs `check`, then `e2e`, then `deploy` (migrations → worker → web → realtime → smoke tests →
Sentry release). Watch: GitHub → Actions → the run → `deploy`. If the `production` environment requires review,
approve it there.

## Roll back

| Layer | Fastest rollback | Notes |
|---|---|---|
| Web (Vercel) | Vercel → Project → Deployments → previous good deployment → **Promote to Production** (or `npx vercel rollback --token $VERCEL_TOKEN`) | Instant. No rebuild. |
| Worker (Fly) | `fly releases -a commitverse-worker` → note the last good image → `fly deploy -a commitverse-worker --image <image-ref>` | In-flight jobs retry (pg-boss, retry with backoff). |
| Realtime (Cloudflare) | `pnpm --filter @commitverse/realtime exec wrangler rollback` (pick the previous version) | Clients reconnect on their own. |
| Universe (bake) | Admin → Bakes → **Rollback**, or `pnpm --filter @commitverse/worker exec tsx src/cli.ts rollback <version>` | Repoints `universe_versions.current`. See `bake-failure.md`. |
| Database | **No down-migrations.** Migrations are forward-only (expand → migrate → contract across two deploys). Fix forward with a new migration. Restore from Supabase PITR only for data loss (Database → Backups). | Take a manual backup (Database → Backups → "Create backup") before any risky migration. |

After any rollback, revert the offending commit on `main` too. Otherwise the next merge redeploys it.

## Hotfix
Branch from `main` → fix → PR (CI runs checks + E2E) → merge. Don't push directly to `main`. Branch protection
should require `check` and `e2e`.

## Beacon (VS Code extension) release
1. Bump `version` in `packages/vscode-extension/package.json` (semver; the Marketplace rejects reused versions).
2. Commit, then `git tag v<version> && git push origin v<version>`.
3. `release.yml` tests, builds, packages (`vsce package --no-dependencies`), publishes with `VSCE_PAT`, and attaches the
   `.vsix` to a GitHub release.
4. Check it: marketplace.visualstudio.com/items?itemName=commitverse.commitverse-beacon shows the new version. In a
   clean profile: `code --user-data-dir /tmp/cvtest --install-extension commitverse.commitverse-beacon`, then run
   "Commitverse: Connect Beacon".

**Bad extension release:** you can't roll back a Marketplace version. Publish a fixed patch version, or turn heartbeats
off server-side by revoking tokens (Admin) while you fix it. `npx @vscode/vsce unpublish commitverse.commitverse-beacon`
removes the extension entirely. Last resort only: it also breaks installs.

## Local packaging check (no token needed)
```sh
pnpm --filter commitverse-beacon build
cd packages/vscode-extension && npx @vscode/vsce package --no-dependencies   # must print DONE with no warnings
```
