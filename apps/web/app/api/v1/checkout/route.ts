import { CheckoutBody } from '@commitverse/contracts';
import { body, route } from '@/lib/server/api';
import { db, env } from '@/lib/server/app';
import { createCheckout } from '@/lib/server/economy';

export const POST = route(
  { auth: 'claimed', limits: [{ name: 'checkout', max: 10, windowS: 60, by: 'user' }] },
  async ({ req, session }) => {
    const b = await body(req, CheckoutBody);
    return createCheckout(await db(), session!.githubId, session!.login, b, env().APP_URL);
  },
);
