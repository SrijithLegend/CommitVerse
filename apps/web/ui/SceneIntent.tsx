'use client';
/** Pages declare what the persistent universe should do (hero drift, warp to a star, galaxy view, dimmed backdrop…). */
import { useEffect } from 'react';
import { type SceneIntent as Intent, sceneCommands, useUniverse } from '@/stores/universe';

export function SceneIntent({ intent, dim = false, tourAfterIdleMs }: { intent: Intent; dim?: boolean; tourAfterIdleMs?: number }) {
  const key = JSON.stringify(intent);
  useEffect(() => {
    useUniverse.getState().set({ intent: JSON.parse(key) as Intent, dim });
    return () => useUniverse.getState().set({ dim: false });
  }, [key, dim]);
  // F1 cinematic: idle 60 s on / (or ?tour=1) starts the scripted tour; any input exits it (handled by the rig).
  useEffect(() => {
    if (!tourAfterIdleMs) return;
    let t = setTimeout(start, tourAfterIdleMs);
    function start() {
      sceneCommands.push({ type: 'cinematic' });
    }
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(start, tourAfterIdleMs);
    };
    for (const ev of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, reset);
    if (new URLSearchParams(location.search).get('tour') === '1') setTimeout(start, 1500);
    return () => {
      clearTimeout(t);
      for (const ev of ['pointerdown', 'keydown', 'wheel']) window.removeEventListener(ev, reset);
    };
  }, [tourAfterIdleMs]);
  return null;
}
