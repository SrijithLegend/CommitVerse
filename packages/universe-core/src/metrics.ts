/** §3.3 / §8.7 — derived metric formulas. Single source of truth; golden-tested. */

export const R_MIN = 0.6;
export const R_MAX = 6.0;
export const C_CAP = 100_000;

export const starRadius = (cTotal: number): number =>
  R_MIN + (R_MAX - R_MIN) * Math.max(0, Math.min(1, Math.log10(1 + cTotal) / Math.log10(1 + C_CAP))) ** 0.85;

export const impact = (starsTotal: number, followers: number, cTotal: number): number =>
  0.5 * Math.log10(1 + starsTotal) + 0.3 * Math.log10(1 + followers) + 0.2 * Math.log10(1 + cTotal);

export type SpectralClass = 'M' | 'K' | 'G' | 'F' | 'A' | 'B' | 'O';
export const SPECTRAL_CLASSES: readonly SpectralClass[] = ['M', 'K', 'G', 'F', 'A', 'B', 'O'];

export const BANDS = [
  // [pctLo, pctHi, T_lo, T_hi, class]
  [0.0, 0.4, 2400, 3700, 'M'],
  [0.4, 0.65, 3700, 5200, 'K'],
  [0.65, 0.8, 5200, 6000, 'G'],
  [0.8, 0.9, 6000, 7500, 'F'],
  [0.9, 0.96, 7500, 10000, 'A'],
  [0.96, 0.99, 10000, 30000, 'B'],
  [0.99, 1.0, 30000, 40000, 'O'],
] as const;

export const T_MIN = 2400;
export const T_MAX = 40000;

/** activityPct = percentile of c_30 among users with c_30 > 0; null when c_30 = 0. */
export function temperature(activityPct: number | null): { T: number; cls: SpectralClass } {
  if (activityPct === null) return { T: 2400, cls: 'M' };
  const b = BANDS.find(([lo, hi]) => activityPct >= lo && activityPct < hi) ?? BANDS[6];
  const t = Math.min(1, (activityPct - b[0]) / (b[1] - b[0]));
  return { T: b[2] * (b[3] / b[2]) ** t, cls: b[4] };
}

/** Class from a raw temperature (used for fixed-T states like white dwarfs). */
export function classOfTemperature(T: number): SpectralClass {
  for (let i = BANDS.length - 1; i >= 0; i--) if (T >= BANDS[i]![2]) return BANDS[i]![4];
  return 'M';
}

/** Sub-class digit (0–9) within the band, e.g. "G2". Hotter → lower digit, like real stars. */
export function spectralSubclass(T: number): string {
  const cls = classOfTemperature(T);
  const b = BANDS.find((x) => x[4] === cls)!;
  const t = Math.log(T / b[2]) / Math.log(b[3] / b[2]);
  const digit = Math.max(0, Math.min(9, 9 - Math.floor(t * 10)));
  return `${cls}${digit}`;
}

export const IMPACT_L_CAP = 1.25;
export const luminosity = (impactValue: number, impactP999: number): number =>
  impactP999 <= 0 ? 0 : Math.max(0, Math.min(IMPACT_L_CAP, impactValue / impactP999));

/**
 * Percentile rank in [0, 1) of `value` within an ascending-sorted array.
 * Uses the count of strictly smaller values / n, so the minimum maps to 0.
 */
