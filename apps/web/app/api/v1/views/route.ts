import { ViewBody } from '@commitverse/contracts';
import { getUniverse, nanoid } from '@commitverse/pipeline';
import { body, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';

export const POST = route({ auth: 'optional', limits: [{ name: 'views', max: 20, windowS: 60 }] }, async ({ req, session }) => {
  const { camera } = await body(req, ViewBody);
  const d = await db();
  const u = await getUniverse(d);
  const id = nanoid(10);
  await d.query('insert into shared_views (id, camera, bake_version, created_by) values ($1, $2, $3, $4)', [
    id,
    JSON.stringify(camera),
    u?.bakeVersion ?? 'none',
    session?.githubId ?? null,
  ]);
  return { id, url: `/v/${id}` };
});
