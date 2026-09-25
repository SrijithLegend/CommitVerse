/** F16 — Beacon heartbeat. Bearer beacon token (heartbeat-only scope). Payload: {language} — never files, paths, repos or code. */
import { HeartbeatBody } from '@commitverse/contracts';
import { broadcast, sha256 } from '@commitverse/pipeline';
import { body, json, route } from '@/lib/server/api';
import { db, queue } from '@/lib/server/app';
import { refreshBodyFlags } from '@/lib/server/claim';
import { ApiError } from '@/lib/server/errors';
import { rateLimit } from '@/lib/server/ratelimit';

export const POST = route({}, async ({ req }) => {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token.startsWith('cvb_')) throw new ApiError(401, 'unauthorized', 'Beacon token required');
  const d = await db();
  const [t] = await d.query<{ github_id: number }>('select github_id from beacon_tokens where token_hash = $1 and revoked_at is null', [
    sha256(token),
  ]);
  if (!t) throw new ApiError(401, 'unauthorized', 'Unknown or revoked beacon token');
  const rl = await rateLimit('heartbeat', String(t.github_id), 2, 60);
  if (!rl.ok) throw new ApiError(429, 'rate_limited', 'Heartbeats are limited to 2 per minute');
  const { language } = await body(req, HeartbeatBody);
  const [prev] = await d.query<{ online: boolean }>(
    `select coalesce(beacon_last_at > now() - interval '2 minutes', false) as online from accounts where github_id = $1`,
    [t.github_id],
  );
  await d.query('update accounts set beacon_last_at = now(), beacon_language = $2 where github_id = $1', [
    t.github_id,
    language?.slice(0, 64) ?? null,
  ]);
  await d.query(
    `insert into beacon_heartbeats (github_id, minute, language) values ($1, date_trunc('minute', now()), $2) on conflict do nothing`,
    [t.github_id, language ?? null],
  );
  if (!prev?.online) {
    await refreshBodyFlags(d, t.github_id);
    void broadcast('cosmic:global', 'beacon', { githubId: t.github_id, on: true });
    const q = await queue();
    await q.send('delta', {}, { singletonKey: 'delta', startAfterSeconds: 2 });
    await q.send(
      'achievements',
      { githubId: t.github_id },
      { singletonKey: `ach:${t.github_id}:beacon:${new Date().toISOString().slice(0, 13)}` },
    );
  }
  return json({ ok: true, next: 60 });
});
