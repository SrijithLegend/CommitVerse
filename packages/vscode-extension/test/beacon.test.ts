import { describe, expect, it } from 'vitest';
import { type BeaconState, payload, shouldSend } from '../src/beacon';

const base: BeaconState = { focused: true, lastEditAt: 1_000_000, lastSentAt: 0, enabled: true, language: 'typescript' };

describe('F16 beacon policy', () => {
  it('sends only when focused, recently editing and ≥ 60 s since the last heartbeat', () => {
    expect(shouldSend(base, 1_000_000)).toBe(true);
    expect(shouldSend({ ...base, focused: false }, 1_000_000)).toBe(false);
    expect(shouldSend(base, 1_000_000 + 120_001)).toBe(false); // idle > 2 min
    expect(shouldSend({ ...base, lastSentAt: 999_000 }, 1_000_000)).toBe(false); // < 60 s
    expect(shouldSend({ ...base, enabled: false }, 1_000_000)).toBe(false);
  });
  it('payload is the language and nothing else', () => {
    expect(payload(base)).toEqual({ language: 'typescript' });
    expect(Object.keys(payload({ ...base, language: null }))).toEqual(['language']);
  });
});
