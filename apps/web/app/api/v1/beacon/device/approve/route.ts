import { randomToken, sha256 } from '@commitverse/pipeline';
import { z } from 'zod';
import { body, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { ApiError } from '@/lib/server/errors';

export const POST = route(
  { auth: 'claimed', limits: [{ name: 'device-approve', max: 10, windowS: 3600, by: 'user' }] },
  async ({ req, session }) => {
    const { userCode } = await body(req, z.object({ userCode: z.string().regex(/^[A-Z]{4}-[A-Z]{4}$/) }));
    const d = await db();
    const token = `cvb_${randomToken(32)}`;
    const upd = await d.query(
      `update beacon_device_codes set github_id = $2, token = $3 where user_code = $1 and token is null and expires_at > now() returning device_code`,
      [userCode, session!.githubId, token],
    );
    if (!upd.length) throw new ApiError(404, 'code_not_found', 'That code is invalid or expired');
    await d.query('insert into beacon_tokens (github_id, token_hash) values ($1, $2)', [session!.githubId, sha256(token)]);
    return { approved: true };
  },
);
