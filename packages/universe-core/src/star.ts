/** Derives the full physical star (§3.3) from raw metrics + universe population context. */
import {
  applyState,
  type FlagName,
  impact,
  isPulsar,
  luminosity,
  type PhysicalStar,
  packFlags,
  percentileOf,
  pulsarPeriod,
  quantile,
  type SpectralClass,
  type StellarState,
  starRadius,
  stellarState,
  temperature,
} from './metrics';

export interface StarMetricsInput {
  cTotal: number;
  c30: number;
  c90: number;
  starsTotal: number;
  followers: number;
  streakCurrent: number;
  accountAgeDays: number;
  daysSinceActive: number | null;
}

export interface PopulationContext {
  /** Ascending c_30 values among users with c_30 > 0 (or a quantile table of them). */
  c30ActiveSorted: ArrayLike<number>;
  cTotalP80: number;
  impactP999: number;
  /** Impact threshold for global top 100 (hypergiant). Infinity if unknown. */
  hypergiantImpact: number;
}

export interface DerivedStar extends PhysicalStar {
  baseRadius: number;
  impact: number;
  activityPct: number | null;
  pulsar: boolean;
  pulsarPeriod: number | null;
  hypergiant: boolean;
  flags: number;
}

export function deriveStar(
  m: StarMetricsInput,
  ctx: PopulationContext,
  extra: { claimed?: boolean; binary?: boolean; online?: boolean; hypergiant?: boolean } = {},
): DerivedStar {
  const imp = impact(m.starsTotal, m.followers, m.cTotal);
  const activityPct = m.c30 > 0 ? percentileOf(ctx.c30ActiveSorted, m.c30) : null;
  const { T } = temperature(activityPct);
  const baseRadius = starRadius(m.cTotal);
  const L = luminosity(imp, ctx.impactP999);
  const state: StellarState = stellarState(m, ctx.cTotalP80);
  const phys = applyState({ radius: baseRadius, T, L }, state);
  const pulsar = isPulsar(m.streakCurrent);
  const hypergiant = extra.hypergiant ?? (imp >= ctx.hypergiantImpact && m.accountAgeDays >= 90);
  const flagSet: Partial<Record<FlagName, boolean>> = {
    claimed: extra.claimed,
    pulsar,
    hypergiant,
    online: extra.online,
    binary: extra.binary,
  };
  return {
    ...phys,
    baseRadius,
    impact: imp,
    activityPct,
    pulsar,
    pulsarPeriod: pulsar ? pulsarPeriod(m.streakCurrent) : null,
    hypergiant,
    flags: packFlags(flagSet, state),
  };
}

/** Builds the population context from raw arrays (bake) — sorts in place-free copies. */
export function populationContext(rows: { c30: number; cTotal: number; impact: number }[]): PopulationContext {
  const c30 = Float64Array.from(rows.filter((r) => r.c30 > 0).map((r) => r.c30)).sort();
  const cTotal = Float64Array.from(rows.map((r) => r.cTotal)).sort();
  const imp = Float64Array.from(rows.map((r) => r.impact)).sort();
  const top100 = imp.length > 100 ? imp[imp.length - 100]! : Infinity;
  return {
    c30ActiveSorted: c30,
    cTotalP80: quantile(cTotal, 0.8),
    impactP999: Math.max(1e-6, quantile(imp, 0.999)),
    hypergiantImpact: top100,
  };
}

/** 1,000-point ascending quantile table (for shipping c_30 percentiles in the manifest). */
export function quantileTable(sortedAsc: ArrayLike<number>, buckets = 1000): number[] {
  if (!sortedAsc.length) return [];
  return Array.from({ length: buckets }, (_, i) => quantile(sortedAsc, (i + 1) / buckets));
}

/** Human "why" breakdown (Principle 7). */
export interface WhyLine {
  axis: string;
  raw: string;
  formula: string;
  value: string;
}

export function explainStar(m: StarMetricsInput, s: DerivedStar, cls: SpectralClass): WhyLine[] {
  const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { maximumFractionDigits: d });
  return [
    {
      axis: 'Radius',
      raw: `${fmt(m.cTotal, 0)} all-time contributions`,
      formula: 'R = 0.6 + 5.4 · clamp(log10(1+c_total)/log10(100001), 0, 1)^0.85',
      value: `${fmt(s.baseRadius)} u${s.radius !== s.baseRadius ? ` → ${fmt(s.radius)} u (${s.state.replace('_', ' ')})` : ''}`,
    },
    {
      axis: 'Temperature',
      raw: `${fmt(m.c30, 0)} contributions in the last 30 days`,
      formula:
        s.activityPct === null
          ? 'c_30 = 0 → T = 2,400 K (coolest M)'
          : `percentile a = ${fmt(s.activityPct * 100, 1)}% → band interpolation T = T_lo·(T_hi/T_lo)^t`,
      value: `${fmt(s.T, 0)} K · class ${cls}`,
    },
    {
      axis: 'Luminosity',
      raw: `${fmt(m.starsTotal, 0)} ★ · ${fmt(m.followers, 0)} followers · ${fmt(m.cTotal, 0)} contributions`,
      formula: 'impact = 0.5·log10(1+★) + 0.3·log10(1+followers) + 0.2·log10(1+c_total); L = clamp(impact / P99.9, 0, 1.25)',
      value: `impact ${fmt(s.impact, 3)} → L ${fmt(s.L, 3)}`,
    },
    {
      axis: 'State',
      raw: `account age ${fmt(m.accountAgeDays, 0)} d · ${m.daysSinceActive === null ? 'no recent activity' : `last active ${fmt(m.daysSinceActive, 0)} d ago`} · c_90 ${fmt(m.c90, 0)}`,
      formula: 'protostar → red giant → white dwarf → main sequence (first match)',
      value: s.state.replace('_', ' '),
    },
    {
      axis: 'Pulsar',
      raw: `current streak ${fmt(m.streakCurrent, 0)} days`,
      formula: 'streak ≥ 30 → P = clamp(2.4 − 0.6·log10(streak), 0.4, 2.4) s',
      value: s.pulsar ? `pulsar, period ${fmt(s.pulsarPeriod ?? 0)} s` : 'no',
    },
  ];
}
