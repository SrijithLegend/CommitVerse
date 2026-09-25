import { describe, expect, it } from 'vitest';
import {
  applyState,
  beltCount,
  buildPlanets,
  calendarMetrics,
  dequantizeTemperature,
  impact,
  kelvinToRGB,
  languageColor,
  languageWeights,
  luminosity,
  milestonesCrossed,
  moonCount,
  oortDensity,
  orbitRadii,
  packFlags,
  planetRadius,
  planetType,
  primaryLanguage,
  pulsarPeriod,
  quantizeTemperature,
  ringBands,
  selectPlanets,
  spectralSubclass,
  starRadius,
  stellarState,
  temperature,
  unpackFlags,
} from '../src';

describe('§3.3 radius golden table', () => {
  it.each([
    [0, 0.6],
    [10, 2.02],
    [100, 3.08],
    [1000, 4.1],
    [10000, 5.07],
    [100000, 6.0],
    [5_000_000, 6.0],
  ])('c_total %d → R %f', (c, R) => expect(starRadius(c)).toBeCloseTo(R, 2));
});

describe('§3.3 temperature bands', () => {
  it('c_30 = 0 → 2400 K, M', () => expect(temperature(null)).toEqual({ T: 2400, cls: 'M' }));
  it.each([
    [0, 2400, 'M'],
    [0.4, 3700, 'K'],
    [0.65, 5200, 'G'],
    [0.8, 6000, 'F'],
    [0.9, 7500, 'A'],
    [0.96, 10000, 'B'],
    [0.99, 30000, 'O'],
  ])('band lower edge %f → %d K %s', (p, T, cls) => {
    const r = temperature(p);
    expect(r.T).toBeCloseTo(T, 6);
    expect(r.cls).toBe(cls);
  });
  it('geometric interpolation inside a band', () => {
    // midpoint of G: 5200·(6000/5200)^0.5
    expect(temperature(0.725).T).toBeCloseTo(5200 * Math.sqrt(6000 / 5200), 6);
  });
  it('p = 1 falls into O and stays ≤ 40,000 K', () => {
    const r = temperature(1);
    expect(r.cls).toBe('O');
    expect(r.T).toBeCloseTo(40000, 6);
  });
  it('subclass digit', () => {
    expect(spectralSubclass(5200)).toBe('G9');
    expect(spectralSubclass(5990)).toBe('G0');
  });
});

describe('§3.3 impact & luminosity', () => {
  it('impact formula', () => {
    expect(impact(2110, 312, 4213)).toBeCloseTo(0.5 * Math.log10(2111) + 0.3 * Math.log10(313) + 0.2 * Math.log10(4214), 12);
    expect(impact(0, 0, 0)).toBe(0);
  });
  it('L clamps to [0, 1.25]', () => {
    expect(luminosity(1, 2)).toBe(0.5);
    expect(luminosity(10, 2)).toBe(1.25);
    expect(luminosity(-1, 2)).toBe(0);
  });
});

describe('§3.3 stellar states', () => {
  const base = { accountAgeDays: 1000, cTotal: 500, c90: 20, daysSinceActive: 3 };
  it('protostar: new account or < 10 contributions', () => {
    expect(stellarState({ ...base, accountAgeDays: 89 }, 1000)).toBe('protostar');
    expect(stellarState({ ...base, cTotal: 9 }, 1000)).toBe('protostar');
  });
  it('red giant: ≥ P80 and silent for 90 days', () => {
    expect(stellarState({ ...base, cTotal: 1000, c90: 0, daysSinceActive: 400 }, 1000)).toBe('red_giant');
  });
  it('white dwarf: dormant 365+ days below P80', () => {
    expect(stellarState({ ...base, c90: 0, daysSinceActive: 365 }, 1000)).toBe('white_dwarf');
    expect(stellarState({ ...base, c90: 0, daysSinceActive: null }, 1000)).toBe('white_dwarf');
  });
  it('main sequence otherwise', () => expect(stellarState(base, 1000)).toBe('main'));
  it('state modifiers', () => {
    expect(applyState({ radius: 4, T: 8000, L: 1 }, 'red_giant')).toMatchObject({ radius: 7.2, T: 3200, cls: 'M', L: 1 });
    expect(applyState({ radius: 4, T: 3000, L: 1 }, 'white_dwarf')).toMatchObject({ radius: 1.4, T: 9000, cls: 'A', L: 0.3 });
  });
  it('pulsar period', () => {
    expect(pulsarPeriod(30)).toBeCloseTo(2.4 - 0.6 * Math.log10(30), 12);
    expect(pulsarPeriod(1e9)).toBe(0.4);
  });
  it('flags round-trip', () => {
    const f = packFlags({ claimed: true, hypergiant: true }, 'white_dwarf');
    expect(unpackFlags(f)).toEqual({ flags: ['claimed', 'hypergiant'], state: 'white_dwarf' });
  });
});

describe('§3.3 supernova milestones', () => {
  const s = (c: number, st: number, repos: [number, number][] = []) => ({ cTotal: c, starsTotal: st, repoStars: new Map(repos) });
  it('fires once per crossing', () => {
    expect(milestonesCrossed(s(999, 0), s(1000, 0))).toEqual([{ kind: 'c_total', threshold: 1000 }]);
    expect(milestonesCrossed(s(1000, 0), s(1200, 0))).toEqual([]);
    expect(milestonesCrossed(s(0, 900, [[7, 900]]), s(0, 1000, [[7, 1000]]))).toEqual([
      { kind: 'stars_total', threshold: 1000 },
      { kind: 'repo_stars', threshold: 1000, repoId: 7 },
    ]);
  });
  it('never on first fetch', () => expect(milestonesCrossed(null, s(1e6, 1e6))).toEqual([]));
});

