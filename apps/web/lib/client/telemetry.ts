/**
 * §13.2 client RUM (10 % sample): tier chosen, GPU string (bucketed), fps p50/p5, tile load p95, context losses,
 * time-to-first-frame. PostHog when configured (IP anonymised, canvas masked in replays); otherwise marks only.
 */
const SAMPLED = typeof window !== 'undefined' && Math.random() < 0.1;
const fpsSamples: number[] = [];
// biome-ignore lint/suspicious/noExplicitAny: posthog is lazily imported
let ph: any = null;

export async function initTelemetry() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === 'undefined') return;
  const { default: posthog } = await import('posthog-js');
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
    ip: false,
    persistence: 'localStorage',
    session_recording: { maskAllInputs: true, blockSelector: 'canvas' },
    respect_dnt: true,
    capture_pageview: true,
  });
  ph = posthog;
}

export function mark(name: string) {
  if (typeof performance === 'undefined') return;
  performance.mark(`cv:${name}`);
  if (name === 'first-frame' && SAMPLED) {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    capture('rum_first_frame', { ms: Math.round(performance.now() - (nav?.startTime ?? 0)) });
  }
}

export function sampleFps(fps: number) {
  if (!SAMPLED) return;
  fpsSamples.push(fps);
  if (fpsSamples.length >= 60) {
    const s = [...fpsSamples].sort((a, b) => a - b);
    capture('rum_fps', { p50: s[Math.floor(s.length * 0.5)], p5: s[Math.floor(s.length * 0.05)] });
    fpsSamples.length = 0;
  }
}

export function capture(event: string, props: Record<string, unknown> = {}) {
  if (!SAMPLED && event.startsWith('rum_')) return;
  ph?.capture(event, props);
}

export function gpuBucket(gl: WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const s = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  return s.replace(/\d+/g, '#').slice(0, 48);
}
