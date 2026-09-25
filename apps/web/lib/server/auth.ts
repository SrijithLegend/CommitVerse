/**
 * Auth. Production: Supabase Auth (GitHub provider, scope read:user only — never `repo`).
 * Local mode: HMAC-signed dev sessions (sign in as any mapped star). Dev sessions are refused in production.
 */
import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '@commitverse/db';
import { cookies } from 'next/headers';
import { db, env, localMode } from './app';

export interface Session {
  authUserId: string;
  githubId: number;
  login: string;
  claimed: boolean;
  role: 'user' | 'admin';
  isAdmin: boolean;
  banned: boolean;
  issuedAt: number;
  providerToken?: string | null;
}

export const DEV_COOKIE = 'cv_session';
const ADMIN_SESSION_MS = 8 * 3_600_000;

export const supabaseConfigured = (): boolean => !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

function devSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const dir = process.env.DATA_DIR && process.env.DATA_DIR !== ':memory:' ? process.env.DATA_DIR : join(repoRoot(), '.data');
  const file = join(dir, 'dev-session-secret');
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, randomBytes(32).toString('hex'));
  }
  return readFileSync(file, 'utf8');
}

export function signDevSession(payload: { sub: string; gid: number; iat: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', devSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyDevSession(token: string): { sub: string; gid: number; iat: number } | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', devSecret()).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as { sub: string; gid: number; iat: number };
  if (Date.now() - p.iat > 30 * 86_400_000) return null;
  return p;
}

export async function supabaseServer() {
  const { createServerClient } = await import('@supabase/ssr');
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {
          // called from a Server Component: the proxy refreshes cookies instead
        }
      },
    },
  });
}

async function identity(): Promise<{ authUserId: string; githubId: number; login: string; issuedAt: number } | null> {
  if (supabaseConfigured()) {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    const u = data.user;
    if (!u) return null;
    const gh = u.identities?.find((i) => i.provider === 'github');
    const githubId = Number(u.user_metadata?.provider_id ?? gh?.id);
    const login = String(u.user_metadata?.user_name ?? u.user_metadata?.preferred_username ?? '');
    if (!githubId || !login) return null;
    return { authUserId: u.id, githubId, login, issuedAt: Date.parse(u.last_sign_in_at ?? u.created_at) };
  }
  if (!localMode()) return null;
  const raw = (await cookies()).get(DEV_COOKIE)?.value;
  const p = raw ? verifyDevSession(raw) : null;
  if (!p) return null;
  const [u] = await (await db()).query<{ login: string }>('select login::text as login from github_users where github_id = $1', [p.gid]);
  if (!u) return null;
  return { authUserId: p.sub, githubId: p.gid, login: u.login, issuedAt: p.iat };
}

export async function getSession(): Promise<Session | null> {
  const id = await identity();
  if (!id) return null;
  const [acct] = await (await db()).query<{ role: 'user' | 'admin'; banned_at: Date | null }>(
    'select role, banned_at from accounts where auth_user_id = $1 and github_id = $2',
    [id.authUserId, id.githubId],
  );
  const allow = env()
    .ADMIN_GITHUB_LOGINS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const role = acct?.role ?? 'user';
  return {
    ...id,
    claimed: !!acct,
    role,
    banned: !!acct?.banned_at,
    // §F20: allow-list AND db role, both required; admin sessions last 8 hours (§11.5).
    isAdmin: role === 'admin' && allow.includes(id.login.toLowerCase()) && Date.now() - id.issuedAt < ADMIN_SESSION_MS,
  };
}
