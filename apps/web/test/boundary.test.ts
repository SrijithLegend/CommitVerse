/** §11 request boundaries: CSRF origin check in the API wrapper, and which header identifies the client IP. */
import { describe, expect, it } from 'vitest';
import { route } from '@/lib/server/api';
import { clientIp } from '@/lib/server/ratelimit';

const handler = route({}, async () => ({ ok: true }));
const call = (method: string, headers: Record<string, string>) =>
  handler(new Request('https://commitverse.test/api/v1/x', { method, headers: { host: 'commitverse.test', ...headers } }), {
    params: Promise.resolve({}),
  });

describe('CSRF origin check', () => {
  it('allows same-origin browser writes and server-to-server calls without an Origin', async () => {
    expect((await call('POST', { origin: 'https://commitverse.test' })).status).toBe(200);
    expect((await call('POST', {})).status).toBe(200);
  });

  it('refuses cross-origin and opaque (null) origins on state-changing methods', async () => {
    for (const origin of ['https://evil.test', 'null', 'https://commitverse.test.evil.test']) {
      const r = await call('POST', { origin });
      expect(r.status, origin).toBe(403);
      expect((await r.json()).code).toBe('cross_origin');
    }
    expect((await call('DELETE', { origin: 'https://evil.test' })).status).toBe(403);
  });

  it('leaves reads alone', async () => {
    expect((await call('GET', { origin: 'https://evil.test' })).status).toBe(200);
  });
});

describe('client IP', () => {
  const ip = (h: Record<string, string>) => clientIp(new Request('https://x.test', { headers: h }));
  it('prefers proxy-set headers over a client-supplied X-Forwarded-For', () => {
    expect(ip({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '1.2.3.4' })).toBe('1.2.3.4');
    expect(ip({ 'x-forwarded-for': '6.6.6.6', 'cf-connecting-ip': '5.6.7.8' })).toBe('5.6.7.8');
    expect(ip({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' })).toBe('9.9.9.9');
    expect(ip({})).toBe('127.0.0.1');
  });
});
