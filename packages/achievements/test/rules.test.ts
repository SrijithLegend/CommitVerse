import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_BY_ID, ACHIEVEMENTS, emptyContext, evaluate } from '../src';

const rule = (id: string) => ACHIEVEMENT_BY_ID.get(id)!.rule;

describe('F11 achievement rules — boundaries', () => {
  it('catalogue ids are unique and rewards are within 10–500 ✦', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) expect(a.stardust).toBeGreaterThanOrEqual(10), expect(a.stardust).toBeLessThanOrEqual(500);
  });
  it.each([
    ['main_sequence', { cTotal: 99 }, { cTotal: 100 }],
    ['stellar_mass', { cTotal: 999 }, { cTotal: 1000 }],
    ['giant', { cTotal: 9999 }, { cTotal: 10000 }],
    ['hypergiant', { globalImpactRank: 101 }, { globalImpactRank: 100 }],
    ['blue_shift', { spectralClass: 'A' }, { spectralClass: 'B' }],
    ['o_type', { spectralClass: 'B' }, { spectralClass: 'O' }],
    ['pulsar_7', { streakCurrent: 6 }, { streakLongest: 7 }],
    ['pulsar_365', { streakCurrent: 364 }, { streakCurrent: 365 }],
    ['full_orbit', { planets: 7 }, { planets: 8 }],
    ['asteroid_miner', { reposPublic: 49 }, { reposPublic: 50 }],
    ['galactic_core', { pctGalaxy: 0.01 }, { pctGalaxy: 0.0099 }],
    ['rising_star', { pctGalaxyDelta30: 9.9 }, { pctGalaxyDelta30: 10 }],
    ['old_light', { accountAgeDays: 3651 }, { accountAgeDays: 3652 }],
    ['beloved_1000', { signalsReceived: 999 }, { signalsReceived: 1000 }],
    ['recruiter_25', { verifiedReferrals: 24 }, { verifiedReferrals: 25 }],
    ['beacon', { beaconHours: 9.99 }, { beaconHours: 10 }],
    ['cartographer', { majorGalaxiesVisited: 11 }, { majorGalaxiesVisited: 12 }],
  ] as const)('%s', (id, below, at) => {
    expect(rule(id)(emptyContext(below as never))).toBe(false);
    expect(rule(id)(emptyContext(at as never))).toBe(true);
  });
  it('repo-based rules', () => {
    const now = '2026-09-24T00:00:00Z';
    expect(rule('gas_giant')(emptyContext({ repos: [{ stars: 1000, forks: 0, releases: 0, createdAt: null }] }))).toBe(true);
    expect(
      rule('hot_jupiter')(emptyContext({ now, repos: [{ stars: 1000, forks: 0, releases: 0, createdAt: '2025-09-25T00:00:00Z' }] })),
    ).toBe(true);
    expect(
      rule('hot_jupiter')(emptyContext({ now, repos: [{ stars: 1000, forks: 0, releases: 0, createdAt: '2025-09-24T00:00:00Z' }] })),
    ).toBe(false);
    expect(rule('ringmaster')(emptyContext({ repos: Array(5).fill({ stars: 0, forks: 0, releases: 1, createdAt: null }) }))).toBe(true);
    expect(rule('moon_maker')(emptyContext({ repos: [{ stars: 0, forks: 99, releases: 0, createdAt: null }] }))).toBe(false);
  });
  it('polyglot needs 5 languages ≥ 10%', () => {
    expect(rule('polyglot')(emptyContext({ langWeights: { a: 0.2, b: 0.2, c: 0.2, d: 0.2, e: 0.2 } }))).toBe(true);
    expect(rule('polyglot')(emptyContext({ langWeights: { a: 0.3, b: 0.2, c: 0.2, d: 0.2, e: 0.09 } }))).toBe(false);
  });
  it('early universe window', () => {
    expect(rule('early_universe')(emptyContext({ launchDate: '2026-10-01', claimedAt: '2026-10-30T23:59:59Z' }))).toBe(true);
    expect(rule('early_universe')(emptyContext({ launchDate: '2026-10-01', claimedAt: '2026-10-31T00:00:00Z' }))).toBe(false);
  });
  it('reignition', () => {
    expect(rule('dormant_revival')(emptyContext({ previousState: 'white_dwarf', state: 'main' }))).toBe(true);
    expect(rule('dormant_revival')(emptyContext({ previousState: 'protostar', state: 'main' }))).toBe(false);
  });
  it('evaluate grants exactly once and gates claimed-only achievements', () => {
    const ctx = emptyContext({ cTotal: 1000, signalsSent: 10 });
    const first = evaluate(ctx, new Set()).map((a) => a.id);
    expect(first).toContain('stellar_mass');
    expect(first).not.toContain('signal_sent_10');
    const claimed = evaluate({ ...ctx, claimed: true }, new Set(first)).map((a) => a.id);
    expect(claimed).toContain('signal_sent_10');
    expect(claimed).not.toContain('stellar_mass');
  });
});