export function percentileOf(sortedAsc: ArrayLike<number>, value: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedAsc[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo / n;
}

/** Value at quantile q ∈ [0,1] (nearest-rank) of an ascending-sorted array. */
export function quantile(sortedAsc: ArrayLike<number>, q: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
  return sortedAsc[idx]!;
}

// ─── Stellar states ────────────────────────────────────────────────────────

export type StellarState = 'protostar' | 'main' | 'red_giant' | 'white_dwarf';
export const STATE_CODE: Record<StellarState, number> = { main: 0, protostar: 1, red_giant: 2, white_dwarf: 3 };
export const STATE_FROM_CODE: StellarState[] = ['main', 'protostar', 'red_giant', 'white_dwarf'];

export interface StateInput {
  accountAgeDays: number;
  cTotal: number;
  c90: number;
  /** Days since the last contribution; null = never contributed (in the known window). */
  daysSinceActive: number | null;
}

export function stellarState(m: StateInput, cTotalP80: number): StellarState {
  if (m.accountAgeDays < 90 || m.cTotal < 10) return 'protostar';
  if (m.cTotal >= cTotalP80 && m.c90 === 0) return 'red_giant';
  const dormant = m.daysSinceActive === null || m.daysSinceActive >= 365;
  if (dormant && m.cTotal < cTotalP80) return 'white_dwarf';
  return 'main';
}

export interface PhysicalStar {
  radius: number;
  T: number;
  cls: SpectralClass;
  L: number;
  state: StellarState;
}

/** Applies §3.3 state modifiers to the base axes. */
export function applyState(base: { radius: number; T: number; L: number }, state: StellarState): PhysicalStar {
  switch (state) {
    case 'red_giant': {
      const T = Math.min(base.T, 3200);
      return { radius: base.radius * 1.8, T, cls: classOfTemperature(T), L: base.L, state };
    }
    case 'white_dwarf':
      return { radius: base.radius * 0.35, T: 9000, cls: classOfTemperature(9000), L: base.L * 0.3, state };
    default:
      return { radius: base.radius, T: base.T, cls: classOfTemperature(base.T), L: base.L, state };
  }
}

export const pulsarPeriod = (streak: number): number => Math.max(0.4, Math.min(2.4, 2.4 - 0.6 * Math.log10(Math.max(1, streak))));

export const isPulsar = (streakCurrent: number): boolean => streakCurrent >= 30;

// ─── Flags (§6.4 record byte 9) ────────────────────────────────────────────

export const FLAG = {
  claimed: 1 << 0,
  pulsar: 1 << 1,
  hypergiant: 1 << 2,
  online: 1 << 3,
  binary: 1 << 4,
} as const;
export type FlagName = keyof typeof FLAG;

export const packFlags = (flags: Partial<Record<FlagName, boolean>>, state: StellarState): number => {
  let f = 0;
  for (const k of Object.keys(FLAG) as FlagName[]) if (flags[k]) f |= FLAG[k];
  return f | (STATE_CODE[state] << 5);
};

export const unpackFlags = (f: number): { flags: FlagName[]; state: StellarState } => ({
  flags: (Object.keys(FLAG) as FlagName[]).filter((k) => f & FLAG[k]),
  state: STATE_FROM_CODE[(f >> 5) & 7] ?? 'main',
});

// ─── Supernova milestones (§3.3) ───────────────────────────────────────────

export const SUPERNOVA_C_TOTAL = [1_000, 10_000, 50_000, 100_000] as const;
export const SUPERNOVA_STARS_TOTAL = [1_000, 10_000, 100_000] as const;
export const SUPERNOVA_REPO_STARS = [1_000, 10_000, 100_000] as const;

export interface Milestone {
  kind: 'c_total' | 'stars_total' | 'repo_stars';
  threshold: number;
  repoId?: number;
}

export function milestonesCrossed(
  prev: { cTotal: number; starsTotal: number; repoStars: Map<number, number> } | null,
  next: { cTotal: number; starsTotal: number; repoStars: Map<number, number> },
): Milestone[] {
  // First fetch never fires supernovas: a star isn't "exploding" just because we just discovered it.
  if (!prev) return [];
  const out: Milestone[] = [];
  for (const t of SUPERNOVA_C_TOTAL) if (prev.cTotal < t && next.cTotal >= t) out.push({ kind: 'c_total', threshold: t });
  for (const t of SUPERNOVA_STARS_TOTAL) if (prev.starsTotal < t && next.starsTotal >= t) out.push({ kind: 'stars_total', threshold: t });
  for (const [repoId, stars] of next.repoStars) {
    const before = prev.repoStars.get(repoId) ?? 0;
    for (const t of SUPERNOVA_REPO_STARS) if (before < t && stars >= t) out.push({ kind: 'repo_stars', threshold: t, repoId });
  }
  return out;
}

// ─── Quantization for tiles (§6.4) ─────────────────────────────────────────

export const quantizeRadius = (r: number): number => Math.round(((Math.max(R_MIN, Math.min(R_MAX, r)) - R_MIN) / (R_MAX - R_MIN)) * 255);
export const dequantizeRadius = (q: number): number => R_MIN + (q / 255) * (R_MAX - R_MIN);

const LOG_T_SPAN = Math.log(T_MAX / T_MIN);
export const quantizeTemperature = (T: number): number =>
  Math.round((Math.log(Math.max(T_MIN, Math.min(T_MAX, T)) / T_MIN) / LOG_T_SPAN) * 255);
export const dequantizeTemperature = (q: number): number => T_MIN * Math.exp((q / 255) * LOG_T_SPAN);

export const quantizeLuminosity = (L: number): number => Math.round((Math.max(0, Math.min(IMPACT_L_CAP, L)) / IMPACT_L_CAP) * 255);
export const dequantizeLuminosity = (q: number): number => (q / 255) * IMPACT_L_CAP;
