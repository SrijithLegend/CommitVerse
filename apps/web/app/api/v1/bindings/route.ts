import { BindingBody } from '@commitverse/contracts';
import { body, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { requestBinding } from '@/lib/server/social';

export const POST = route(
  { auth: 'claimed', limits: [{ name: 'bindings', max: 10, windowS: 86_400, by: 'user' }] },
  async ({ req, session }) => {
    const b = await body(req, BindingBody);
    return requestBinding(await db(), session!.githubId, b.with);
  },
);
