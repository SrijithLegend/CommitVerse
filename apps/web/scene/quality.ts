/** §6.8 quality tiers + initial detection + adaptive performance (fine-grained ladder with hysteresis). */
import type { QualityTier } from '@/lib/client/settings';

export interface TierConfig {
  maxPoints: number;
  dprCap: number;
  dust: number;
  lensing: 'sprite' | 'screen' | 'screen+ring';
  nearStars: number;
  planetSegments: [number, number];
  skybox: number;
  ships: number;
  openThresholdPx: number;
}

export const TIERS: Record<QualityTier, TierConfig> = {
  low: { maxPoints: 150_000, dprCap: 1.0, dust: 4_000, lensing: 'sprite', nearStars: 2, planetSegments: [32, 16], skybox: 512, ships: 10, openThresholdPx: 220 },
  medium: { maxPoints: 400_000, dprCap: 1.25, dust: 10_000, lensing: 'sprite', nearStars: 4, planetSegments: [48, 24], skybox: 1024, ships: 25, openThresholdPx: 170 },
  high: { maxPoints: 1_000_000, dprCap: 1.5, dust: 20_000, lensing: 'screen', nearStars: 8, planetSegments: [64, 32], skybox: 2048, ships: 50, openThresholdPx: 130 },
  ultra: { maxPoints: 2_000_000, dprCap: 2.0, dust: 40_000, lensing: 'screen+ring', nearStars: 12, planetSegments: [96, 48], skybox: 2048, ships: 100, openThresholdPx: 100 },
};

export const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high', 'ultra'];

/** detect-gpu tier + hardwareConcurrency + deviceMemory (the 30-frame micro-benchmark refines it at runtime). */
export async function detectTier(): Promise<QualityTier> {
  let gpuTier = 2;
  let mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  try {
    const { getGPUTier } = await import('detect-gpu');
    const r = await getGPUTier({ benchmarksURL: '/detect-gpu' });
    gpuTier = r.tier;
    mobile = r.isMobile ?? mobile;
  } catch {}
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  if (gpuTier <= 1 || mem <= 2) return 'low';
  if (mobile) return gpuTier >= 3 && mem >= 6 ? 'medium' : 'low';
  if (gpuTier >= 3 && cores >= 8 && mem >= 8) return 'ultra';
  return gpuTier >= 2 ? 'high' : 'medium';
}

/**
 * drei PerformanceMonitor-style adaptation: frame-time p90 over budget for 3 s → drop one fine-grained step
 * (DPR first, then bloom, then points); raise after 10 s under 70 % of budget. User-forced tiers disable adaptation.
 */
export class AdaptiveQuality {
  private samples: number[] = [];
  private overSince = 0;
  private underSince = 0;
  step = 0; // 0 = full tier; each step degrades
  constructor(
    private budgetMs = 1000 / 60,
    private onChange: (step: number) => void = () => {},
  ) {}
  setBudget(ms: number) {
    this.budgetMs = ms;
  }
  sample(frameMs: number, now: number) {
    this.samples.push(frameMs);
    if (this.samples.length < 60) return;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)]!;
    this.samples = [];
    if (p90 > this.budgetMs * 1.08) {
      this.underSince = 0;
      this.overSince ||= now;
      if (now - this.overSince > 3000 && this.step < 6) {
        this.step++;
        this.overSince = now;
        this.onChange(this.step);
      }
    } else if (p90 < this.budgetMs * 0.7) {
      this.overSince = 0;
      this.underSince ||= now;
      if (now - this.underSince > 10_000 && this.step > 0) {
        this.step--;
        this.underSince = now;
        this.onChange(this.step);
      }
    } else {
      this.overSince = 0;
      this.underSince = 0;
    }
  }
}
