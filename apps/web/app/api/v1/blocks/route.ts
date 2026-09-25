import { Login } from '@commitverse/contracts';
import { z } from 'zod';
import { body, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { ApiError } from '@/lib/server/errors';

const Body = z.object({ login: Login, blocked: z.boolean() });

/** Signal block list (§11.5). */
export const POST = route(
  { auth: 'claimed', limits: [{ name: 'blocks', max: 30, windowS: 3600, by: 'user' }] },
  async ({ req, session }) => {
    const b = await body(req, Body);
    const d = await db();
    const [u] = await d.query<{ github_id: number }>('select github_id from github_users where login = $1', [b.login]);
    if (!u) throw new ApiError(404, 'not_found', 'No such star');
    if (b.blocked)
      await d.query('insert into blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing', [session!.githubId, u.github_id]);
    else await d.query('delete from blocks where blocker_id = $1 and blocked_id = $2', [session!.githubId, u.github_id]);
    return { ok: true };
  },
);
