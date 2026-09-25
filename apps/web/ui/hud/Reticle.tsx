'use client';
/**
 * §5.2: the focused body gets a 4-corner bracket reticle that animates in (120 ms) and tracks the body in screen
 * space; distance + class readout beside it in mono. Updated with rAF against the engine — never React state per frame.
 */
import { spectralSubclass } from '@commitverse/universe-core';
import { useEffect, useRef } from 'react';
import { engineRef } from '@/lib/client/engine-ref';
import { useUniverse } from '@/stores/universe';

export function Reticle() {
  const box = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const focus = useUniverse((s) => s.focus);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const e = engineRef.current;
      const el = box.current;
      const f = useUniverse.getState().focus;
      if (!e || !el || f?.kind !== 'star') {
        if (el) el.style.opacity = '0';
        return;
      }
      const pr = e.projectToScreen(f.position);
      if (!pr.visible) {
        el.style.opacity = '0';
        return;
      }
      const { x, y, dist } = pr;
      const size = Math.max(28, Math.min(260, f.radius * pr.pxPerUnit * 3.2));
      el.style.opacity = dist < 1.5 ? '0' : '1';
      el.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      if (readout.current) readout.current.textContent = `${Math.round(dist).toLocaleString('en-US')} ly · ${spectralSubclass(f.temperature)}`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      ref={box}
      aria-hidden
      key={focus?.kind === 'star' ? focus.githubId : 'none'}
      className="pointer-events-none fixed left-0 top-0 z-20 animate-[reticleIn_120ms_cubic-bezier(0.2,0.8,0.2,1)] opacity-0"
      style={{ willChange: 'transform' }}
    >
      {(['left-0 top-0 border-l border-t', 'right-0 top-0 border-r border-t', 'left-0 bottom-0 border-l border-b', 'right-0 bottom-0 border-r border-b'] as const).map((c) => (
        <span key={c} className={`absolute h-3 w-3 border-[var(--accent)] ${c}`} />
      ))}
      <div ref={readout} className="num absolute left-full top-0 ml-2 whitespace-nowrap font-mono text-[11px] text-[var(--accent)]" />
    </div>
  );
}
