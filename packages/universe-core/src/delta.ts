/** §6.6 delta layer codec ("CVD1"): hidden star indices + per-galaxy tiles + github ids. Pure — used by the worker and the browser. */
import { HEADER_BYTES, RECORD_BYTES, type TileRecord, encodeTile } from './tile';

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

