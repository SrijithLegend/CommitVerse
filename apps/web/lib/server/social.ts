/** F8 signals, F3 bindings (binary stars). Limits enforced server-side (rate limiter + DB constraints). */
import 'server-only';
import type { Db } from '@commitverse/db';
import type { JobQueue } from '@commitverse/pipeline';
import { broadcast, emitEvent, notify } from '@commitverse/pipeline';
import { refreshBodyFlags } from './claim';
import { ApiError } from './errors';
import { cleanUserText } from './moderation';

export const SIGNALS_PER_DAY = 10;

export async function sendSignal(db: Db, queue: JobQueue, fromId: number, toLogin: string, message?: string): Promise<{ id: number }> {
  const [to] = await db.query<{ github_id: number; disabled: boolean; login: string }>(
    `select u.github_id, u.login::text as login, coalesce((a.settings->>'disableSignals')::boolean, false) as disabled
     from github_users u join bodies b using (github_id) left join accounts a on a.github_id = u.github_id
     where u.login = $1 and not u.is_opted_out`,
    [toLogin],
  );
  if (!to) throw new ApiError(404, 'not_mapped', `@${toLogin} is not in the universe`);
  if (to.github_id === fromId) throw new ApiError(400, 'self_signal', 'You can’t signal yourself');
  if (to.disabled) throw new ApiError(403, 'signals_disabled', `@${to.login} isn’t receiving signals`);
  const [blocked] = await db.query('select 1 from blocks where blocker_id = $1 and blocked_id = $2', [to.github_id, fromId]);
  if (blocked) throw new ApiError(403, 'blocked', `@${to.login} isn’t receiving signals from you`);
  const [{ n }] = (await db.query<{ n: number }>(
    `select count(*)::int as n from signals where from_id = $1 and sent_on = (now() at time zone 'utc')::date`,
    [fromId],
  )) as [{ n: number }];
  if (n >= SIGNALS_PER_DAY) throw new ApiError(429, 'daily_limit', `You’ve sent ${SIGNALS_PER_DAY} signals today`);
  let text: string | null = null;
  if (message?.trim()) {
    const c = cleanUserText(message, 60);
    if (c.flagged) throw new ApiError(422, 'message_rejected', 'That message didn’t pass moderation');
    text = c.text;
  }
  let id: number;
  try {
    const [row] = await db.query<{ id: number }>('insert into signals (from_id, to_id, message) values ($1, $2, $3) returning id', [
      fromId,
      to.github_id,
      text,
    ]);
    id = row!.id;
  } catch {
    throw new ApiError(409, 'already_signalled', `You already signalled @${to.login} today`);
  }
  // Aggregate the public feed item: "@a sent 3 signals"
  const [recent] = await db.query<{ id: number; created_at: Date }>(
    `select id, created_at from events where type = 'signal_sent' and actor_id = $1 and created_at > now() - interval '1 hour' order by created_at desc limit 1`,
    [fromId],
  );
  if (recent)
    await db.query(
      `update events set payload = jsonb_set(payload, '{count}', to_jsonb(coalesce((payload->>'count')::int, 1) + 1)) where id = $1 and created_at = $2`,
      [recent.id, recent.created_at],
    );
  else await emitEvent(db, { type: 'signal_sent', actorId: fromId, targetId: to.github_id, payload: { count: 1 } });
  await notify(db, to.github_id, 'signal', { from: fromId, message: text });
  const [style] = await db.query<{ item_id: string }>(
    `select i.item_id from equipped e join inventory i on i.id = e.inventory_id where e.github_id = $1 and e.slot = 'signal_style'`,
    [fromId],
  );
  void broadcast('cosmic:global', 'signal', { from: fromId, to: to.github_id, style: style?.item_id ?? 'signal_style.default' });
  await queue.send('achievements', { githubId: fromId }, { singletonKey: `ach:${fromId}:sig` });
  await queue.send('achievements', { githubId: to.github_id }, { singletonKey: `ach:${to.github_id}:sig` });
  return { id };
}

export async function requestBinding(db: Db, fromId: number, withLogin: string): Promise<{ id: string }> {
  const [other] = await db.query<{ github_id: number }>(
    `select u.github_id from github_users u join accounts a using (github_id) where u.login = $1 and not u.is_opted_out`,
    [withLogin],
  );
  if (!other) throw new ApiError(404, 'not_claimed', `@${withLogin} must claim their star before forming a binary`);
  if (other.github_id === fromId) throw new ApiError(400, 'self_binding', 'A star can’t bind to itself');
  const [a, b] = fromId < other.github_id ? [fromId, other.github_id] : [other.github_id, fromId];
  const active = await db.query(`select 1 from bindings where status = 'active' and (a_id in ($1,$2) or b_id in ($1,$2))`, [a, b]);
  if (active.length) throw new ApiError(409, 'binary_limit', 'Each star can have one binary partner');
  try {
    const [row] = await db.query<{ id: string }>(
      `insert into bindings (a_id, b_id, requested_by, status) values ($1, $2, $3, 'pending') returning id`,
      [a, b, fromId],
    );
    await notify(db, other.github_id, 'binding_request', { from: fromId, bindingId: row!.id });
    return { id: row!.id };
  } catch {
    throw new ApiError(409, 'binding_exists', 'A request is already pending');
  }
}

export async function updateBinding(
  db: Db,
  queue: JobQueue,
  me: number,
  id: string,
  action: 'accept' | 'decline' | 'dissolve',
): Promise<void> {
  const [bnd] = await db.query<{ a_id: number; b_id: number; requested_by: number; status: string }>(
    'select a_id, b_id, requested_by, status from bindings where id = $1 and (a_id = $2 or b_id = $2)',
    [id, me],
  );
  if (!bnd) throw new ApiError(404, 'binding_not_found', 'No such binding');
  const other = bnd.a_id === me ? bnd.b_id : bnd.a_id;
  if (action === 'accept') {
    if (bnd.status !== 'pending' || bnd.requested_by === me)
      throw new ApiError(409, 'cannot_accept', 'Only the invited star can accept a pending request');
    try {
      await db.query(`update bindings set status = 'active' where id = $1`, [id]);
    } catch {
      throw new ApiError(409, 'binary_limit', 'One of you already has a binary partner');
    }
    await emitEvent(db, { type: 'binary_formed', actorId: me, targetId: other, payload: {} });
    await notify(db, other, 'binding_accepted', { by: me });
  } else if (action === 'decline') {
    if (bnd.status !== 'pending') throw new ApiError(409, 'not_pending', 'Not pending');
    await db.query(`update bindings set status = 'declined' where id = $1`, [id]);
  } else {
    if (bnd.status !== 'active' && bnd.status !== 'pending') throw new ApiError(409, 'not_active', 'Not active');
    await db.query(`update bindings set status = 'dissolved' where id = $1`, [id]);
    await notify(db, other, 'binding_dissolved', { by: me });
  }
  await refreshBodyFlags(db, me);
  await refreshBodyFlags(db, other);
  await queue.send('achievements', { githubId: me }, { singletonKey: `ach:${me}:bind` });
  await queue.send('achievements', { githubId: other }, { singletonKey: `ach:${other}:bind` });
  await queue.send('delta', {}, { singletonKey: 'delta', startAfterSeconds: 2 });
}
