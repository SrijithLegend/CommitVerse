import { BriefQuery } from '@commitverse/contracts';
import { query, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { briefs } from '@/lib/server/stars';

export const GET = route(
  { limits: [{ name: 'brief', max: 120, windowS: 60 }], cache: 'public, s-maxage=300, stale-while-revalidate=600' },
  async ({ url }) => {
    const { ids } = query(url, BriefQuery);
    return { stars: await briefs(await db(), ids) };
  },
);
