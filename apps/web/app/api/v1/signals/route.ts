import { SignalBody } from '@commitverse/contracts';
import { body, route } from '@/lib/server/api';
import { db, queue } from '@/lib/server/app';
import { sendSignal } from '@/lib/server/social';

export const POST = route(
  { auth: 'claimed', limits: [{ name: 'signals', max: 10, windowS: 86_400, by: 'user' }] },
  async ({ req, session }) => {
    const b = await body(req, SignalBody);
    return sendSignal(await db(), await queue(), session!.githubId, b.to, b.message);
  },
);
