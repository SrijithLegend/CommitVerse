/** Beacon Banner text (≤ 24 chars) — pre-moderated: it only renders publicly once an admin approves it (§11.5). */
import { z } from 'zod';
import { body, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { ApiError } from '@/lib/server/errors';
import { cleanUserText } from '@/lib/server/moderation';

const Body = z.object({ text: z.string().min(1).max(64) });

export const PUT = route({ auth: 'claimed', limits: [{ name: 'banner', max: 5, windowS: 3600, by: 'user' }] }, async ({ req, session }) => {
  const { text } = await body(req, Body);
  const c = cleanUserText(text, 24);
  if (!c.text) throw new ApiError(400, 'empty', 'Banner text is empty');
  if (c.flagged) throw new ApiError(422, 'banner_rejected', 'That banner didn’t pass moderation');
  const d = await db();
  const [owns] = await d.query(`select 1 from inventory where owner_id = $1 and item_id = 'banner.beacon' and revoked_at is null`, [
    session!.githubId,
  ]);
  if (!owns) throw new ApiError(403, 'not_owned', 'Get the Beacon Banner first');
  await d.query(
    `insert into banners (github_id, text, status) values ($1, $2, 'pending')
     on conflict (github_id) do update set text = excluded.text, status = 'pending', created_at = now()`,
    [session!.githubId, c.text],
  );
  return { text: c.text, status: 'pending' };
});
