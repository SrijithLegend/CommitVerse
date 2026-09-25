'use client';
/** §5.4 hover → mini card (avatar, @login, class chip, 3 axes). Only re-renders when the hovered id changes. */
import { ClassChip, fmt } from '@commitverse/ui-kit';
import { spectralSubclass } from '@commitverse/universe-core';
import { useUniverse } from '@/stores/universe';

export function HoverCard() {
  const hover = useUniverse((s) => s.hover);
  const focusId = useUniverse((s) => (s.focus?.kind === 'star' ? s.focus.githubId : null));
  if (!hover?.brief || hover.githubId === focusId) return null;
  const b = hover.brief;
  const [x, y] = hover.screen;
  const left = Math.min(x + 16, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 260);
  return (
    <div className="glass pointer-events-none fixed z-30 w-60 p-3" style={{ left, top: y + 16 }} role="tooltip">
      <div className="flex items-center gap-2.5">
        {b.avatarUrl && (
          // biome-ignore lint/performance/noImgElement: tiny avatar
          <img src={`${b.avatarUrl}${b.avatarUrl.includes('?') ? '&' : '?'}s=64`} alt="" width={32} height={32} className="h-8 w-8 rounded-lg" />
        )}
        <div className="min-w-0">
          <div className="truncate text-sm text-[var(--ink-1)]">{b.name ?? b.login}</div>
          <div className="truncate font-mono text-xs text-[var(--ink-3)]">@{b.login}</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <ClassChip temperature={b.temperature} label={`${spectralSubclass(b.temperature)} · ${b.state.replace('_', ' ')}`} />
        <span className="label">{b.galaxy}</span>
      </div>
      <dl className="mt-2.5 grid grid-cols-3 gap-2 font-mono text-[11px]">
        <div>
          <dt className="text-[var(--ink-3)]">R</dt>
          <dd className="num text-[var(--ink-1)]">{fmt(b.radius, 2)} u</dd>
        </div>
        <div>
          <dt className="text-[var(--ink-3)]">T</dt>
          <dd className="num text-[var(--ink-1)]">{fmt(b.temperature)} K</dd>
        </div>
        <div>
          <dt className="text-[var(--ink-3)]">L</dt>
          <dd className="num text-[var(--ink-1)]">{fmt(b.luminosity, 2)}</dd>
        </div>
      </dl>
      <div className="mt-2 text-[11px] text-[var(--ink-3)]">Click to select · double-click to warp</div>
    </div>
  );
}
