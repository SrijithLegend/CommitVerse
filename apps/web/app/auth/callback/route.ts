import { log } from '@commitverse/pipeline';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db, env, queue } from '@/lib/server/app';
import { supabaseServer } from '@/lib/server/auth';
import { claimStar } from '@/lib/server/claim';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = env().APP_URL;
  const code = url.searchParams.get('code');
  const intent = url.searchParams.get('intent') === 'remove' ? 'remove' : 'claim';
  const next = url.searchParams.get('next') ?? '/';
  if (!code) return NextResponse.redirect(`${base}/?auth_error=missing_code`);
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) return NextResponse.redirect(`${base}/?auth_error=exchange_failed`);
  const u = data.session.user;
  const githubId = Number(u.user_metadata?.provider_id ?? u.identities?.find((i) => i.provider === 'github')?.id);
  const login = String(u.user_metadata?.user_name ?? '');
  if (!githubId || !login) return NextResponse.redirect(`${base}/?auth_error=no_github_identity`);
  if (intent === 'remove') return NextResponse.redirect(`${base}/settings?confirm=remove`);
  try {
    const jar = await cookies();
    await claimStar(await db(), await queue(), {
      authUserId: u.id,
      githubId,
      login,
      avatarUrl: u.user_metadata?.avatar_url ?? null,
      providerToken: data.session.provider_token ?? null,
      sync: url.searchParams.get('sync') === '1',
      refCookie: jar.get('cv_ref')?.value ?? null,
    });
  } catch (err) {
    log.error({ err: String(err), login }, 'claim failed');
    return NextResponse.redirect(`${base}/?auth_error=claim_failed`);
  }
  const dest = next !== '/' && next.startsWith('/') && !next.startsWith('//') ? next : `/@${login}?ignite=1`;
  return NextResponse.redirect(`${base}${dest}`);
}
