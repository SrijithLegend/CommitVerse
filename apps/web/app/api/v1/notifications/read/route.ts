import { z } from 'zod';
import { body, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';

const Body = z.object({ ids: z.array(z.number().int().positive()).max(200).optional() });

export const POST = route(
  { auth: 'user', limits: [{ name: 'notifications', max: 60, windowS: 60, by: 'user' }] },
  async ({ req, session }) => {
    const { ids } = await body(req, Body);
    await (await db()).query(
      `update notifications set read_at = now() where recipient_id = $1 and read_at is null and ($2::bigint[] is null or id = any($2::bigint[]))`,
      [session!.githubId, ids ?? null],
    );
    return { ok: true };
  },
);
