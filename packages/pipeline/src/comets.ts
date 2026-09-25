/**
 * F10 — live comets. Sources: GitHub App webhooks (seconds), Events API polling with ETags (304s are free),
 * and — for everyone else — GH Archive (activity freshness only, no comets).
 * Throttle: ≤ 1 comet per star per 30 s (server); clients cap simultaneous comets at 40.
 */
import type { Db } from '@commitverse/db';
import { restGet } from './github';
import { log } from './log';
import { broadcast } from './realtime';
import { emitEvent } from './social';

export type CometType = 'push' | 'pr_merged' | 'release';

export interface Comet {
  githubId: number;
  login: string;
  type: CometType;
  repo: string;
  at: string;
  meteor: boolean;
}

const lastComet = new Map<number, number>();

async function meteorShowerActive(db: Db): Promise<boolean> {
  const [r] = await db.query<{ on: boolean }>(
    `select exists(select 1 from cosmic_events where type = 'meteor_shower' and now() between starts_at and ends_at) as on`,
  );
  return !!r?.on;
}

export async function fireComet(db: Db, c: Omit<Comet, 'meteor'>): Promise<boolean> {
  const now = Date.now();
  if (now - (lastComet.get(c.githubId) ?? 0) < 30_000) return false;
  lastComet.set(c.githubId, now);
  const meteor = c.type === 'pr_merged' && (await meteorShowerActive(db));
  void broadcast('cosmic:global', 'comet', { ...c, meteor });
  if (c.type === 'release') await emitEvent(db, { type: 'release', actorId: c.githubId, payload: { repo: c.repo } });
  return true;
}

interface GhEvent {
  id: string;
  type: string;
  created_at: string;
  repo: { name: string };
  payload: { action?: string; pull_request?: { merged?: boolean }; release?: unknown };
}

/** Maps a GitHub event (REST events API or webhook) to a comet type. */
export function cometTypeOf(e: { type: string; payload: GhEvent['payload'] }): CometType | null {
  if (e.type === 'PushEvent' || e.type === 'push') return 'push';
  if ((e.type === 'PullRequestEvent' || e.type === 'pull_request') && e.payload.action === 'closed' && e.payload.pull_request?.merged)
    return 'pr_merged';
  if ((e.type === 'ReleaseEvent' || e.type === 'release') && (e.payload.action === 'published' || e.payload.action === 'released'))
    return 'release';
  return null;
}

/** Adaptive poll: active users every 60 s, quiet ones back off to 300 s (claimed without token: min 120 s). */
export async function pollEvents(db: Db, githubId: number): Promise<number> {
  const [u] = await db.query<{ login: string; etag: string | null; last_event_id: string | null; interval_s: number; tier: number }>(
    `select g.login::text as login, p.etag, p.last_event_id, coalesce(p.interval_s, 120) as interval_s, g.refresh_tier as tier
     from github_users g left join poll_state p using (github_id) where g.github_id = $1 and not g.is_opted_out`,
    [githubId],
  );
  if (!u) return 0;
  const res = await restGet<GhEvent[]>(`/users/${encodeURIComponent(u.login)}/events/public?per_page=30`, u.etag);
  let fired = 0;
  let newest = u.last_event_id;
  if (res.status === 200 && res.data) {
    const fresh = res.data.filter((e) => !u.last_event_id || BigInt(e.id) > BigInt(u.last_event_id));
    newest = res.data[0]?.id ?? newest;
    // Only events from the last 10 minutes become comets (first poll must not replay history).
    for (const e of fresh.reverse()) {
      const type = cometTypeOf(e);
      if (!type || Date.now() - Date.parse(e.created_at) > 10 * 60_000) continue;
      if (await fireComet(db, { githubId, login: u.login, type, repo: e.repo.name, at: e.created_at })) fired++;
    }
  }
  const minInterval = u.tier === 0 ? 60 : 120;
  const next = fired > 0 ? minInterval : Math.min(300, Math.max(minInterval, Math.round(u.interval_s * 1.5), res.pollInterval ?? 0));
  await db.query(
    `insert into poll_state (github_id, etag, last_event_id, interval_s, next_poll_at) values ($1, $2, $3, $4, now() + make_interval(secs => $4))
     on conflict (github_id) do update set etag = excluded.etag, last_event_id = excluded.last_event_id, interval_s = excluded.interval_s,
       next_poll_at = excluded.next_poll_at`,
    [githubId, res.etag ?? u.etag, newest, next],
  );
  if (fired) log.info({ job: 'events-poll', github_id: githubId, fired }, 'comets');
  return fired;
}

/** GitHub App webhook → comet + mark the sender for refresh. */
export async function handleGitHubWebhook(db: Db, event: string, payload: Record<string, unknown>): Promise<void> {
  const sender = payload.sender as { id?: number; login?: string; type?: string } | undefined;
  if (!sender?.id || sender.type === 'Bot') return;
  const [known] = await db.query<{ login: string }>(
    `select g.login::text as login from github_users g join accounts a using (github_id) where g.github_id = $1 and not g.is_opted_out`,
    [sender.id],
  );
  if (!known) return;
  const repo = (payload.repository as { full_name?: string } | undefined)?.full_name ?? '';
  const type = cometTypeOf({ type: event, payload: payload as GhEvent['payload'] });
  if (type) await fireComet(db, { githubId: sender.id, login: known.login, type, repo, at: new Date().toISOString() });
  await db.query(`update github_users set next_refresh_at = least(next_refresh_at, now() + interval '10 minutes') where github_id = $1`, [
    sender.id,
  ]);
}
