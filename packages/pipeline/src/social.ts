/** Events (feed), notifications, and their realtime fan-out. */
import type { Sql } from '@commitverse/db';
import { broadcast } from './realtime';

export interface EventInput {
  type: string;
  actorId?: number | null;
  targetId?: number | null;
  payload?: Record<string, unknown>;
  visibility?: 'public' | 'private';
}

/** Inserts a feed event; public events respect the actor's "hide from feed" setting. */
export async function emitEvent(db: Sql, e: EventInput): Promise<number | null> {
  let visibility = e.visibility ?? 'public';
  if (visibility === 'public' && e.actorId) {
    const [acc] = await db.query<{ hide: boolean }>(
      `select coalesce((settings->>'hideFromFeed')::boolean, false) as hide from accounts where github_id = $1`,
      [e.actorId],
    );
    if (acc?.hide) visibility = 'private';
  }
  const [row] = await db.query<{ id: number; created_at: Date }>(
    `insert into events (type, actor_id, target_id, payload, visibility) values ($1, $2, $3, $4, $5) returning id, created_at`,
    [e.type, e.actorId ?? null, e.targetId ?? null, JSON.stringify(e.payload ?? {}), visibility],
  );
  if (row && visibility === 'public') {
    const [actor] = e.actorId
      ? await db.query<{ login: string; avatar_url: string | null }>('select login, avatar_url from github_users where github_id = $1', [
          e.actorId,
        ])
      : [];
    const [target] = e.targetId
      ? await db.query<{ login: string }>('select login from github_users where github_id = $1', [e.targetId])
      : [];
    void broadcast('feed:public', e.type, {
      id: row.id,
      type: e.type,
      actor: e.actorId && actor ? { githubId: e.actorId, login: actor.login, avatarUrl: actor.avatar_url } : null,
      target: e.targetId && target ? { githubId: e.targetId, login: target.login } : null,
      payload: e.payload ?? {},
      createdAt: row.created_at.toISOString(),
    });
  }
  return row?.id ?? null;
}

export async function notify(db: Sql, recipientId: number, type: string, payload: Record<string, unknown>): Promise<void> {
  const [row] = await db.query<{ id: number; created_at: Date }>(
    'insert into notifications (recipient_id, type, payload) values ($1, $2, $3) returning id, created_at',
    [recipientId, type, JSON.stringify(payload)],
  );
  void broadcast(`user:${recipientId}`, 'notification', { id: row?.id, type, payload, createdAt: row?.created_at.toISOString() });
}

/** Idempotent Stardust grant (unique (github_id, reason, ref_id)); no-op for unclaimed stars. Returns true if granted. */
export async function grantStardust(db: Sql, githubId: number, delta: number, reason: string, refId: string): Promise<boolean> {
  const rows = await db.query(
    `insert into stardust_ledger (github_id, delta, reason, ref_id)
     select $1, $2, $3, $4 where exists (select 1 from accounts where github_id = $1)
     on conflict (github_id, reason, ref_id) do nothing returning id`,
    [githubId, delta, reason, refId],
  );
  return rows.length > 0;
}

const flagCache = new Map<string, { at: number; on: boolean }>();
/** §13.3 kill switches (`kill.comets`, `kill.multiplayer`, `kill.shop`, `kill.materialize`), cached for 15 s. */
export async function killed(db: Sql, feature: string): Promise<boolean> {
  const key = `kill.${feature}`;
  const c = flagCache.get(key);
  if (c && Date.now() - c.at < 15_000) return c.on;
  const [r] = await db.query<{ enabled: boolean }>('select enabled from feature_flags where key = $1', [key]);
  const on = !!r?.enabled;
  flagCache.set(key, { at: Date.now(), on });
  return on;
}
