import type { MetadataRoute } from 'next';
import { db } from '@/lib/server/app';

export const revalidate = 86400;

/** Indexable profiles only (§F4): claimed stars + the top 50k by impact. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  const d = await db();
  const stars = await d.query<{ login: string }>(
    `select u.login::text as login from bodies b join github_users u using (github_id)
     where not u.is_opted_out and not u.synthetic and ((b.flags & 1) = 1 or b.rank_global <= 50000) order by b.rank_global limit 50000`,
  );
  const galaxies = await d.query<{ language: string }>('select language from galaxies');
  const fixed = ['', '/leaderboards', '/census', '/achievements', '/chart', '/replay', '/shop', '/feed'].map((p) => ({ url: `${base}${p}`, changeFrequency: 'daily' as const }));
  return [
    ...fixed,
    ...galaxies.map((g) => ({ url: `${base}/galaxy/${encodeURIComponent(g.language)}`, changeFrequency: 'daily' as const })),
    ...stars.map((s) => ({ url: `${base}/@${s.login}`, changeFrequency: 'weekly' as const })),
  ];
}
