/** F9 — referral link: first-touch cookie (30 days), then land on the home page with the referrer highlighted. */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db, env } from '@/lib/server/app';

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const code = (await ctx.params).code;
  const base = env().APP_URL;
  if (!/^[0-9a-zA-Z]{6,16}$/.test(code)) return NextResponse.redirect(base);
  const [ref] = await (await db()).query<{ login: string }>(
    `select u.login::text as login from accounts a join github_users u using (github_id) where a.referral_code = $1 and not u.is_opted_out`,
    [code],
  );
  if (!ref) return NextResponse.redirect(base);
  const jar = await cookies();
  if (!jar.get('cv_ref')) {
    jar.set('cv_ref', `${code}|${Date.now()}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: base.startsWith('https'),
      maxAge: 30 * 86_400,
      path: '/',
    });
  }
  return NextResponse.redirect(`${base}/?invitedBy=${encodeURIComponent(ref.login)}`);
}
