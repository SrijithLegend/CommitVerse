# Runbook — GitHub budget exhaustion

**Alert:** `GitHub budget < 10% for > 15 min`, or `materialize p95 > 30 s`.
**Impact:** new users wait in the "star forming" queue. Existing stars, the tiles and the rest of the app are unaffected.

## Rules you must not break (§8.4)
- **No token pooling.** Never add other people's or extra accounts' tokens to get more budget. It violates GitHub's
  ToS and can end the project.
- User-delegated sync tokens only fetch *that* user's own data.

## 1. Triage
1. Admin console → Overview: budget remaining, reset time, queue depths (`materialize`, `refresh`).
2. Is it a traffic spike (viral day) or a bug (a refresh loop, a retry storm)?
   ```sql
   select job, count(*), sum(cost) from github_cost_log where at > now() - interval '1 hour' group by 1 order by 3 desc;
   ```
   A single `github_id` showing up hundreds of times means a loop, so fix the bug before anything else.

## 2. Mitigate (in order)
1. **Pause background refresh.** Lower-tier refreshes (T3/T4) yield automatically below 20% budget. If they don't,
   stop the worker's refresh schedule: `fly scale count 0 -a commitverse-worker`. Only when you're sure nothing else
   is queued. Bakes also run there.
2. **Kill materialize** if the queue is growing faster than the budget refills:
   Admin → Flags → `kill.materialize` = on. The UI shows "the universe is at capacity — you're in the queue".
   Queued jobs are kept and resume when the flag is turned off.
3. **Viral day:** this is expected (§17). Leave the queue UX on. Point people at claiming (sign-in), because claimed
   users sync through their own delegated token, which costs the app budget nothing.

## 3. Recover
- Budget resets hourly (`resetAt`). Turn off `kill.materialize` once remaining > 40%.
- Watch `materialize p95` return under 30 s.

## 4. Follow-up
If it happens repeatedly, promote more users to user-delegated sync and review the refresh tiers (§8.5). Don't
raise concurrency.
