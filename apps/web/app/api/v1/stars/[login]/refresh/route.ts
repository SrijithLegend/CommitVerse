import { Login } from '@commitverse/contracts';
import { json, route } from '@/lib/server/api';
import { db, queue } from '@/lib/server/app';
import { ApiError } from '@/lib/server/errors';
import { rateLimit } from '@/lib/server/ratelimit';
import { requireStar } from '@/lib/server/stars';

/** F3: owner 1 per 10 min (high priority); anyone else queued at low priority, 1 per hour per star. */
export const POST = route<{ login: string }>({ auth: 'optional' }, async ({ params, session }) => {
  const d = await db();
  const u = await requireStar(d, Login.parse(params.login));
  if (u.synthetic) throw new ApiError(409, 'synthetic', 'Synthetic stars are generated, not fetched');
  const owner = session?.claimed && session.githubId === u.githubId;
  const limit = owner
    ? await rateLimit('refresh-owner', String(u.githubId), 1, 600)
    : await rateLimit('refresh-star', String(u.githubId), 1, 3600);
  if (!limit.ok) {
    const retry = Math.ceil((limit.reset - Date.now()) / 1000);
    throw new ApiError(429, 'rate_limited', `This star was refreshed recently — try again in ${Math.ceil(retry / 60)} min`, {
      'retry-after': String(retry),
    });
  }
  await (await queue()).send(
    'refresh',
    { githubId: u.githubId },
    { priority: owner ? 80 : 10, singletonKey: `r:${u.githubId}:manual:${Math.floor(Date.now() / 600_000)}` },
  );
  return json({ queued: true, priority: owner ? 'high' : 'low' }, { status: 202 });
});
