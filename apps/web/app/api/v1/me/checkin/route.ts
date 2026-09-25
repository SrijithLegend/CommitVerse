import { route } from '@/lib/server/api';
import { db, queue } from '@/lib/server/app';
import { checkin } from '@/lib/server/economy';

export const POST = route({ auth: 'claimed', limits: [{ name: 'checkin', max: 3, windowS: 86_400, by: 'user' }] }, async ({ session }) => {
  const r = await checkin(await db(), session!.githubId);
  await (await queue()).send('achievements', { githubId: session!.githubId }, { singletonKey: `ach:${session!.githubId}:checkin` });
  return r;
});
