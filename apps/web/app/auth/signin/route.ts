/** "Claim your star" / "Remove my star" entry point. GitHub OAuth via Supabase, scope read:user only (§11.2). */
import { NextResponse } from 'next/server';
import { env, localMode } from '@/lib/server/app';
import { supabaseConfigured, supabaseServer } from '@/lib/server/auth';

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

export async function GET(req: Request) {
  const url = new URL(req.url);
  const intent = url.searchParams.get('intent') === 'remove' ? 'remove' : 'claim';
  const sync = url.searchParams.get('sync') === '1' ? '1' : '0';
  const next = safeNext(url.searchParams.get('next'));
  if (supabaseConfigured()) {
    const supabase = await supabaseServer();
    const redirectTo = `${env().APP_URL}/auth/callback?intent=${intent}&sync=${sync}&next=${encodeURIComponent(next)}`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo, scopes: 'read:user', skipBrowserRedirect: true },
    });
    if (error || !data.url) return NextResponse.redirect(`${env().APP_URL}/?auth_error=1`);
    return NextResponse.redirect(data.url);
  }
  if (localMode()) return NextResponse.redirect(`${env().APP_URL}/auth/dev?intent=${intent}&next=${encodeURIComponent(next)}`);
  return NextResponse.redirect(`${env().APP_URL}/?auth_error=not_configured`);
}
