// Smoke test against `wrangler dev`: two ships join a sector and see each other in snapshots.
import { createHmac } from 'node:crypto';
const base = process.env.RT ?? 'ws://127.0.0.1:8787';
const sector = '1:r012345';
const token = (gid, login) => {
  const p = Buffer.from(JSON.stringify({ sector, gid, login, exp: Date.now() + 60_000 })).toString('base64url');
  return `${p}.${createHmac('sha256', 'dev-secret').update(p).digest('base64url')}`;
};
const state = (x) => { const b = new ArrayBuffer(22); const v = new DataView(b); v.setUint8(0, 1); v.setInt16(1, x, true); v.setInt16(13, 32767, true); return b; };
const open = (gid, login) => new Promise((res, rej) => { const ws = new WebSocket(`${base}/sector/${encodeURIComponent(sector)}?token=${token(gid, login)}`); ws.binaryType = 'arraybuffer'; ws.onopen = () => res(ws); ws.onerror = rej; });
const a = await open(101, 'alice');
const b = await open(202, 'bob');
const seen = new Promise((res) => { a.onmessage = (m) => { if (typeof m.data !== 'string') { const v = new DataView(m.data); if (v.getUint8(0) === 3 && v.getUint16(3, true) > 0) res({ total: v.getUint16(1, true), first: v.getUint32(5, true) }); } }; });
const t = setInterval(() => { a.send(state(100)); b.send(state(-200)); }, 200);
const r = await Promise.race([seen, new Promise((_, rej) => setTimeout(() => rej(new Error('no snapshot')), 5000))]);
clearInterval(t);
console.log('snapshot ok', r);
const bad = await new Promise((res) => { const ws = new WebSocket(`${base}/sector/${encodeURIComponent(sector)}?token=forged.sig`); ws.onerror = () => res('rejected'); ws.onopen = () => res('accepted'); });
console.log('forged token:', bad);
a.close(); b.close();
if (r.first !== 202 || bad !== 'rejected') process.exit(1);
