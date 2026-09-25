import { getState, getUniverse } from '@commitverse/pipeline';
import { json, route } from '@/lib/server/api';
import { db, tilesBase } from '@/lib/server/app';
import { ApiError } from '@/lib/server/errors';

export const GET = route({}, async () => {
  const d = await db();
  const u = await getUniverse(d);
  if (!u) throw new ApiError(503, 'no_universe', 'The universe is still forming — the first bake has not finished');
  const delta = await getState<{ etag: string }>(d, 'delta');
  const base = tilesBase();
  return json(
    {
      bakeVersion: u.bakeVersion,
      manifestUrl: `${base}/u/${u.bakeVersion}/manifest.json`,
      deltaUrl: `${base}/u/live/delta.bin`,
      deltaEtag: delta?.etag ?? null,
      starCount: u.starCount,
    },
    { cache: 'public, max-age=60, s-maxage=60' },
  );
});
