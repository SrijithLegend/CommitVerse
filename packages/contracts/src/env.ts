/**
 * §15 — env validation. The process refuses to start if a required variable is missing.
 *
 * Commitverse runs in two modes:
 *  - production: Supabase Postgres, GitHub App, R2, Upstash, payments — all required.
 *  - local (default when DATABASE_URL is absent and NODE_ENV !== 'production'): embedded Postgres (PGlite)
 *    under .data/, tiles on local disk, in-memory rate limits, dev sign-in, mock payments.
 */
import { z } from 'zod';

const opt = z.string().min(1).optional();

export const ServerEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: opt,
  NEXT_PUBLIC_SUPABASE_URL: opt,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: opt,
  SUPABASE_SERVICE_ROLE_KEY: opt,
  GITHUB_TOKEN: opt,
  GITHUB_APP_ID: opt,
  GITHUB_APP_PRIVATE_KEY: opt,
  GITHUB_APP_INSTALLATION_ID: opt,
  GITHUB_WEBHOOK_SECRET: opt,
  GITHUB_OAUTH_CLIENT_ID: opt,
  GITHUB_OAUTH_CLIENT_SECRET: opt,
  TOKEN_ENC_ACTIVE_KID: opt,
  UPSTASH_REDIS_REST_URL: opt,
  UPSTASH_REDIS_REST_TOKEN: opt,
  R2_ACCOUNT_ID: opt,
  R2_ACCESS_KEY_ID: opt,
  R2_SECRET_ACCESS_KEY: opt,
  R2_BUCKET: opt,
  NEXT_PUBLIC_TILES_BASE_URL: opt,
  NEXT_PUBLIC_REALTIME_URL: opt,
  REALTIME_SHARED_SECRET: opt,
  PAYMENT_PROVIDER: z.enum(['stripe', 'paddle', 'mock']).optional(),
  STRIPE_SECRET_KEY: opt,
  STRIPE_WEBHOOK_SECRET: opt,
  PADDLE_API_KEY: opt,
  PADDLE_WEBHOOK_SECRET: opt,
  PADDLE_ENV: z.enum(['sandbox', 'production']).optional(),
  RESEND_API_KEY: opt,
  EMAIL_FROM: opt,
  TURNSTILE_SITE_KEY: opt,
  TURNSTILE_SECRET_KEY: opt,
  SENTRY_DSN: opt,
  NEXT_PUBLIC_SENTRY_DSN: opt,
  NEXT_PUBLIC_POSTHOG_KEY: opt,
  POSTHOG_HOST: opt,
  ADMIN_GITHUB_LOGINS: z.string().default(''),
  BAKE_CRON: z.string().default('0 2 * * *'),
  LAUNCH_DATE: z.string().default('2026-10-01'),
  SESSION_SECRET: opt,
  DATA_DIR: z.string().default('.data'),
});
export type ServerEnv = z.infer<typeof ServerEnv>;

/** Variables that MUST be set in production (§15). */
export const PRODUCTION_REQUIRED: (keyof ServerEnv)[] = [
  'APP_URL',
  'DATABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_INSTALLATION_ID',
  'GITHUB_WEBHOOK_SECRET',
  'TOKEN_ENC_ACTIVE_KID',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'NEXT_PUBLIC_TILES_BASE_URL',
  'PAYMENT_PROVIDER',
  'SESSION_SECRET',
];

export function parseServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const env = ServerEnv.parse(source);
  if (env.NODE_ENV === 'production' && source.SKIP_ENV_VALIDATION !== '1') {
    // read the raw source: schema defaults (APP_URL → localhost) must not satisfy a production requirement
    const missing = PRODUCTION_REQUIRED.filter((k) => !source[k]);
    if (env.TOKEN_ENC_ACTIVE_KID && !source[`TOKEN_ENC_KEY_${env.TOKEN_ENC_ACTIVE_KID}`]) missing.push('TOKEN_ENC_ACTIVE_KID');
    if (env.PAYMENT_PROVIDER === 'mock') missing.push('PAYMENT_PROVIDER');
    if (missing.length) throw new Error(`Missing/invalid required production env: ${[...new Set(missing)].join(', ')}`);
  }
  return env;
}

export const isLocalMode = (env: Pick<ServerEnv, 'DATABASE_URL' | 'NODE_ENV'>): boolean =>
  !env.DATABASE_URL && env.NODE_ENV !== 'production';
