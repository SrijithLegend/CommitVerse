import { z } from 'zod';
import { route } from '@/lib/server/api';
import { db, queue } from '@/lib/server/app';
import { openGift } from '@/lib/server/economy';

export const POST = route<{ id: string }>(
  { auth: 'claimed', limits: [{ name: 'gift-open', max: 20, windowS: 60, by: 'user' }] },
  async ({ params, session, url }) => {
    const id = z.string().uuid().parse(params.id);
    const r = await openGift(await db(), session!.githubId, id, url.searchParams.get('equip') === '1');
    await (await queue()).send('achievements', { githubId: session!.githubId }, { singletonKey: `ach:${session!.githubId}:gift` });
    return r;
  },
);
