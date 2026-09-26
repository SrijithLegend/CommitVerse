// §13.1 WS load: N ships in ONE sector sending 5 Hz STATE; reports snapshot rate and size per client.
// Target: 500 clients, each receiving ~5 snapshots/s capped at 50 ships (§F15).
//   RT=wss://realtime.example SECRET=... N=500 node perf/ws-sector.mjs
import { createHmac } from 'node:crypto';

const base = process.env.RT ?? 'ws://127.0.0.1:8787';
const secret = process.env.SECRET ?? 'dev-secret';
const N = Number(process.env.N ?? 500);
const SECONDS = Number(process.env.SECONDS ?? 30);
const sector = process.env.SECTOR ?? '1:r012345';

const token = (gid) => {
  const p = Buffer.from(JSON.stringify({ sector, gid, login: `load${gid}`, exp: Date.now() + 10 * 60_000 })).toString('base64url');
  return `${p}.${createHmac('sha256', secret).update(p).digest('base64url')}`;
};
const state = (i, t) => {
  const b = new ArrayBuffer(22);
  const v = new DataView(b);
  v.setUint8(0, 1);
  v.setInt16(1, Math.round(Math.cos(t + i) * 20000), true);
  v.setInt16(3, Math.round(Math.sin(t * 0.7 + i) * 20000), true);
  v.setInt16(5, (i * 97) % 30000, true);
  v.setInt16(13, 32767, true);
  return b;
};

let snapshots = 0;
let bytes = 0;
let maxShips = 0;
let errors = 0;
const sockets = [];
for (let i = 0; i < N; i++) {
  const ws = new WebSocket(`${base}/sector/${encodeURIComponent(sector)}?token=${token(100_000 + i)}`);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (m) => {
    if (typeof m.data === 'string') return;
    const v = new DataView(m.data);
    if (v.getUint8(0) !== 3) return;
    snapshots++;
    bytes += m.data.byteLength;
    maxShips = Math.max(maxShips, v.getUint16(3, true));
  };
  ws.onerror = () => errors++;
  sockets.push(ws);
  if (i % 50 === 49) await new Promise((r) => setTimeout(r, 250)); // ramp
}
const t0 = Date.now();
const tick = setInterval(() => {
  const t = (Date.now() - t0) / 1000;
  sockets.forEach((ws, i) => {
    if (ws.readyState === 1) ws.send(state(i, t));
  });
}, 200);
await new Promise((r) => setTimeout(r, SECONDS * 1000));
clearInterval(tick);
for (const ws of sockets) ws.close();

const perClient = snapshots / N / SECONDS;
console.log(
  JSON.stringify({
    clients: N,
    errors,
    snapshotsPerClientPerSec: +perClient.toFixed(2),
    avgSnapshotBytes: Math.round(bytes / Math.max(1, snapshots)),
    maxShips,
  }),
);
if (errors > N * 0.01 || perClient < 4 || maxShips > 50) process.exit(1);
