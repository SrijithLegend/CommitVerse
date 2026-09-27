/** API route wrapper: rate limits, auth, Zod validation → RFC 9457 problems, Sentry capture. */
import 'server-only';
import { log } from '@commitverse/pipeline';
import { ZodError, type z } from 'zod';
import { getSession, type Session } from './auth';
import { ApiError, problem } from './errors';
import { clientIp, rateLimit } from './ratelimit';

export interface Limit {
  name: string;
  max: number;
  windowS: number;
  by?: 'ip' | 'user';
}

export interface Ctx<P> {
  req: Request;
  params: P;
  ip: string;
  session: Session | null;
  url: URL;
}

type Auth = 'none' | 'optional' | 'user' | 'claimed' | 'admin';

export interface RouteOptions {
  auth?: Auth;
  limits?: Limit[];
  cache?: string;
}

export const json = (data: unknown, init: { status?: number; headers?: Record<string, string>; cache?: string } = {}): Response =>
  new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', 'cache-control': init.cache ?? 'no-store', ...init.headers },
  });

export async function body<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be JSON');
  }
  return schema.parse(raw);
}

export const query = <S extends z.ZodType>(url: URL, schema: S): z.infer<S> => schema.parse(Object.fromEntries(url.searchParams));

export function route<P = Record<string, string>>(opts: RouteOptions, fn: (ctx: Ctx<P>) => Promise<Response | unknown>) {
  return async (req: Request, context: { params: Promise<P> }): Promise<Response> => {
    const ip = clientIp(req);
    try {
      // CSRF defence in depth (cookies are also SameSite=Lax): a browser-sent state change must come from our origin.
      // Server-to-server callers (webhooks, the VS Code extension) send no Origin header and are unaffected.
      const origin = req.headers.get('origin');
      const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
      if (origin && req.method !== 'GET' && req.method !== 'HEAD' && (!URL.canParse(origin) || new URL(origin).host !== host))
        throw new ApiError(403, 'cross_origin', 'Cross-origin request refused');
      const needsSession = opts.auth && opts.auth !== 'none';
      const session = needsSession || opts.limits?.some((l) => l.by === 'user') ? await getSession() : null;
      if (opts.auth === 'user' || opts.auth === 'claimed' || opts.auth === 'admin') {
        if (!session) throw new ApiError(401, 'unauthorized', 'Sign in required');
        if (session.banned) throw new ApiError(403, 'banned', 'This account is banned');
        if (opts.auth === 'claimed' && !session.claimed) throw new ApiError(403, 'not_claimed', 'Claim your star first');
        if (opts.auth === 'admin' && !session.isAdmin)
          throw new ApiError(403, 'forbidden', 'Admins only (allow-list + role + session < 8 h)');
      }
      for (const l of opts.limits ?? []) {
        const id = l.by === 'user' ? `u:${session?.githubId ?? ip}` : `ip:${ip}`;
        const r = await rateLimit(l.name, id, l.max, l.windowS);
        if (!r.ok) {
          const retry = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
          throw new ApiError(429, 'rate_limited', `Slow down — try again in ${retry}s`, { 'retry-after': String(retry) });
        }
      }
      const params = (await context.params) ?? ({} as P);
      const out = await fn({ req, params, ip, session, url: new URL(req.url) });
      if (out instanceof Response) return out;
      return json(out, { cache: opts.cache });
    } catch (err) {
      if (err instanceof ApiError) return problem(err.status, err.code, err.message, err.headers);
      if (err instanceof ZodError)
        return problem(400, 'validation_failed', err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
      log.error({ err: err instanceof Error ? err.stack : String(err), path: new URL(req.url).pathname }, 'api error');
      try {
        const Sentry = await import('@sentry/nextjs');
        Sentry.captureException(err);
      } catch {}
      return problem(500, 'internal', 'Something went wrong on our side');
    }
  };
}
