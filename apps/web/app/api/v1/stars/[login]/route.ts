import { Login } from '@commitverse/contracts';
import { json, route } from '@/lib/server/api';
import { db, queue } from '@/lib/server/app';
import { requireStar, starDetail } from '@/lib/server/stars';

export const GET = route<{ login: string }>({ limits: [{ name: 'star', max: 60, windowS: 60 }] }, async ({ params }) => {
  const login = Login.parse(params.login);
  const d = await db();
  const u = await requireStar(d, login);
  const detail = await starDetail(d, u.githubId);
  // T2 refresh tier: viewed in the last 7 days → stale-while-revalidate refresh when > 24 h old.
  await d.query('update github_users set last_viewed_at = now() where github_id = $1', [u.githubId]);
  if (!u.synthetic && (!detail.fetchedAt || Date.now() - Date.parse(detail.fetchedAt) > 86_400_000)) {
    await (await queue()).send(
      'refresh',
      { githubId: u.githubId },
      { priority: 10, singletonKey: `r:${u.githubId}:view:${new Date().toISOString().slice(0, 13)}` },
    );
  }
  return json(detail, {
    cache: 'public, s-maxage=300, stale-while-revalidate=600',
    headers: u.redirectedFrom ? { 'x-commitverse-canonical-login': u.login } : {},
  });
});
