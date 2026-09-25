/**
 * F15 presence wire format (little-endian). Shared by the browser and the Durable Object (apps/realtime).
 * Client → server STATE (22 B): u8 type=1 · i16×3 pos (sector-cube quantized) · i16×4 quat · i16×3 vel · u8 flags
 * Client → server EMOTE (2 B): u8 type=2 · u8 emote
 * Server → client SNAPSHOT: u8 type=3 · u16 total · u16 count · count × (u32 id · i16×3 pos · i16×4 quat · i16×3 vel · u8 hull · u8 flags)
 * Server → client EMOTE (6 B): u8 type=5 · u32 id · u8 emote
 * Roster updates are JSON text frames: {"type":"roster","ships":[{"id":1,"login":"x","hull":"scout"}],"you":1}
 */
export const MSG = { STATE: 1, EMOTE: 2, SNAPSHOT: 3, EMOTE_OUT: 5 } as const;
export const EMOTES = ['wave', 'flare', 'salute', 'spin'] as const;
export type Emote = (typeof EMOTES)[number];
export const SHIP_BYTES = 26;
export const VEL_SCALE = 4; // i16 units per u/s … clamps at ±131 k u/s

export interface ShipState {
  id: number;
  pos: [number, number, number]; // sector-local (−half..half)
  quat: [number, number, number, number];
  vel: [number, number, number];
  hull: number;
  flags: number;
}

const q16 = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 32767)));

export function encodeState(localPos: [number, number, number], half: number, quat: [number, number, number, number], vel: [number, number, number], flags: number): ArrayBuffer {
  const b = new ArrayBuffer(22);
  const v = new DataView(b);
  v.setUint8(0, MSG.STATE);
  for (let i = 0; i < 3; i++) v.setInt16(1 + i * 2, q16(localPos[i]! / half), true);
  for (let i = 0; i < 4; i++) v.setInt16(7 + i * 2, q16(quat[i]!), true);
  for (let i = 0; i < 3; i++) v.setInt16(15 + i * 2, Math.max(-32767, Math.min(32767, Math.round(vel[i]! / VEL_SCALE))), true);
  v.setUint8(21, flags);
  return b;
}

export function decodeSnapshot(buf: ArrayBuffer, half: number): { total: number; ships: ShipState[] } {
  const v = new DataView(buf);
  const total = v.getUint16(1, true);
  const count = v.getUint16(3, true);
  const ships: ShipState[] = [];
  for (let k = 0; k < count; k++) {
    const o = 5 + k * SHIP_BYTES;
    ships.push({
      id: v.getUint32(o, true),
      pos: [0, 1, 2].map((i) => (v.getInt16(o + 4 + i * 2, true) / 32767) * half) as [number, number, number],
      quat: [0, 1, 2, 3].map((i) => v.getInt16(o + 10 + i * 2, true) / 32767) as [number, number, number, number],
      vel: [0, 1, 2].map((i) => v.getInt16(o + 18 + i * 2, true) * VEL_SCALE) as [number, number, number],
      hull: v.getUint8(o + 24),
      flags: v.getUint8(o + 25),
    });
  }
  return { total, ships };
}

/** Server side: one batched snapshot per client (only its nearest ships). */
export function encodeSnapshot(total: number, ships: { id: number; raw: DataView; hull: number }[]): ArrayBuffer {
  const b = new ArrayBuffer(5 + ships.length * SHIP_BYTES);
  const v = new DataView(b);
  v.setUint8(0, MSG.SNAPSHOT);
  v.setUint16(1, Math.min(65535, total), true);
  v.setUint16(3, ships.length, true);
  ships.forEach((s, k) => {
    const o = 5 + k * SHIP_BYTES;
    v.setUint32(o, s.id, true);
    // copy pos(6) + quat(8) + vel(6) straight from the client's STATE message (offsets 1..20)
    for (let i = 0; i < 20; i++) v.setUint8(o + 4 + i, s.raw.getUint8(1 + i));
    v.setUint8(o + 24, s.hull);
    v.setUint8(o + 25, s.raw.getUint8(21));
  });
  return b;
}

/** Sector-local quantized position from a STATE message (for nearest-ship interest management). */
export const statePos = (raw: DataView): [number, number, number] => [raw.getInt16(1, true), raw.getInt16(3, true), raw.getInt16(5, true)];
