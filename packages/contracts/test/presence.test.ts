import { describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeSnapshot, encodeState, MSG } from '../src/presence';

describe('F15 presence wire format', () => {
  it('STATE is 22 bytes and survives a server snapshot round-trip within quantization error', () => {
    const half = 5000;
    const st = encodeState([1234.5, -99, 4000], half, [0, 0.7071, 0, 0.7071], [120, 0, -40], 1);
    expect(st.byteLength).toBe(22);
    const snap = encodeSnapshot(3, [{ id: 42, raw: new DataView(st), hull: 2 }]);
    const { total, ships } = decodeSnapshot(snap, half);
    expect(total).toBe(3);
    expect(new DataView(snap).getUint8(0)).toBe(MSG.SNAPSHOT);
    const s = ships[0]!;
    expect(s.id).toBe(42);
    expect(s.hull).toBe(2);
    expect(s.flags).toBe(1);
    expect(Math.abs(s.pos[0] - 1234.5)).toBeLessThan(half / 32767 + 1e-6);
    expect(s.quat[1]).toBeCloseTo(0.7071, 3);
    expect(s.vel[0]).toBe(120);
  });
});
