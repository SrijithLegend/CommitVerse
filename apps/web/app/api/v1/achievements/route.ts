import { route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { achievementsCatalog } from '@/lib/server/queries';

export const GET = route({ cache: 'public, s-maxage=3600, stale-while-revalidate=7200' }, async () => achievementsCatalog(await db()));
