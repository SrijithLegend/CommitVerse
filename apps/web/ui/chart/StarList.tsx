'use client';
/**
 * F19 accessible list mode: a virtualised, keyboard-navigable table of stars (same filters as the chart), with a
 * screen-reader summary of the focused row. Automatic when WebGL2 is unavailable.
 */
import type { LeaderboardRow } from '@commitverse/contracts';
import { compact, StarDot } from '@commitverse/ui-kit';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Api } from '@/lib/client/api';

const ROW = 44;
const CLASSES = ['M', 'K', 'G', 'F', 'A', 'B', 'O'];

export function StarList() {
  const router = useRouter();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [scroll, setScroll] = useState(0);
  const [active, setActive] = useState(0);
  const [classes, setClasses] = useState(new Set(CLASSES));
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (next === null || loading.current) return;
    loading.current = true;
    try {
      const r = await Api.leaderboard('global', 'impact', next);
      setRows((x) => [...x, ...r.rows]);
      setNext(r.nextCursor);
    } finally {
      loading.current = false;
    }
  }, [next]);
  useEffect(() => {
    if (rows.length === 0) void load();
  }, [load, rows.length]);

  const filtered = rows.filter((r) => classes.has(r.spectralClass) && (!q || r.login.toLowerCase().includes(q.toLowerCase())));
  const height = 520;
  const first = Math.max(0, Math.floor(scroll / ROW) - 5);
  const visible = filtered.slice(first, first + Math.ceil(height / ROW) + 10);
  const cur = filtered[active];

  useEffect(() => {
    if ((first + 60) * ROW > filtered.length * ROW - height && next !== null) void load();
  }, [first, filtered.length, next, load]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.max(0, Math.min(filtered.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      setActive(n);
      const el = box.current;
      if (el) {
        if (n * ROW < el.scrollTop) el.scrollTop = n * ROW;
        if ((n + 1) * ROW > el.scrollTop + height) el.scrollTop = (n + 1) * ROW - height;
      }
    }
    if (e.key === 'Enter' && cur) router.push(`/@${cur.login}`);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter loaded stars by login"
          aria-label="Filter"
          className="glass h-8 px-2 text-sm outline-none"
        />
        {CLASSES.map((c) => (
          <label key={c} className="flex items-center gap-1 font-mono text-xs text-[var(--ink-2)]">
            <input
              type="checkbox"
              checked={classes.has(c)}
              onChange={(e) =>
                setClasses((s) => {
                  const n = new Set(s);
                  if (e.target.checked) n.add(c);
                  else n.delete(c);
                  return n;
                })
              }
            />
            {c}
          </label>
        ))}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: virtualised grid needs a scroll container with the grid role */}
      <div
        ref={box}
        role="grid"
        aria-label="Stars, ranked by impact"
        aria-rowcount={filtered.length}
        aria-activedescendant={cur ? `star-row-${cur.githubId}` : undefined}
        tabIndex={0}
        onKeyDown={onKey}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
        className="relative overflow-auto rounded-lg border border-[var(--panel-border)] scroll-thin"
        style={{ height }}
      >
        <div style={{ height: filtered.length * ROW, position: 'relative' }}>
          {visible.map((r, i) => {
            const idx = first + i;
            return (
              // biome-ignore lint/a11y/useFocusableInteractive: focus is managed by the grid (aria-activedescendant)
              <div
                key={r.githubId}
                id={`star-row-${r.githubId}`}
                role="row"
                aria-rowindex={idx + 1}
                aria-selected={idx === active}
                onClick={() => router.push(`/@${r.login}`)}
                onKeyDown={() => {}}
                className={`absolute inset-x-0 flex cursor-pointer items-center gap-3 px-3 text-sm ${idx === active ? 'bg-[rgba(124,196,255,0.08)]' : ''}`}
                style={{ top: idx * ROW, height: ROW }}
              >
                <span role="gridcell" className="num w-12 font-mono text-[var(--ink-3)]">
                  {r.rank}
                </span>
                <span role="gridcell" className="flex min-w-0 flex-1 items-center gap-2">
                  <StarDot temperature={r.temperature} size={8} />
                  <span className="truncate text-[var(--ink-1)]">@{r.login}</span>
                  <span className="font-mono text-[11px] text-[var(--ink-3)]">{r.spectralClass}</span>
                </span>
                <span role="gridcell" className="hidden w-32 truncate text-[var(--ink-2)] sm:block">
                  {r.galaxy}
                </span>
                <span role="gridcell" className="num w-16 text-right font-mono text-[var(--ink-2)]">
                  {compact(r.value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {cur ? `@${cur.login}, ${cur.spectralClass}-class star in the ${cur.galaxy} galaxy, rank ${cur.rank}. Press Enter to open.` : ''}
      </p>
      <p className="mt-2 text-xs text-[var(--ink-3)]">Use ↑/↓ to move, Enter to open a profile. {rows.length} stars loaded.</p>
    </div>
  );
}
