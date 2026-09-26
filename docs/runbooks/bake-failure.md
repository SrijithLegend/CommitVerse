# Runbook — Bake failure

**Alert:** `bake failed` (Sentry, worker) or `delta age > 15 min`.
**Impact:** none for users at first. The previous bake keeps serving: tiles are immutable and versioned, and
`/api/v1/universe/current` only moves once a bake passes validation. New stars keep appearing through the delta layer.

## 1. Triage (5 min)
1. Admin console → **Bakes**. Note the failing version, its `status`, and the validation error.
2. Worker logs (Fly): `fly logs -a commitverse-worker | grep '"job":"bake"'`.
3. Classify it:
   | Symptom | Likely cause |
   |---|---|
   | `validation failed: star count dropped > 5%` | Ingest outage or a mass opt-out. Don't force it |
   | `min separation violated` / NaN positions | Formula regression. Check the last deploy of `universe-core` |
   | OOM / killed | VM too small for N (about 4 GB at 1M stars) |
   | R2 `403`/`5xx` | Credentials rotated, or an R2 incident |

## 2. Mitigate
- **Bad bake already published** (users see a broken universe): roll back.
  - Admin console → Bakes → **Rollback** on the last good version, or
  - `pnpm --filter @commitverse/worker exec tsx src/cli.ts rollback <version>`
  Rollback only repoints `universe_versions.current`. It's instant and needs no tile rewrite.
- **OOM:** `fly scale memory 8192 -a commitverse-worker`, then retrigger (Admin → Bakes → Run bake now).
- **R2:** check the Cloudflare status page. Verify `R2_*` secrets with `fly secrets list`. The bake is safe to rerun
  because uploads are keyed by version.
- **Formula regression:** revert the offending commit. Goldens should have caught it, so add the missing case.

## 3. Verify
- `curl -s $APP_URL/api/v1/universe/current | jq .version` shows the expected version.
- Open `/` and check that stars render and the counts match the previous bake ±1%.
- `delta age` alert clears within 10 min.

## 4. Follow-up
Post-mortem if users saw it. Keep 7 versions (§C). Never delete the version you rolled back to.
