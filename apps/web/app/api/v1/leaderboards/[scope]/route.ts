import { LeaderboardQuery } from '@commitverse/contracts';
import { query, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { leaderboard } from '@/lib/server/queries';

export const GET = route<{ scope: string }>(
  { limits: [{ name: 'leaderboard', max: 60, windowS: 60 }], cache: 'public, s-maxage=300, stale-while-revalidate=600' },
  async ({ params, url }) => {
    const q = query(url, LeaderboardQuery);
    return leaderboard(await db(), decodeURIComponent(params.scope), q.metric, q.cursor, q.me);
  },
);
