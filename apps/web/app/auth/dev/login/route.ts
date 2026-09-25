/** Local mode only: sign in as any mapped star (or a real user when GITHUB_TOKEN is set). Refused in production. */
import { LOGIN_RE } from '@commitverse/contracts';
import { fetchUser, hasGitHubCredentials, ingestUser } from '@commitverse/pipeline';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db, env, localMode, queue } from '@/lib/server/app';
import { DEV_COOKIE, signDevSession } from '@/lib/server/auth';
import { claimStar } from '@/lib/server/claim';

export async function POST(req: Request) {
  const base = env().APP_URL;
  if (!localMode()) return new Response('Not found', { status: 404 });
  const form = await req.formData();
  const login = String(form.get('login') ?? '')
    .replace(/^@/, '')
    .trim();
  const intent = form.get('intent') === 'remove' ? 'remove' : 'claim';
  const next = String(form.get('next') ?? '/');
  if (!LOGIN_RE.test(login)) return NextResponse.redirect(`${base}/auth/dev?error=invalid`, { status: 303 });
  const d = await db();
  let [u] = await d.query<{ github_id: number; login: string; avatar_url: string | null }>(
    'select github_id, login::text as login, avatar_url from github_users where login = $1 and not is_opted_out',
    [login],
  );
  if (!u && hasGitHubCredentials()) {
    const r = await fetchUser(d, login);
    if (r.kind === 'user') {
      await ingestUser(d, r.fetched);
      u = { github_id: r.fetched.githubId, login: r.fetched.login, avatar_url: r.fetched.avatarUrl };
    }
  }
  if (!u) return NextResponse.redirect(`${base}/auth/dev?error=unknown&login=${encodeURIComponent(login)}`, { status: 303 });
  let [au] = await d.query<{ id: string }>(`select id from auth.users where raw_user_meta_data->>'provider_id' = $1`, [
    String(u.github_id),
  ]);
  if (!au) {
    [au] = await d.query<{ id: string }>(`insert into auth.users (raw_user_meta_data) values ($1) returning id`, [
      JSON.stringify({ provider_id: String(u.github_id), user_name: u.login }),
    ]);
  }
  const jar = await cookies();
  jar.set(DEV_COOKIE, signDevSession({ sub: au!.id, gid: u.github_id, iat: Date.now() }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: base.startsWith('https'),
    path: '/',
    maxAge: 30 * 86_400,
  });
  if (intent === 'remove') return NextResponse.redirect(`${base}/settings?confirm=remove`, { status: 303 });
  await claimStar(d, await queue(), {
    authUserId: au!.id,
    githubId: u.github_id,
    login: u.login,
    avatarUrl: u.avatar_url,
    refCookie: jar.get('cv_ref')?.value,
  });
  const dest = next !== '/' && next.startsWith('/') && !next.startsWith('//') ? next : `/@${u.login}?ignite=1`;
  return NextResponse.redirect(`${base}${dest}`, { status: 303 });
}
