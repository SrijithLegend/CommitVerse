/**
 * §6.4 — binary tile codec. 32-byte header + 16-byte little-endian records.
 *
 * Header: bytes 0–2 "CVT", byte 3 = format version as an ASCII digit ("CVT1"),
 *         4–7 uint32 record count, 8–31 float32 ×6 AABB (min xyz, max xyz) relative to the galaxy centre.
 * Record: int16×3 quantized position · uint8 R_q · uint8 T_q · uint8 L_q · uint8 flags ·
 *         uint16 cosmetic_hint · uint32 star_index.
 */

export const HEADER_BYTES = 32;
export const RECORD_BYTES = 16;
export const TILE_VERSION = 1;
export const MAX_TILE_RECORDS = 1 << 22;

export interface TileRecord {
  x: number;
  y: number;
  z: number; // galaxy-local, float
  rq: number;
  tq: number;
  lq: number;
  flags: number;
  cosmetic: number;
  starIndex: number;
}

export type AABB = [number, number, number, number, number, number];

export function aabbOf(records: { x: number; y: number; z: number }[]): AABB {
  if (!records.length) return [0, 0, 0, 0, 0, 0];
  const b: AABB = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const r of records) {
    if (r.x < b[0]) b[0] = r.x;
    if (r.y < b[1]) b[1] = r.y;
    if (r.z < b[2]) b[2] = r.z;
    if (r.x > b[3]) b[3] = r.x;
    if (r.y > b[4]) b[4] = r.y;
    if (r.z > b[5]) b[5] = r.z;
  }
  return b;
}

/** AABB rounded outward to float32 so that every point stays inside after header storage. */
function f32Box(b: AABB): AABB {
  const f = new Float32Array(b);
  for (let i = 0; i < 3; i++) {
    if (f[i]! > b[i]!) f[i] = nextDown(f[i]!);
    if (f[i + 3]! < b[i + 3]!) f[i + 3] = nextUp(f[i + 3]!);
    if (f[i + 3] === f[i]) f[i + 3] = nextUp(f[i]!);
  }
  return Array.from(f) as AABB;
}
const nextUp = (x: number) => {
  const f = new Float32Array([x]);
  const u = new Int32Array(f.buffer);
  u[0]! += x >= 0 ? 1 : -1;
  return f[0]!;
};
const nextDown = (x: number) => {
  const f = new Float32Array([x]);
  const u = new Int32Array(f.buffer);
  u[0]! += x > 0 ? -1 : 1;
  if (x === 0) return -1e-30;
  return f[0]!;
};

const q16 = (p: number, min: number, max: number) =>
  Math.max(-32768, Math.min(32767, Math.round(((p - min) / (max - min)) * 65535) - 32768));
export const dq16 = (q: number, min: number, max: number) => ((q + 32768) / 65535) * (max - min) + min;

export function encodeTile(records: TileRecord[], box: AABB = aabbOf(records)): ArrayBuffer {
  const b = f32Box(box);
  const buf = new ArrayBuffer(HEADER_BYTES + records.length * RECORD_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, 0x43); // C
  v.setUint8(1, 0x56); // V
  v.setUint8(2, 0x54); // T
  v.setUint8(3, 0x30 + TILE_VERSION);
  v.setUint32(4, records.length, true);
  for (let i = 0; i < 6; i++) v.setFloat32(8 + i * 4, b[i]!, true);
  let o = HEADER_BYTES;
  for (const r of records) {
    v.setInt16(o, q16(r.x, b[0], b[3]), true);
    v.setInt16(o + 2, q16(r.y, b[1], b[4]), true);
    v.setInt16(o + 4, q16(r.z, b[2], b[5]), true);
    v.setUint8(o + 6, r.rq);
    v.setUint8(o + 7, r.tq);
    v.setUint8(o + 8, r.lq);
    v.setUint8(o + 9, r.flags);
    v.setUint16(o + 10, r.cosmetic, true);
    v.setUint32(o + 12, r.starIndex, true);
    o += RECORD_BYTES;
  }
  return buf;
}

export interface TileHeader {
  version: number;
  count: number;
  aabb: AABB;
}

export class TileFormatError extends Error {}

/** Validates the header; throws TileFormatError on anything malformed (fuzz-tested). */
export function readTileHeader(buf: ArrayBuffer): TileHeader {
  if (buf.byteLength < HEADER_BYTES) throw new TileFormatError('short buffer');
  const v = new DataView(buf);
  if (v.getUint8(0) !== 0x43 || v.getUint8(1) !== 0x56 || v.getUint8(2) !== 0x54) throw new TileFormatError('bad magic');
  const version = v.getUint8(3) - 0x30;
  if (version !== TILE_VERSION) throw new TileFormatError(`unsupported version ${version}`);
  const count = v.getUint32(4, true);
  if (count > MAX_TILE_RECORDS) throw new TileFormatError('count too large');
  if (buf.byteLength !== HEADER_BYTES + count * RECORD_BYTES) throw new TileFormatError('length mismatch');
  const aabb = Array.from({ length: 6 }, (_, i) => v.getFloat32(8 + i * 4, true)) as AABB;
  if (aabb.some((x) => !Number.isFinite(x))) throw new TileFormatError('non-finite aabb');
  if (aabb[3] < aabb[0] || aabb[4] < aabb[1] || aabb[5] < aabb[2]) throw new TileFormatError('inverted aabb');
  return { version, count, aabb };
}

/** Zero-copy typed views over a validated tile (what the tile worker hands to the GPU). */
export function tileViews(buf: ArrayBuffer) {
  const header = readTileHeader(buf);
  return {
    header,
    /** Interleaved: stride 8 int16s; xyz at 0..2. */
    int16: new Int16Array(buf, HEADER_BYTES, header.count * 8),
    /** Interleaved: stride 16 bytes; R_q@6 T_q@7 L_q@8 flags@9. */
    uint8: new Uint8Array(buf, HEADER_BYTES, header.count * 16),
    /** Interleaved: stride 4 uint32s; star_index at 3. */
    uint32: new Uint32Array(buf, HEADER_BYTES, header.count * 4),
    /** Interleaved: stride 8 uint16s; cosmetic_hint at 5. */
    uint16: new Uint16Array(buf, HEADER_BYTES, header.count * 8),
  };
}

export function decodeTile(buf: ArrayBuffer): { header: TileHeader; records: TileRecord[] } {
  const header = readTileHeader(buf);
  const v = new DataView(buf);
  const b = header.aabb;
  const records: TileRecord[] = [];
  let o = HEADER_BYTES;
  for (let i = 0; i < header.count; i++, o += RECORD_BYTES) {
    records.push({
      x: dq16(v.getInt16(o, true), b[0], b[3]),
      y: dq16(v.getInt16(o + 2, true), b[1], b[4]),
      z: dq16(v.getInt16(o + 4, true), b[2], b[5]),
      rq: v.getUint8(o + 6),
      tq: v.getUint8(o + 7),
      lq: v.getUint8(o + 8),
      flags: v.getUint8(o + 9),
      cosmetic: v.getUint16(o + 10, true),
      starIndex: v.getUint32(o + 12, true),
    });
  }
  return { header, records };
}

/** `.ids.bin`: uint32 github_id per record, same order. (github ids currently fit in uint32.) */
export const encodeIds = (ids: number[]): ArrayBuffer => new Uint32Array(ids).buffer;
