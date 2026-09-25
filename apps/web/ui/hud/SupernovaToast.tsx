'use client';
/** F17: global supernova broadcast toast with a "Watch" button (warp to the star). */
import { useEffect, useState } from 'react';
import { sceneCommands, useUniverse } from '@/stores/universe';

export function SupernovaToast() {
  const sn = useUniverse((s) => s.supernova);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!sn) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 12_000);
    return () => clearTimeout(t);
  }, [sn]);
  if (!sn || !visible) return null;
  const p = sn.payload as { kind?: string; threshold?: number; repo?: string | null };
  const what = p.kind === 'repo_stars' ? `${p.repo} reached ${Number(p.threshold).toLocaleString()} ★` : p.kind === 'stars_total' ? `${Number(p.threshold).toLocaleString()} total stars` : `${Number(p.threshold).toLocaleString()} contributions`;
  return (
    <div className="glass pointer-events-auto fixed left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-4 px-4 py-3" role="alert">
      <span aria-hidden className="h-3 w-3 animate-ping rounded-full bg-white" />
      <div className="text-sm">
        <div className="text-[var(--ink-1)]">
          Supernova — <span className="font-mono">@{sn.login}</span>
        </div>
        <div className="text-xs text-[var(--ink-2)]">{what}</div>
      </div>
      {sn.position && (
        <button
          type="button"
          onClick={() => {
            sceneCommands.push({ type: 'warpTo', position: sn.position!, radius: 5 });
            setVisible(false);
          }}
          className="rounded-md px-3 py-1.5 text-sm text-[var(--accent)] hover:bg-[rgba(124,196,255,0.08)]"
        >
          Watch
        </button>
      )}
    </div>
  );
}
