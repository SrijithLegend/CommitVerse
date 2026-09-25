import type { JobDto } from '@commitverse/contracts';
import { z } from 'zod';
import { route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { ApiError } from '@/lib/server/errors';

export const GET = route<{ id: string }>({ limits: [{ name: 'jobs', max: 60, windowS: 60 }] }, async ({ params }): Promise<JobDto> => {
  const id = z.string().uuid().parse(params.id);
  const d = await db();
  const [j] = await d.query<{
    id: string;
    status: JobDto['status'];
    login: string;
    error: string | null;
    github_id: number | null;
    created_at: Date;
  }>('select id, status, login::text as login, error, github_id, created_at from materialize_jobs where id = $1', [id]);
  if (!j) throw new ApiError(404, 'job_not_found', 'No such job');
  let queuePosition: number | null = null;
  if (j.status === 'queued') {
    const [{ n }] = (await d.query<{ n: number }>(
      `select count(*)::int as n from materialize_jobs where status = 'queued' and created_at <= $1`,
      [j.created_at],
    )) as [{ n: number }];
    queuePosition = n;
  }
  return { id: j.id, status: j.status, login: j.login, queuePosition, error: j.error, githubId: j.github_id };
});
