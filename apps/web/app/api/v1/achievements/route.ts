import { route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { achievementsCatalog, cachedFor } from '@/lib/server/queries';

export const GET = route({ cache: 'public, s-maxage=3600, stale-while-revalidate=7200' }, () =>
  cachedFor('achievements', 3_600_000, async () => achievementsCatalog(await db())),
);
