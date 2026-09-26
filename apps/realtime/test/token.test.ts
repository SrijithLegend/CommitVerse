import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';

const secret = 'test-secret';
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const sign = async (claims: object, key = secret) => {
  const p = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${p}.${b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(p))))}`;
};

let forwarded: Request | null = null;
const env = {
  REALTIME_SHARED_SECRET: secret,
  SECTORS: {
    idFromName: (n: string) => n,
    get: () => ({
      fetch: async (r: Request) => {
        forwarded = r;
        return new Response('joined');
      },
    }),
  },
} as unknown as Env;

const join = (sector: string, token: string) =>
  worker.fetch(new Request(`https://rt/sector/${encodeURIComponent(sector)}?token=${token}`, { headers: { upgrade: 'websocket' } }), env);

describe('F15 sector-join tokens', () => {
  const sector = '1:r012345';
  const fresh = { sector, gid: 42, login: 'octo', exp: Date.now() + 60_000 };

  it('accepts a valid token and forwards identity to the sector DO', async () => {
    const r = await join(sector, await sign(fresh));
    expect(r.status).toBe(200);
    expect(forwarded?.headers.get('x-cv-gid')).toBe('42');
    expect(forwarded?.headers.get('x-cv-login')).toBe('octo');
  });

  it.each([
    ['forged signature', sign(fresh, 'other-secret')],
    ['expired', sign({ ...fresh, exp: Date.now() - 1 })],
    ['other sector', sign({ ...fresh, sector: '1:r999' })],
    ['malformed base64', 'not*base64.@@@'],
    ['no signature', 'abc'],
    ['empty', ''],
  ])('rejects %s with 403', async (_, token) => {
    expect((await join(sector, await token)).status).toBe(403);
  });

  it('requires a websocket upgrade and a known route', async () => {
    expect((await worker.fetch(new Request(`https://rt/sector/x?token=${await sign(fresh)}`), env)).status).toBe(426);
    expect((await worker.fetch(new Request('https://rt/nope'), env)).status).toBe(404);
    expect(await (await worker.fetch(new Request('https://rt/healthz'), env)).text()).toBe('ok');
  });
});
