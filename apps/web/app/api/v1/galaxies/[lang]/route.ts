import { route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { galaxyOverview } from '@/lib/server/queries';

export const GET = route<{ lang: string }>({ cache: 'public, s-maxage=300, stale-while-revalidate=600' }, async ({ params }) =>
  galaxyOverview(await db(), decodeURIComponent(params.lang)),
);
