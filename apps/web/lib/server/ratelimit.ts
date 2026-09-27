/** Sliding-window rate limits (§10): Upstash Redis in production, in-memory in local mode. */
import 'server-only';

export interface LimitResult {
  ok: boolean;
  remaining: number;
  reset: number; // epoch ms
}

const memory = new Map<string, number[]>();

function memoryLimit(key: string, max: number, windowS: number): LimitResult {
  const now = Date.now();
  const since = now - windowS * 1000;
  const hits = (memory.get(key) ?? []).filter((t) => t > since);
  const ok = hits.length < max;
  if (ok) hits.push(now);
  memory.set(key, hits);
  if (memory.size > 50_000) for (const k of [...memory.keys()].slice(0, 10_000)) memory.delete(k);
  return { ok, remaining: Math.max(0, max - hits.length), reset: (hits[0] ?? now) + windowS * 1000 };
}

type Limiter = { limit: (id: string) => Promise<{ success: boolean; remaining: number; reset: number }> };
const limiters = new Map<string, Limiter>();

async function upstash(name: string, max: number, windowS: number): Promise<Limiter> {
  const k = `${name}:${max}:${windowS}`;
  const existing = limiters.get(k);
  if (existing) return existing;
  const { Ratelimit } = await import('@upstash/ratelimit');
  const { Redis } = await import('@upstash/redis');
  const l = new Ratelimit({
    redis: new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! }),
    limiter: Ratelimit.slidingWindow(max, `${windowS} s`),
    prefix: `cv:rl:${name}`,
    analytics: false,
  });
  limiters.set(k, l);
  return l;
}

export async function rateLimit(name: string, id: string, max: number, windowS: number): Promise<LimitResult> {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const r = await (await upstash(name, max, windowS)).limit(id);
    return { ok: r.success, remaining: r.remaining, reset: r.reset };
  }
  return memoryLimit(`${name}:${id}`, max, windowS);
}

export function clientIp(req: Request): string {
  // proxy-set headers first: the first X-Forwarded-For entry is client-controlled on hosts that append rather than
  // overwrite it, which would let a caller rotate identities past every IP rate limit (§11.5)
  const trusted = req.headers.get('x-real-ip') ?? req.headers.get('cf-connecting-ip');
  if (trusted) return trusted.trim();
  const xff = req.headers.get('x-forwarded-for');
  return xff ? xff.split(',')[0]!.trim() : '127.0.0.1';
}
