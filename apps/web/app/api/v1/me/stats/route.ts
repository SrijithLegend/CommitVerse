/** Explorer stats that feed Voyager / Cartographer / Hyperspace / Eyewitness / Comet Chaser. */
import { z } from 'zod';
import { body, route } from '@/lib/server/api';
import { db, queue } from '@/lib/server/app';
import { ApiError } from '@/lib/server/errors';

const Body = z.discriminatedUnion('type', [
  z.object({ type: z.literal('warp'), starId: z.number().int().positive().optional(), galaxy: z.string().max(64).optional() }),
  z.object({ type: z.literal('visit'), starId: z.number().int().positive() }),
  z.object({ type: z.literal('eyewitness'), supernovaAt: z.string().datetime() }),
  z.object({ type: z.literal('comet_chase'), spawnedAt: z.string().datetime(), clickedAt: z.string().datetime() }),
]);

export const POST = route({ auth: 'claimed', limits: [{ name: 'stats', max: 120, windowS: 60, by: 'user' }] }, async ({ req, session }) => {
  const b = await body(req, Body);
  const d = await db();
  const id = session!.githubId;
  await d.query('insert into explorer_stats (github_id) values ($1) on conflict do nothing', [id]);
  switch (b.type) {
    case 'warp':
      await d.query('update explorer_stats set warps = warps + 1 where github_id = $1', [id]);
      if (b.galaxy)
        await d.query(
          `update explorer_stats set galaxies_visited = array(select distinct unnest(galaxies_visited || array[$2::text])) where github_id = $1`,
          [id, b.galaxy],
        );
      if (b.starId) await d.query('insert into visits (github_id, star_id) values ($1, $2) on conflict do nothing', [id, b.starId]);
      break;
    case 'visit':
      await d.query('insert into visits (github_id, star_id) values ($1, $2) on conflict do nothing', [id, b.starId]);
      break;
    case 'eyewitness': {
      const [ok] = await d.query(
        `select 1 from events where type = 'supernova' and created_at between $1::timestamptz - interval '5 seconds' and $1::timestamptz + interval '2 minutes' limit 1`,
        [b.supernovaAt],
      );
      if (!ok) throw new ApiError(400, 'no_supernova', 'No supernova at that time');
      await d.query('update explorer_stats set eyewitness = true where github_id = $1', [id]);
      break;
    }
    case 'comet_chase': {
      const dt = Date.parse(b.clickedAt) - Date.parse(b.spawnedAt);
      if (dt < 0 || dt > 5000 || Date.now() - Date.parse(b.clickedAt) > 60_000)
        throw new ApiError(400, 'too_slow', 'Comet chases must be within 5 s of spawn');
      await d.query('update explorer_stats set comet_chased = true where github_id = $1', [id]);
      break;
    }
  }
  await (await queue()).send('achievements', { githubId: id }, { singletonKey: `ach:${id}:stats:${Math.floor(Date.now() / 30_000)}` });
  return { ok: true };
});
