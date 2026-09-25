/**
 * §6.6 — the delta layer: stars that are new, re-placed provisionally, or changed class/state/flags since the bake,
 * plus star indices to hide (opt-outs and stale baked copies). Rebuilt every 5 minutes (and nudged after births).
 *
 * Format "CVD1": magic(4) · uint32 hiddenCount · uint32 galaxyCount · uint32[hidden] ·
 *   per galaxy: uint32 galaxyId · uint32 recordCount · tile ("CVT1", positions relative to the galaxy centre) · uint32[ids]
 */

import { CATALOG } from '@commitverse/contracts';
import type { Db } from '@commitverse/db';
import {
  encodeTile,
  HEADER_BYTES,
  quantizeLuminosity,
  quantizeRadius,
  quantizeTemperature,
  RECORD_BYTES,
  type TileRecord,
} from '@commitverse/universe-core';
import { log } from './log';
import { broadcast } from './realtime';
import { getStore, type ObjectStore } from './storage';
import { getState, getUniverse, setState } from './universe';

export const DELTA_KEY = 'u/live/delta.bin';
const CORONA_INDEX = new Map(CATALOG.filter((i) => i.slot === 'corona').map((i, k) => [i.id, k + 1]));

interface DeltaRow {
  github_id: number;
  galaxy_id: number;
  star_index: number;
  x: number;
  y: number;
  z: number;
  base_radius: number;
  temperature: number;
  luminosity: number;
  flags: number;
  provisional: boolean;
  corona: string | null;
}

export function encodeDelta(hidden: number[], groups: { galaxyId: number; records: TileRecord[]; ids: number[] }[]): Uint8Array {
  const tiles = groups.map((g) => new Uint8Array(encodeTile(g.records)));
  const size = 12 + hidden.length * 4 + groups.reduce((s, g, i) => s + 8 + tiles[i]!.byteLength + g.ids.length * 4, 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set([0x43, 0x56, 0x44, 0x31], 0); // "CVD1"
  dv.setUint32(4, hidden.length, true);
  dv.setUint32(8, groups.length, true);
  let o = 12;
  for (const h of hidden) {
    dv.setUint32(o, h, true);
    o += 4;
  }
  groups.forEach((g, i) => {
    dv.setUint32(o, g.galaxyId, true);
    dv.setUint32(o + 4, g.records.length, true);
    o += 8;
    out.set(tiles[i]!, o);
    o += tiles[i]!.byteLength;
    for (const id of g.ids) {
      dv.setUint32(o, id, true);
      o += 4;
    }
  });
  return out;
}

export function decodeDelta(buf: ArrayBuffer): {
  hidden: Uint32Array;
  groups: { galaxyId: number; tile: ArrayBuffer; ids: Uint32Array }[];
} {
  const dv = new DataView(buf);
  if (buf.byteLength < 12 || dv.getUint32(0, false) !== 0x43564431) throw new Error('bad delta magic');
  const hiddenCount = dv.getUint32(4, true);
  const groupCount = dv.getUint32(8, true);
  let o = 12;
  const hidden = new Uint32Array(buf.slice(o, o + hiddenCount * 4));
  o += hiddenCount * 4;
  const groups: { galaxyId: number; tile: ArrayBuffer; ids: Uint32Array }[] = [];
  for (let i = 0; i < groupCount; i++) {
    const galaxyId = dv.getUint32(o, true);
    const n = dv.getUint32(o + 4, true);
    o += 8;
    const tileLen = HEADER_BYTES + n * RECORD_BYTES;
    const tile = buf.slice(o, o + tileLen);
    o += tileLen;
    const ids = new Uint32Array(buf.slice(o, o + n * 4));
    o += n * 4;
    groups.push({ galaxyId, tile, ids });
  }
  return { hidden, groups };
}

export async function buildDelta(db: Db, store?: ObjectStore): Promise<{ count: number; hidden: number }> {
  const s = store ?? (await getStore());
  const u = await getUniverse(db, true);
  if (!u) return { count: 0, hidden: 0 };
  const rows = await db.query<DeltaRow>(
    `select b.github_id, b.galaxy_id, b.star_index, b.x, b.y, b.z, b.base_radius, b.temperature, b.luminosity, b.flags, b.provisional,
       (select i.item_id from equipped e join inventory i on i.id = e.inventory_id
          where e.github_id = b.github_id and e.slot = 'corona' and i.revoked_at is null) as corona
     from bodies b join github_users gu using (github_id)
     where b.delta_at is not null and not gu.is_opted_out
     order by b.galaxy_id, b.star_index`,
  );
  const optedOut = (await getState<number[]>(db, 'hidden_indices')) ?? [];
  const hidden = [...new Set([...optedOut, ...rows.filter((r) => r.star_index < u.starCount).map((r) => r.star_index)])].sort(
    (a, b) => a - b,
  );
  const groups = new Map<number, { galaxyId: number; records: TileRecord[]; ids: number[] }>();
  for (const r of rows) {
    const g = u.galaxies.find((x) => x.id === r.galaxy_id);
    if (!g) continue;
    const grp = groups.get(g.id) ?? { galaxyId: g.id, records: [], ids: [] };
    grp.records.push({
      x: r.x - g.center[0],
      y: r.y - g.center[1],
      z: r.z - g.center[2],
      rq: quantizeRadius(r.base_radius),
      tq: quantizeTemperature(r.temperature),
      lq: quantizeLuminosity(r.luminosity),
      flags: r.flags,
      cosmetic: (r.corona && CORONA_INDEX.get(r.corona)) || 0,
      starIndex: r.star_index,
    });
    grp.ids.push(r.github_id);
    groups.set(g.id, grp);
  }
  const bytes = encodeDelta(hidden, [...groups.values()]);
  await s.put(DELTA_KEY, bytes, {
    contentType: 'application/octet-stream',
    cacheControl: 'public, max-age=30, must-revalidate',
    brotli: true,
  });
  const etag = `"${u.bakeVersion}-${Date.now().toString(36)}"`;
  await setState(db, 'delta', {
    etag,
    at: new Date().toISOString(),
    count: rows.length,
    hidden: hidden.length,
    bakeVersion: u.bakeVersion,
  });
  void broadcast('cosmic:global', 'delta', { etag });
  log.info({ job: 'delta', count: rows.length, hidden: hidden.length }, 'delta rebuilt');
  return { count: rows.length, hidden: hidden.length };
}
