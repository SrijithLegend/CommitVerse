/**
 * GitHub access (§8.3–8.4). GitHub App installation token in production, a personal token (GITHUB_TOKEN)
 * for local development, or a user's own delegated sync token. Requests are serial per token; Retry-After and
 * x-ratelimit-reset are honoured; every GraphQL call's rateLimit.cost is logged.
 *
 * Never pool tokens from multiple accounts to multiply limits (GitHub AUP) — the only multipliers are the
 * user-delegated tokens, conditional requests, GH Archive, refresh tiers and opt-in App installations.
 */
import { createSign } from 'node:crypto';
import type { Db } from '@commitverse/db';
import { log } from './log';

const API = 'https://api.github.com';
const UA = 'commitverse (+https://github.com/SrijithLegend/CommitVerse)';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: 'not_found' | 'unauthorized' | 'rate_limited' | 'server' | 'graphql' = 'server',
  ) {
    super(message);
  }
}

export interface Budget {
  limit: number;
  remaining: number;
  resetAt: string;
}

/** Shared budget for the app token (what the materialize guard reads). */
export const budget: Budget = { limit: 5000, remaining: 5000, resetAt: new Date(Date.now() + 3600_000).toISOString() };
export const budgetFraction = (): number => (Date.parse(budget.resetAt) < Date.now() ? 1 : budget.remaining / Math.max(1, budget.limit));

// ─── Tokens ───────────────────────────────────────────────────────────────

let appToken: { token: string; expiresAt: number } | null = null;

function appJwt(appId: string, privateKeyPem: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(privateKeyPem.replace(/\\n/g, '\n'), 'base64url');
  return `${unsigned}.${sig}`;
}

export const hasAppCredentials = (): boolean =>
  !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_APP_INSTALLATION_ID);

/** The app's own token: App installation token (preferred) or GITHUB_TOKEN (local dev). */
export async function appTokenFor(): Promise<string> {
  if (hasAppCredentials()) {
    if (appToken && appToken.expiresAt - Date.now() > 5 * 60_000) return appToken.token;
    const jwt = appJwt(process.env.GITHUB_APP_ID!, process.env.GITHUB_APP_PRIVATE_KEY!);
    const res = await fetch(`${API}/app/installations/${process.env.GITHUB_APP_INSTALLATION_ID}/access_tokens`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'user-agent': UA },
    });
    if (!res.ok) throw new GitHubError(`installation token: ${res.status}`, res.status, 'unauthorized');
    const j = (await res.json()) as { token: string; expires_at: string };
    appToken = { token: j.token, expiresAt: Date.parse(j.expires_at) };
    return j.token;
  }
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  throw new GitHubError('No GitHub credentials configured (GITHUB_APP_* or GITHUB_TOKEN)', 0, 'unauthorized');
}

export const hasGitHubCredentials = (): boolean => hasAppCredentials() || !!process.env.GITHUB_TOKEN;

// ─── Serial-per-token execution ───────────────────────────────────────────

const chains = new Map<string, Promise<unknown>>();
function serial<T>(token: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(token) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(
    token,
    next.catch(() => {}),
  );
  return next;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitFor(res: Response, attempt: number): number {
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) return Math.min(120, Number(retryAfter)) * 1000;
  const reset = res.headers.get('x-ratelimit-reset');
  if (res.headers.get('x-ratelimit-remaining') === '0' && reset) return Math.max(1000, Number(reset) * 1000 - Date.now());
  return Math.min(60_000, 1000 * 2 ** attempt) * (0.5 + Math.random());
}

// ─── GraphQL ──────────────────────────────────────────────────────────────

export interface GraphQLOptions {
  token?: string;
  shape: string;
  db?: Db;
  /** Update the shared app budget (false for user-delegated tokens). */
  trackBudget?: boolean;
}

export async function graphql<T>(query: string, variables: Record<string, unknown>, opts: GraphQLOptions): Promise<T> {
  const token = opts.token ?? (await appTokenFor());
  const trackBudget = opts.trackBudget ?? !opts.token;
  return serial(token, async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}/graphql`, {
        method: 'POST',
        headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', 'user-agent': UA },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 401) throw new GitHubError('GitHub token rejected', 401, 'unauthorized');
      if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < 4) {
        const ms = waitFor(res, attempt);
        log.warn({ status: res.status, waitMs: Math.round(ms), shape: opts.shape }, 'github backoff');
        await sleep(ms);
        continue;
      }
      if (!res.ok)
        throw new GitHubError(
          `GitHub GraphQL ${res.status}`,
          res.status,
          res.status === 403 || res.status === 429 ? 'rate_limited' : 'server',
        );
      const body = (await res.json()) as {
        data?: T & { rateLimit?: { cost: number; remaining: number; resetAt: string; limit?: number } };
        errors?: { type?: string; message: string }[];
      };
      const rl = body.data?.rateLimit;
      if (rl) {
        if (trackBudget) {
          budget.remaining = rl.remaining;
          budget.resetAt = rl.resetAt;
          if (rl.limit) budget.limit = rl.limit;
        }
        log.info({ shape: opts.shape, rate_cost: rl.cost, remaining: rl.remaining }, 'github graphql');
        await opts.db
          ?.query('insert into github_cost_log (shape, cost, remaining) values ($1, $2, $3)', [opts.shape, rl.cost, rl.remaining])
          .catch(() => {});
      }
      if (body.errors?.length) {
        if (body.errors.some((e) => e.type === 'NOT_FOUND')) return body.data as T;
        if (body.errors.some((e) => e.type === 'RATE_LIMITED') && attempt < 4) {
          await sleep(waitFor(res, attempt));
          continue;
        }
        throw new GitHubError(body.errors.map((e) => e.message).join('; '), 200, 'graphql');
      }
      return body.data as T;
    }
  });
}

// ─── REST (conditional requests) ─────────────────────────────────────────

export interface RestResult<T> {
  status: number;
  etag: string | null;
  data: T | null;
  pollInterval: number | null;
}

/** Conditional GET. A 304 doesn't count against the primary rate limit. */
export async function restGet<T>(path: string, etag?: string | null, token?: string): Promise<RestResult<T>> {
  const t = token ?? (await appTokenFor());
  return serial(t, async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}${path}`, {
        headers: {
          authorization: `Bearer ${t}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': UA,
          ...(etag ? { 'if-none-match': etag } : {}),
        },
      });
      const pollInterval = Number(res.headers.get('x-poll-interval')) || null;
      if (res.status === 304) return { status: 304, etag: etag ?? null, data: null, pollInterval };
      if (res.status === 404) return { status: 404, etag: null, data: null, pollInterval };
      if (res.status === 401) throw new GitHubError('GitHub token rejected', 401, 'unauthorized');
      if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < 3) {
        await sleep(waitFor(res, attempt));
        continue;
      }
      if (!res.ok) throw new GitHubError(`GitHub REST ${res.status} ${path}`, res.status);
      return { status: res.status, etag: res.headers.get('etag'), data: (await res.json()) as T, pollInterval };
    }
  });
}
