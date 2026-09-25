'use client';
/** The in-scene HUD layer: reticle, hover card, system panel, mode bar, overlays. Mounted once (root layout). */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { setAmbienceKey, setProximity } from '@/lib/client/audio';
import { useSettings } from '@/lib/client/settings';
import { sampleFps } from '@/lib/client/telemetry';
import { engineRef } from '@/lib/client/engine-ref';
import { useUniverse } from '@/stores/universe';
import { ChartOverlay } from './hud/ChartOverlay';
import { CoachMarks, Ignition } from './hud/Ignition';
import { EmoteMenu } from './hud/EmoteMenu';
import { FeedPanel } from './hud/FeedPanel';
import { HelpOverlay } from './hud/HelpOverlay';
import { HintChips } from './hud/HintChips';
import { HoverCard } from './hud/HoverCard';
import { ModeBar } from './hud/ModeBar';
import { Reticle } from './hud/Reticle';
import { ShareDialog } from './hud/ShareDialog';
import { StarForming } from './hud/StarForming';
import { SupernovaToast } from './hud/SupernovaToast';
import { SystemPanel } from './hud/SystemPanel';
import { useMe } from './Providers';

export function Hud() {
  const router = useRouter();
  const overlay = useUniverse((s) => s.overlay);
  const { data: me } = useMe();
  const fps = useUniverse((s) => s.fps);

  useEffect(() => {
    sampleFps(fps);
  }, [fps]);

  // Global key actions that open UI (the engine handles camera actions itself).
  useEffect(() => {
    const on = (e: Event) => {
      const a = (e as CustomEvent<string>).detail;
      const s = useUniverse.getState();
      if (a === 'chart') s.set({ overlay: s.overlay === 'chart' ? null : 'chart' });
      if (a === 'help') s.set({ overlay: s.overlay === 'help' ? null : 'help' });
      if (a === 'share') s.set({ overlay: 'share' });
      if (a === 'constellations') useSettings.getState().set({ constellations: !useSettings.getState().constellations });
      if (a === 'home') {
        if (me?.claimed) router.push(`/@${me.login}`);
        else router.push('/auth/signin');
      }
    };
    window.addEventListener('cv:action', on);
    return () => window.removeEventListener('cv:action', on);
  }, [me, router]);

  // Sound: ambience key by galaxy, proximity hum by the focused star's temperature and distance.
  useEffect(() => {
    let raf = 0;
    let lastGalaxy = '';
    const tick = () => {
      const e = engineRef.current;
      const s = useUniverse.getState();
      if (e && s.focus?.kind === 'star') {
        const p = e.rig.pos;
        const f = s.focus;
        const d = Math.hypot(f.position[0] - p[0]!, f.position[1] - p[1]!, f.position[2] - p[2]!);
        setProximity(f.temperature, 1 - Math.min(1, d / 300));
        const g = e.tiles.galaxyAt(f.position)?.language ?? '';
        if (g !== lastGalaxy) {
          lastGalaxy = g;
          setAmbienceKey(g);
        }
      } else setProximity(null, 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <Reticle />
      <HoverCard />
      <SystemPanel />
      <FeedPanel />
      <ModeBar />
      <HintChips />
      <StarForming />
      <SupernovaToast />
      <Ignition />
      <CoachMarks />
      <EmoteMenu />
      {overlay === 'help' && <HelpOverlay />}
      {overlay === 'chart' && <ChartOverlay />}
      {overlay === 'share' && <ShareDialog />}
    </>
  );
}
