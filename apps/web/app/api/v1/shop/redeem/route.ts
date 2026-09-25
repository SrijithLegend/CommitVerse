import { RedeemBody } from '@commitverse/contracts';
import { killed } from '@commitverse/pipeline';
import { body, route } from '@/lib/server/api';
import { ApiError } from '@/lib/server/errors';
import { db } from '@/lib/server/app';
import { redeem } from '@/lib/server/economy';

export const POST = route({ auth: 'claimed', limits: [{ name: 'redeem', max: 10, windowS: 60, by: 'user' }] }, async ({ req, session }) => {
    if (await killed(await db(), 'shop')) throw new ApiError(503, 'disabled', 'This feature is temporarily disabled');
  const { itemId } = await body(req, RedeemBody);
  return redeem(await db(), session!.githubId, itemId);
});
