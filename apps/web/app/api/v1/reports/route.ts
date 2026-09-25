import { ReportBody } from '@commitverse/contracts';
import { body, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';

export const POST = route(
  { auth: 'user', limits: [{ name: 'reports', max: 10, windowS: 86_400, by: 'user' }] },
  async ({ req, session }) => {
    const r = await body(req, ReportBody);
    const [row] = await (await db()).query<{ id: number }>(
      'insert into reports (reporter_id, target_type, target_id, reason) values ($1, $2, $3, $4) returning id',
      [session!.githubId, r.targetType, r.targetId, r.reason.slice(0, 500)],
    );
    return { id: row!.id, status: 'open' };
  },
);
