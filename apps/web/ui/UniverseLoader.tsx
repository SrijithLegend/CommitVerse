'use client';
/**
 * F21: a static poster (AVIF) paints first for LCP, then crossfades to WebGL when the first frame is ready.
 * The 3D chunk (three + R3F + postprocessing + shaders) is lazy-loaded and never part of the initial bundle.
 */
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useSettings } from '@/lib/client/settings';
import { useUniverse } from '@/stores/universe';

const Universe = dynamic(() => import('@/scene/Universe'), { ssr: false });

export function UniverseLoader({ tilesBase }: { tilesBase: string }) {
  const [ready, setReady] = useState(false);
  const [mount, setMount] = useState(false);
  const listMode = useSettings((s) => s.listMode);
  const webgl = useUniverse((s) => s.webgl);
  useEffect(() => {
    const on = () => setReady(true);
    window.addEventListener('cv:first-frame', on);
    // Let the poster win LCP, then start the 3D chunk.
    const t = window.requestIdleCallback ? window.requestIdleCallback(() => setMount(true), { timeout: 600 }) : window.setTimeout(() => setMount(true), 200);
    return () => {
      window.removeEventListener('cv:first-frame', on);
      if (window.cancelIdleCallback) window.cancelIdleCallback(t as number);
      else clearTimeout(t as number);
    };
  }, []);
  const noGl = listMode || webgl === 'unavailable';
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 transition-opacity duration-700"
        style={{
          opacity: ready && !noGl ? 0 : 1,
          backgroundColor: '#03040a',
          backgroundImage: 'url(/poster.avif)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      {mount && !noGl && <Universe tilesBase={tilesBase} />}
    </>
  );
}
