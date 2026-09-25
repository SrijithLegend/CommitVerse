import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { env } from '@/lib/server/app';
import { DEV_COOKIE, supabaseConfigured, supabaseServer } from '@/lib/server/auth';

export async function POST() {
  if (supabaseConfigured()) await (await supabaseServer()).auth.signOut();
  (await cookies()).delete(DEV_COOKIE);
  return NextResponse.redirect(`${env().APP_URL}/`, { status: 303 });
}
