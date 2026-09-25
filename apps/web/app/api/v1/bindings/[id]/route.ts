import { BindingPatch } from '@commitverse/contracts';
import { z } from 'zod';
import { body, route } from '@/lib/server/api';
import { db, queue } from '@/lib/server/app';
import { updateBinding } from '@/lib/server/social';

export const PATCH = route<{ id: string }>(
  { auth: 'claimed', limits: [{ name: 'bindings', max: 10, windowS: 86_400, by: 'user' }] },
  async ({ req, params, session }) => {
    const { action } = await body(req, BindingPatch);
    await updateBinding(await db(), await queue(), session!.githubId, z.string().uuid().parse(params.id), action);
    return { ok: true };
  },
);
