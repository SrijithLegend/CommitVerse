import { z } from 'zod';
import { query, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { feed } from '@/lib/server/queries';

const Q = z.object({ cursor: z.coerce.number().int().positive().optional() });

export const GET = route(
  { limits: [{ name: 'feed', max: 60, windowS: 60 }], cache: 'public, s-maxage=10, stale-while-revalidate=30' },
  async ({ url }) => feed(await db(), query(url, Q).cursor ?? null),
);