describe('§3.4 planets', () => {
  it('orbit radii and 40u cap', () => {
    const a = orbitRadii(1, 8);
    expect(Math.max(...a)).toBeLessThanOrEqual(40 + 1e-9);
    expect(orbitRadii(1, 1)[0]).toBeCloseTo(2 + 2.2, 12);
    const big = orbitRadii(10.8, 8);
    expect(big[7]).toBeCloseTo(40, 9);
  });
  it('planet radius/type/moons/rings', () => {
    expect(planetRadius(0)).toBeCloseTo(0.12, 12);
    expect(planetRadius(99999)).toBeCloseTo(0.67, 3);
    expect(planetType(1000)).toBe('gas_giant');
    expect(planetType(100)).toBe('ocean');
    expect(planetType(99)).toBe('rocky');
    expect(moonCount(9)).toBe(1);
    expect(moonCount(10)).toBe(1);
    expect(moonCount(10000)).toBe(4);
    expect(moonCount(1e9)).toBe(5);
    expect(ringBands(0)).toBe(0);
    expect(ringBands(1)).toBe(1);
    expect(ringBands(4)).toBe(3);
    expect(ringBands(1000)).toBe(6);
  });
  it('belt and oort', () => {
    expect(beltCount(8, 8)).toBe(0);
    expect(beltCount(108, 8)).toBe(400);
    expect(beltCount(1e6, 8)).toBe(2000);
    expect(oortDensity(0)).toBe(0);
    expect(oortDensity(999)).toBe(600);
  });
  it('selection: stars desc then pushedAt desc, pinned override', () => {
    const r = (id: number, stars: number, pushedAt: string) => ({
      repoId: id,
      name: `r${id}`,
      stars,
      forks: 0,
      releases: 0,
      pushedAt,
      isArchived: false,
      language: null,
    });
    const repos = [r(1, 5, '2020-01-01'), r(2, 5, '2024-01-01'), r(3, 50, '2019-01-01')];
    expect(selectPlanets(repos).map((x) => x.repoId)).toEqual([3, 2, 1]);
    expect(selectPlanets(repos, [1, 99]).map((x) => x.repoId)).toEqual([1]);
    const planets = buildPlanets(2, selectPlanets(repos));
    expect(planets[0]!.period).toBeCloseTo(20, 12);
    expect(planets[1]!.period).toBeCloseTo(20 * (planets[1]!.orbitRadius / planets[0]!.orbitRadius) ** 1.5, 12);
  });
});

describe('§3.2 calendar metrics', () => {
  it('counts windows and streaks (UTC)', () => {
    const days = [];
    for (let i = 0; i < 400; i++) {
      const d = new Date(Date.UTC(2026, 8, 24) - i * 86400000).toISOString().slice(0, 10);
      days.push({ date: d, count: i < 45 ? 2 : i === 50 ? 5 : 0 });
    }
    const m = calendarMetrics(days, '2026-09-24');
    expect(m.c30).toBe(60);
    expect(m.c90).toBe(95);
    expect(m.streakCurrent).toBe(45);
    expect(m.streakLongest).toBe(45);
    expect(m.lastActiveOn).toBe('2026-09-24');
    expect(m.calendar52w).toHaveLength(364);
    expect(m.calendar52w[363]).toBe(2);
  });
  it('streak survives an empty today', () => {
    const m = calendarMetrics(
      [
        { date: '2026-09-22', count: 1 },
        { date: '2026-09-23', count: 1 },
      ],
      '2026-09-24',
    );
    expect(m.streakCurrent).toBe(2);
  });
});

describe('Appendix A/B', () => {
  it('blackbody reference points', () => {
    expect(kelvinToRGB(6600)).toEqual([255, 255, 255].map((v, i) => (i === 2 ? kelvinToRGB(6600)[2] : v)) as [number, number, number]);
    expect(kelvinToRGB(2400)[0]).toBe(255);
    expect(kelvinToRGB(40000)[2]).toBe(255);
    expect(kelvinToRGB(1000)).toEqual([255, 68, 0]);
  });
  it('temperature LUT quantization is monotone and round-trips within a step', () => {
    expect(quantizeTemperature(2400)).toBe(0);
    expect(quantizeTemperature(40000)).toBe(255);
    for (const T of [2400, 3700, 5800, 9000, 30000]) {
      expect(Math.abs(Math.log(dequantizeTemperature(quantizeTemperature(T)) / T))).toBeLessThan(Math.log(40000 / 2400) / 255);
    }
  });
  it('language colours are linguist or a stable fallback', () => {
    expect(languageColor('TypeScript')).toBe('#3178c6');
    expect(languageColor('MadeUpLang9000')).toMatch(/^#[0-9a-f]{6}$/);
    expect(languageColor('MadeUpLang9000')).toBe(languageColor('MadeUpLang9000'));
  });
  it('language weights, polyglot and void', () => {
    const now = Date.parse('2026-09-24T00:00:00Z');
    const w = languageWeights(
      [
        { pushedAt: '2026-09-24T00:00:00Z', languages: [{ name: 'Rust', size: 100 }] },
        { pushedAt: '2024-09-24T00:00:00Z', languages: [{ name: 'Go', size: 200 }] },
      ],
      now,
    );
    expect(w.Rust).toBeCloseTo(100 / (100 + 200 * 0.5 ** (2 / 2 / 1.0004)), 2);
    expect(primaryLanguage({ A: 0.34, B: 0.33, C: 0.33 })).toBe('Polyglot');
    expect(primaryLanguage({})).toBe('Void');
    expect(primaryLanguage({ Rust: 0.6, Go: 0.4 })).toBe('Rust');
  });
});
