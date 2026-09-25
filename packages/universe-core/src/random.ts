/** Deterministic hashing + PRNG. Everything positional in the universe derives from these. */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * 32-bit hash. Strings: FNV-1a over UTF-16 code units, then fmix32.
 * Numbers: integers up to 2^53 are split into lo/hi words and mixed.
 */
export function hash32(x: number | string): number {
  if (typeof x === 'string') {
    let h = FNV_OFFSET;
    for (let i = 0; i < x.length; i++) {
      h ^= x.charCodeAt(i);
      h = Math.imul(h, FNV_PRIME);
    }
    return fmix32(h >>> 0);
  }
  const lo = x >>> 0;
  const hi = Math.floor(x / 4294967296) >>> 0;
  return fmix32((fmix32(lo) ^ Math.imul(hi + 0x9e3779b9, 0x27d4eb2d)) >>> 0);
}

/** mulberry32 — tiny, fast, good enough for layout jitter. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller (consumes two draws). */
export function gaussian(rng: () => number): number {
  const u = 1 - rng(); // (0, 1]
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Uniform direction on the unit sphere (consumes two draws). */
export function randomOnSphere(rng: () => number): [number, number, number] {
  const z = 2 * rng() - 1;
  const phi = 2 * Math.PI * rng();
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  return [s * Math.cos(phi), z, s * Math.sin(phi)];
}

/** Hash → [0, 1). */
export const hashUnit = (x: number | string, salt = 0): number => fmix32((hash32(x) ^ salt) >>> 0) / 4294967296;
