'use client';
/**
 * /bench — deterministic scripted camera path; samples frame times for ~40 s and reports p50/p5 FPS, frame p95,
 * points resident and draw calls. Results can be pasted into perf/RESULTS.md. `window.__benchResult` for CI.
 */
import { Button } from '@commitverse/ui-kit';
import { useEffect, useState } from 'react';
import { engineRef } from '@/lib/client/engine-ref';
import { sceneCommands, useUniverse } from '@/stores/universe';

interface Result {
  tier: string;
  fpsP50: number;
  fpsP5: number;
  frameP95ms: number;
  points: number;
  calls: number;
  gpu: string;
  ua: string;
}

export function Bench() {
  const manifest = useUniverse((s) => s.manifest);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    useUniverse.getState().set({ intent: { type: 'hero' } });
  }, []);

  const run = async () => {
    const e = engineRef.current;
    if (!e || !manifest) return;
    setRunning(true);
    setResult(null);
    const frames: number[] = [];
    let last = performance.now();
    let raf = 0;
    const sample = (t: number) => {
      frames.push(t - last);
      last = t;
      raf = requestAnimationFrame(sample);
    };
    raf = requestAnimationFrame(sample);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const g = manifest.galaxies[0]!;
    setPhase('supercluster');
    sceneCommands.push({ type: 'supercluster' });
    await wait(6000);
    setPhase('galaxy view');
    sceneCommands.push({ type: 'galaxyView', galaxyId: g.id });
    await wait(8000);
    setPhase('warp to a bright star');
    const hit = await e.tiles.find('bright');
    if (hit) sceneCommands.push({ type: 'warpTo', position: hit.position, radius: 4 });
    await wait(10_000);
    setPhase('flight');
    sceneCommands.push({ type: 'flight', on: true });
    e.input.state.keys.add('forward');
    e.input.state.keys.add('boost');
    await wait(10_000);
    e.input.state.keys.clear();
    sceneCommands.push({ type: 'flight', on: false });
    cancelAnimationFrame(raf);
    const ft = frames.slice(30).sort((a, b) => a - b);
    const q = (p: number) => ft[Math.min(ft.length - 1, Math.floor(p * ft.length))] ?? 0;
    const gl = e.renderer.getContext() as WebGL2RenderingContext;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r: Result = {
      tier: e.tier,
      fpsP50: Math.round(1000 / q(0.5)),
      fpsP5: Math.round(1000 / q(0.95)),
      frameP95ms: Math.round(q(0.95) * 10) / 10,
      points: e.tiles.stats.loadedPoints,
      calls: e.renderer.info.render.calls,
      gpu: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown',
      ua: navigator.userAgent,
    };
    (window as unknown as { __benchResult?: Result }).__benchResult = r;
    setResult(r);
    setPhase('done');
    setRunning(false);
  };

  return (
    <div className="glass pointer-events-auto fixed left-1/2 top-20 z-30 w-[min(92vw,420px)] -translate-x-1/2 p-5">
      <div className="label">/bench</div>
      <p className="mt-1 text-sm text-[var(--ink-2)]">Scripted 34-second flight: supercluster → galaxy → system → boosted flight.</p>
      <Button className="mt-3" variant="primary" disabled={running || !manifest} onClick={() => void run()}>
        {running ? `Running — ${phase}` : 'Run benchmark'}
      </Button>
      {result && (
        <pre
          className="mt-3 overflow-auto rounded bg-[rgba(160,190,255,0.06)] p-3 font-mono text-[11px] text-[var(--ink-1)]"
          data-testid="bench-result"
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
