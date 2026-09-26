'use client';
/** F17 Big Bang replay controls: timeline 2008 → today, 60 s default playback, pause, speed, share at a timestamp. */
import { Button } from '@commitverse/ui-kit';
import { Pause, Play, Share2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/client/settings';
import { sceneCommands, useUniverse } from '@/stores/universe';
import { toast } from './Toaster';

const START = 2008;
const END = new Date().getUTCFullYear() + new Date().getUTCMonth() / 12;

export function ReplayControls() {
  const params = useSearchParams();
  const initial = Number(params.get('t')) || START;
  const [year, setYear] = useState(Math.max(START, Math.min(END, initial)));
  const [playing, setPlaying] = useState(!params.get('t'));
  const [speed, setSpeed] = useState(1);
  const manifest = useUniverse((s) => s.manifest);
  const last = useRef(performance.now());

  useEffect(() => {
    if (manifest) sceneCommands.push({ type: 'supercluster' });
  }, [manifest]);
  useEffect(() => {
    useUniverse.getState().set({ replayYear: year, mode: 'replay' });
  }, [year]);
  useEffect(() => () => useUniverse.getState().set({ replayYear: null }), []);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    last.current = performance.now();
    const tick = (t: number) => {
      const dt = (t - last.current) / 1000;
      last.current = t;
      setYear((y) => {
        const n = y + (dt * (END - START) * speed) / 60;
        if (n >= END) {
          setPlaying(false);
          return END;
        }
        return n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  return (
    <div className="glass pointer-events-auto fixed inset-x-3 bottom-8 z-30 mx-auto flex max-w-3xl flex-wrap items-center gap-3 p-3 sm:bottom-10">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? 'Pause' : 'Play'}
        icon={playing ? <Pause size={14} /> : <Play size={14} />}
      />
      <div className="num w-16 font-mono text-lg text-[var(--ink-1)]" aria-live="off">
        {Math.floor(year)}
      </div>
      <input
        type="range"
        min={START}
        max={END}
        step={0.05}
        value={year}
        onChange={(e) => {
          setPlaying(false);
          setYear(Number(e.target.value));
        }}
        aria-label="Year"
        className="min-w-40 flex-1 accent-[var(--accent)]"
      />
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="glass h-8 px-2 text-xs" aria-label="Speed">
        {[0.5, 1, 2, 4].map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="quiet"
        icon={<Share2 size={14} />}
        onClick={() => {
          void navigator.clipboard.writeText(`${location.origin}/replay?t=${year.toFixed(2)}`);
          toast('Link to this moment copied');
        }}
      >
        Share
      </Button>
      {prefersReducedMotion() && (
        <p className="w-full text-[11px] text-[var(--ink-3)]">Reduced motion is on — scrub the timeline instead of playing.</p>
      )}
    </div>
  );
}
