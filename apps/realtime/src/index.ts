/**
 * F15 presence — Cloudflare Worker + one Durable Object per active sector (octree node at level 6).
 * Clients send 5 Hz quantized STATE (22 B). The DO never relays each message to everyone (O(N²)); instead a 5 Hz tick
 * sends ONE batched snapshot per client containing only its 50 nearest ships. WebSocket hibernation keeps idle
 * sectors free; per-connection state lives in the socket attachment.
 */
import { EMOTES, encodeSnapshot, MSG, statePos } from '@commitverse/contracts/presence';

export interface Env {
  SECTORS: DurableObjectNamespace;
  REALTIME_SHARED_SECRET: string;
}

interface Attachment {
  id: number;
  gid: number | null;
  login: string | null;
  hull: number;
  last: number;
  state: number[] | null; // raw STATE bytes (22) — kept as numbers so it serialises
}

const NEAREST = 50;
const TICK_MS = 200;
const MIN_INTERVAL_MS = 90; // ignore clients sending faster than ~10 Hz
const IDLE_MS = 15_000;

async function verify(token: string, secret: string): Promise<{ sector: string; gid: number | null; login: string | null; exp: number } | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((sig.length + 3) % 4)), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
  if (!ok) return null;
  const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((payload.length + 3) % 4)));
  return data.exp > Date.now() ? data : null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/healthz') return new Response('ok');
    const m = url.pathname.match(/^\/sector\/([^/]+)$/);
    if (!m) return new Response('Not found', { status: 404 });
    if (req.headers.get('upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    const sector = decodeURIComponent(m[1]!);
    const claims = await verify(url.searchParams.get('token') ?? '', env.REALTIME_SHARED_SECRET);
    if (!claims || claims.sector !== sector) return new Response('Forbidden', { status: 403 });
    const stub = env.SECTORS.get(env.SECTORS.idFromName(sector));
    const fwd = new Request(req.url, req);
    fwd.headers.set('x-cv-gid', String(claims.gid ?? ''));
    fwd.headers.set('x-cv-login', claims.login ?? '');
    return stub.fetch(fwd);
  },
};

export class Sector implements DurableObject {
  private nextId = 1;
  constructor(
    private state: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const gid = Number(req.headers.get('x-cv-gid')) || null;
    const login = req.headers.get('x-cv-login') || null;
    const id = gid ?? 0x80000000 + (this.nextId++ % 0x7fffffff); // anonymous ids live in the upper half
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ id, gid, login, hull: 0, last: 0, state: null } satisfies Attachment);
    this.roster(id);
    if ((await this.state.storage.getAlarm()) === null) await this.state.storage.setAlarm(Date.now() + TICK_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string) {
    if (typeof msg === 'string') return; // no free-text chat in v1
    const a = ws.deserializeAttachment() as Attachment;
    const v = new DataView(msg);
    const type = v.getUint8(0);
    const now = Date.now();
    if (type === MSG.STATE && msg.byteLength === 22) {
      if (now - a.last < MIN_INTERVAL_MS) return;
      a.last = now;
      a.state = Array.from(new Uint8Array(msg));
      ws.serializeAttachment(a);
    } else if (type === MSG.EMOTE && msg.byteLength === 2 && v.getUint8(1) < EMOTES.length && a.gid) {
      const out = new ArrayBuffer(6);
      const o = new DataView(out);
      o.setUint8(0, MSG.EMOTE_OUT);
      o.setUint32(1, a.id, true);
      o.setUint8(5, v.getUint8(1));
      for (const s of this.state.getWebSockets()) s.send(out);
    }
  }

  webSocketClose(ws: WebSocket) {
    const a = ws.deserializeAttachment() as Attachment;
    this.roster(null, a.id);
  }

  webSocketError(ws: WebSocket) {
    this.webSocketClose(ws);
  }

  private roster(you: number | null, left?: number) {
    const sockets = this.state.getWebSockets();
    const ships = sockets
      .map((s) => s.deserializeAttachment() as Attachment)
      .filter((a) => a.id !== left)
      .map((a) => ({ id: a.id, login: a.login }));
    for (const s of sockets) {
      const a = s.deserializeAttachment() as Attachment;
      try {
        s.send(JSON.stringify({ type: 'roster', ships, you: a.id === you ? a.id : undefined }));
      } catch {}
    }
  }

  /** 5 Hz tick: one batched snapshot per client with its 50 nearest ships (interest management). */
  async alarm() {
    const sockets = this.state.getWebSockets();
    if (!sockets.length) return;
    const now = Date.now();
    const ships = sockets
      .map((s) => ({ s, a: s.deserializeAttachment() as Attachment }))
      .filter((x) => x.a.state && now - x.a.last < IDLE_MS)
      .map((x) => {
        const raw = new DataView(new Uint8Array(x.a.state!).buffer);
        return { id: x.a.id, raw, hull: x.a.hull, pos: statePos(raw), s: x.s };
      });
    for (const me of ships.length ? sockets : []) {
      const a = me.deserializeAttachment() as Attachment;
      const mine = ships.find((x) => x.id === a.id);
      const origin = mine?.pos ?? [0, 0, 0];
      const nearest = ships
        .filter((x) => x.id !== a.id)
        .map((x) => ({ x, d: (x.pos[0] - origin[0]) ** 2 + (x.pos[1] - origin[1]) ** 2 + (x.pos[2] - origin[2]) ** 2 }))
        .sort((p, q) => p.d - q.d)
        .slice(0, NEAREST)
        .map((p) => p.x);
      try {
        me.send(encodeSnapshot(sockets.length, nearest));
      } catch {}
    }
    await this.state.storage.setAlarm(Date.now() + TICK_MS);
  }
}
