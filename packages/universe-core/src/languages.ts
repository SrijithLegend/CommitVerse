/** Appendix B — Linguist colours + stable fallback; §3.6 language assignment. */
import data from './languages.json';
import { hash32 } from './random';

export const LINGUIST_VERSION: string = data.linguistVersion;
const COLORS: Record<string, string> = data.colors;

/** OKLCH → sRGB hex (for hash-derived fallback hues). */
function oklchToHex(L: number, C: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${lin
    .map((v) => {
      const c = Math.max(0, Math.min(1, v));
      const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
      return Math.round(srgb * 255)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}

/** Linguist colour, or a hash-derived hue at 60% chroma-ish / 55% lightness (OKLCH). */
export function languageColor(language: string | null | undefined): string {
  if (!language) return '#8b93a7';
  return COLORS[language] ?? oklchToHex(0.55, 0.6 * 0.25, hash32(language) % 360);
}

export const POLYGLOT = 'Polyglot';
export const VOID = 'Void';
export const POLYGLOT_THRESHOLD = 0.35;

export interface RepoLanguageInput {
  pushedAt: string | null;
  languages: { name: string; size: number }[];
}

/** Recency-weighted language byte shares: w = 0.5 ^ (years_since_push / 2). Returns fractions summing to 1. */
export function languageWeights(repos: RepoLanguageInput[], now = Date.now()): Record<string, number> {
  const acc = new Map<string, number>();
  let total = 0;
  for (const r of repos) {
    const years = r.pushedAt ? Math.max(0, (now - Date.parse(r.pushedAt)) / (365.25 * 86_400_000)) : 10;
    const w = 0.5 ** (years / 2);
    for (const l of r.languages) {
      const v = l.size * w;
      acc.set(l.name, (acc.get(l.name) ?? 0) + v);
      total += v;
    }
  }
  const out: Record<string, number> = {};
  if (total <= 0) return out;
  for (const [k, v] of [...acc.entries()].sort((a, b) => b[1] - a[1])) out[k] = v / total;
  return out;
}

/** primary_language = argmax; < 35% → Polyglot; no data → Void. Ties broken by name for determinism. */
export function primaryLanguage(weights: Record<string, number>): string {
  let best: string | null = null;
  let bestW = -1;
  for (const [k, w] of Object.entries(weights)) {
    if (w > bestW || (w === bestW && best !== null && k < best)) {
      best = k;
      bestW = w;
    }
  }
  if (best === null || bestW <= 0) return VOID;
  return bestW < POLYGLOT_THRESHOLD ? POLYGLOT : best;
}
