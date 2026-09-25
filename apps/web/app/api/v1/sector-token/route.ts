/** Short-lived signed sector-join token for the Durable Object presence service (F15). */
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { killed } from '@commitverse/pipeline';
import { body, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { ApiError } from '@/lib/server/errors';

const Body = z.object({ sector: z.string().regex(/^\d{1,5}:r[0-7]{0,6}$/) });

export const POST = route({ auth: 'optional', limits: [{ name: 'sector', max: 30, windowS: 60 }] }, async ({ req, session }) => {
    if (await killed(await db(), 'multiplayer')) throw new ApiError(503, 'disabled', 'This feature is temporarily disabled');
  const secret = process.env.REALTIME_SHARED_SECRET;
  if (!secret || !process.env.NEXT_PUBLIC_REALTIME_URL)
    throw new ApiError(503, 'presence_disabled', 'Multiplayer presence is not configured');
  const { sector } = await body(req, Body);
  const claimed = !!session?.claimed;
  const payload = Buffer.from(
    JSON.stringify({
      sector,
      gid: claimed ? session!.githubId : null,
      login: claimed ? session!.login : null,
      exp: Date.now() + 10 * 60_000,
    }),
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, url: process.env.NEXT_PUBLIC_REALTIME_URL };
});
