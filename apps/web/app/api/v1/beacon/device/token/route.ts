import { z } from 'zod';
import { body, json, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { ApiError } from '@/lib/server/errors';

export const POST = route({ limits: [{ name: 'device-poll', max: 30, windowS: 60 }] }, async ({ req }) => {
  const { device_code } = await body(req, z.object({ device_code: z.string().min(10).max(100) }));
  const d = await db();
  const [row] = await d.query<{ token: string | null; expired: boolean }>(
    'select token, expires_at < now() as expired from beacon_device_codes where device_code = $1',
    [device_code],
  );
  if (!row || row.expired) throw new ApiError(400, 'expired_token', 'The code expired — start again');
  if (!row.token) return json({ error: 'authorization_pending' }, { status: 428 });
  // The plaintext token is handed over exactly once, then erased.
  await d.query('delete from beacon_device_codes where device_code = $1', [device_code]);
  return json({ access_token: row.token, token_type: 'bearer', scope: 'beacon:heartbeat' });
});
