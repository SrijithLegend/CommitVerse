import { z } from 'zod';
import { query, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { search } from '@/lib/server/stars';

const Q = z.object({ q: z.string().min(1).max(64) });

export const GET = route(
  { limits: [{ name: 'search', max: 30, windowS: 10 }], cache: 'public, s-maxage=30, stale-while-revalidate=120' },
  async ({ url }) => {
    const { q } = query(url, Q);
    return { results: await search(await db(), q) };
  },
);
