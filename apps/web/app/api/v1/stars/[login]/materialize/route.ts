/**
 * F2 — materialize an unknown user ("star forming"). 202 {jobId} or 200 if already mapped; 404 if not a GitHub user.
 * Abuse guard (§11.5): 5/min + 50/day per IP, Turnstile after 3 per session, global budget guard in the worker.
 */
import { Login } from '@commitverse/contracts';
import { budgetFraction, hasGitHubCredentials } from '@commitverse/pipeline';
import { cookies } from 'next/headers';
import { json, route } from '@/lib/server/api';
import { db, queue } from '@/lib/server/app';
import { ApiError } from '@/lib/server/errors';
import { resolveLogin } from '@/lib/server/stars';

async function verifyTurnstile(token: string | null, ip: string): Promise<boolean> {
  if (!process.env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
  });
  return ((await res.json()) as { success?: boolean }).success === true;
}

export const POST = route<{ login: string }>(
  {
    limits: [
      { name: 'materialize-min', max: 5, windowS: 60 },
      { name: 'materialize-day', max: 50, windowS: 86_400 },
    ],
  },
  async ({ params, req, ip }) => {
    const login = Login.parse(params.login);
    const d = await db();
    const existing = await resolveLogin(d, login);
    if (existing?.optedOut) throw new ApiError(410, 'removed', 'This star was removed at its owner’s request');
    if (existing) {
      const [b] = await d.query('select 1 from bodies where github_id = $1', [existing.githubId]);
      if (b) return json({ jobId: null, status: 'mapped', login: existing.login });
    }
    if (!hasGitHubCredentials()) {
      throw new ApiError(503, 'github_unavailable', 'Live materialization needs GitHub credentials on this deployment');
    }

    const jar = await cookies();
    const count = Number(jar.get('cv_mat')?.value ?? 0);
    if (count >= 3 && process.env.TURNSTILE_SECRET_KEY) {
      if (!(await verifyTurnstile(req.headers.get('cf-turnstile-response'), ip))) {
        throw new ApiError(403, 'challenge_required', 'Please complete the challenge to keep forming stars');
      }
    }
    jar.set('cv_mat', String(count + 1), { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 86_400, path: '/' });

    let [job] = await d.query<{ id: string }>(
      `insert into materialize_jobs (login, priority) values ($1, 100) on conflict do nothing returning id`,
      [login],
    );
    if (!job) {
      [job] = await d.query<{ id: string }>(
        `select id from materialize_jobs where login = $1 and status in ('queued','fetching','placing')`,
        [login],
      );
    } else {
      await (await queue()).send('materialize', { jobId: job.id, login }, { priority: 100, singletonKey: `m:${login.toLowerCase()}` });
    }
    const [{ pos }] = (await d.query<{ pos: number }>(
      `select count(*)::int as pos from materialize_jobs where status = 'queued' and created_at <= (select created_at from materialize_jobs where id = $1)`,
      [job!.id],
    )) as [{ pos: number }];
    return json({ jobId: job!.id, status: 'queued', login, queuePosition: pos, budgetLow: budgetFraction() < 0.15 }, { status: 202 });
  },
);
