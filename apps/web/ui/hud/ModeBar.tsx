'use client';
/** Bottom-left instrument strip: mode, LOD tier, quick actions; mobile flight controls (joystick visual + boost). */
import { Tip } from '@commitverse/ui-kit/radix';
import { Compass, HelpCircle, Home, Layers, Map as MapIcon, Orbit, Rocket, Share2, Telescope } from 'lucide-react';
import { useEffect, useState } from 'react';
import { engineRef } from '@/lib/client/engine-ref';
import { useSettings } from '@/lib/client/settings';
import { sceneCommands, useUniverse } from '@/stores/universe';

const MODE_LABEL: Record<string, string> = {
  orbit: 'ORBIT',
  flight: 'FLIGHT',
  warp: 'WARP',
  cinematic: 'CINEMATIC',
  galaxy: 'GALAXY VIEW',
  supercluster: 'SUPERCLUSTER',
  replay: 'REPLAY',
};

function Btn({
  label,
  kbd,
  onClick,
  active,
  children,
}: {
  label: string;
  kbd?: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tip content={kbd ? `${label} (${kbd})` : label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={`flex h-9 w-9 items-center justify-center rounded-[8px] transition-colors ${active ? 'bg-[rgba(124,196,255,0.14)] text-[var(--accent)]' : 'text-[var(--ink-2)] hover:text-[var(--ink-1)]'}`}
      >
        {children}
      </button>
    </Tip>
  );
}

export function ModeBar() {
  const mode = useUniverse((s) => s.mode);
  const tier = useUniverse((s) => s.tier);
  const fps = useUniverse((s) => s.fps);
  const presence = useUniverse((s) => s.presence);
  const showFps = useSettings((s) => s.fps);
  const constellations = useSettings((s) => s.constellations);
  const [touch, setTouch] = useState(false);
  const [coords, setCoords] = useState('');
  useEffect(() => {
    setTouch(matchMedia('(pointer: coarse)').matches);
    const t = setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      const p = e.rig.pos;
      setCoords(
        `${Math.round(p[0]!).toLocaleString('en-US')}, ${Math.round(p[1]!).toLocaleString('en-US')}, ${Math.round(p[2]!).toLocaleString('en-US')}`,
      );
    }, 500);
    return () => clearInterval(t);
  }, []);
  const action = (a: string) => window.dispatchEvent(new CustomEvent('cv:action', { detail: a }));
  return (
    <>
      <div className="pointer-events-auto fixed bottom-7 left-3 z-30 flex flex-col gap-2 sm:left-4">
        <div className="font-mono text-[10px] leading-4 tracking-[0.14em] text-[var(--ink-3)]" aria-live="polite">
          <div className="text-[var(--ink-2)]">{MODE_LABEL[mode] ?? mode.toUpperCase()}</div>
          <div className="num hidden sm:block">{coords} ly</div>
          <div>
            {tier.toUpperCase()}
            {showFps ? ` · ${fps} FPS` : ''}
            {presence.total > 1 ? ` · ${presence.total} explorers in this sector` : ''}
          </div>
        </div>
        <div className="glass flex gap-0.5 p-1">
          <Btn label="Fly" kbd="F" active={mode === 'flight'} onClick={() => sceneCommands.push({ type: 'flight', on: mode !== 'flight' })}>
            <Rocket size={16} />
          </Btn>
          <Btn label="Galaxy view" kbd="G" active={mode === 'galaxy'} onClick={() => action('galaxy-view')}>
            <Orbit size={16} />
          </Btn>
          <Btn label="Supercluster" kbd="U" active={mode === 'supercluster'} onClick={() => sceneCommands.push({ type: 'supercluster' })}>
            <Telescope size={16} />
          </Btn>
          <Btn label="Star chart" kbd="M" onClick={() => action('chart')}>
            <MapIcon size={16} />
          </Btn>
          <Btn
            label="Constellations"
            kbd="C"
            active={constellations}
            onClick={() => useSettings.getState().set({ constellations: !constellations })}
          >
            <Layers size={16} />
          </Btn>
          <Btn label="Share this view" kbd="P" onClick={() => action('share')}>
            <Share2 size={16} />
          </Btn>
          <Btn label="My star" kbd="H" onClick={() => action('home')}>
            <Home size={16} />
          </Btn>
          <Btn label="Tour" onClick={() => sceneCommands.push({ type: 'cinematic' })}>
            <Compass size={16} />
          </Btn>
          <Btn label="Help" kbd="?" onClick={() => action('help')}>
            <HelpCircle size={16} />
          </Btn>
        </div>
      </div>
      {touch && mode === 'flight' && <TouchFlight />}
      <GalaxyViewBridge />
    </>
  );
}

/** Mobile flight: left virtual joystick (the input controller reads the touches), boost button. */
function TouchFlight() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-24 left-8 z-20 h-28 w-28 rounded-full border border-[rgba(160,190,255,0.2)] bg-[rgba(10,14,26,0.25)]"
      >
        <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(124,196,255,0.25)]" />
      </div>
      <button
        type="button"
        className="glass pointer-events-auto fixed bottom-28 right-6 z-30 h-16 w-16 rounded-full font-mono text-xs text-[var(--accent)]"
        onPointerDown={() => engineRef.current?.input.state.keys.add('boost')}
        onPointerUp={() => engineRef.current?.input.state.keys.delete('boost')}
        onPointerLeave={() => engineRef.current?.input.state.keys.delete('boost')}
      >
        BOOST
      </button>
    </>
  );
}

function GalaxyViewBridge() {
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail !== 'galaxy-view') return;
      const eng = engineRef.current;
      const s = useUniverse.getState();
      if (!eng) return;
      const pos =
        s.focus?.kind === 'star'
          ? s.focus.position
          : ([eng.rig.target[0]!, eng.rig.target[1]!, eng.rig.target[2]!] as [number, number, number]);
      const g = eng.tiles.galaxyAt(pos) ?? s.manifest?.galaxies[0];
      if (g) sceneCommands.push({ type: 'galaxyView', galaxyId: g.id });
    };
    window.addEventListener('cv:action', on);
    return () => window.removeEventListener('cv:action', on);
  }, []);
  return null;
}
