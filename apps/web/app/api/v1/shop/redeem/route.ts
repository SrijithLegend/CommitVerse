import { RedeemBody } from '@commitverse/contracts';
import { body, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { redeem } from '@/lib/server/economy';

export const POST = route({ auth: 'claimed', limits: [{ name: 'redeem', max: 10, windowS: 60, by: 'user' }] }, async ({ req, session }) => {
  const { itemId } = await body(req, RedeemBody);
  return redeem(await db(), session!.githubId, itemId);
});
