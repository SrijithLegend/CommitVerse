'use client';
/** F10 Cosmic Feed — collapsible left panel; every item is clickable → warp. */
import type { FeedEvent } from '@commitverse/contracts';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Radio } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Api } from '@/lib/client/api';
import { subscribe } from '@/lib/client/realtime';

export function feedText(e: FeedEvent): string {
  const a = e.actor ? `@${e.actor.login}` : 'Someone';
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case 'claimed':
      return `${a} claimed their star`;
    case 'supernova':
      return p.kind === 'repo_stars'
        ? `${a} went supernova — ${p.repo} hit ${Number(p.threshold).toLocaleString()} ★`
        : `${a} went supernova (${Number(p.threshold).toLocaleString()} ${p.kind === 'stars_total' ? 'stars' : 'contributions'})`;
    case 'achievement_unlocked':
      return `${a} unlocked ${p.name}`;
    case 'gift_opened':
      return `${a} opened a gift${e.target ? ` from @${e.target.login}` : ''}`;
    case 'signal_sent':
      return Number(p.count ?? 1) > 1 ? `${a} sent ${p.count} signals` : `${a} signalled @${e.target?.login ?? 'a star'}`;
    case 'repo_milestone':
      return `${p.repo} by ${a} reached ${Number(p.threshold).toLocaleString()} ★`;
    case 'binary_formed':
      return `${a} and @${e.target?.login} formed a binary system`;
    case 'new_hypergiant':
      return `${a} became a hypergiant`;
    case 'release':
      return `${a} shipped a release of ${p.repo}`;
    case 'meteor_shower':
      return `Meteor shower: ${p.name}`;
    default:
      return `${a} · ${e.type.replace(/_/g, ' ')}`;
  }
}

export function useLiveFeed() {
  const { data, refetch } = useQuery({ queryKey: ['feed'], queryFn: () => Api.feed() });
  const [live, setLive] = useState<FeedEvent[]>([]);
  useEffect(
    () =>
      subscribe('feed:public', (_e, p) => {
        const ev = p as unknown as FeedEvent;
        if (!ev?.id) return;
        setLive((l) => [ev, ...l.filter((x) => x.id !== ev.id)].slice(0, 50));
      }),
    [],
  );
  const seen = new Set(live.map((e) => e.id));
  return { events: [...live, ...(data?.events ?? []).filter((e) => !seen.has(e.id))], refetch };
}

export function FeedPanel() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { events } = useLiveFeed();
  return (
    <aside className="pointer-events-none fixed left-3 top-16 z-30 hidden sm:block" aria-label="Cosmic feed">
      {open ? (
        <div className="glass pointer-events-auto flex max-h-[min(60vh,560px)] w-72 flex-col">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="label">Cosmic feed</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[var(--ink-3)] hover:text-[var(--ink-1)]"
              aria-label="Collapse feed"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
          <ul className="scroll-thin flex-1 overflow-auto px-1 pb-2" aria-live="polite">
            {events.slice(0, 60).map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => e.actor && router.push(`/@${e.actor.login}`)}
                  className="w-full rounded-lg px-2.5 py-2 text-left text-[12.5px] text-[var(--ink-2)] hover:bg-[rgba(124,196,255,0.06)] hover:text-[var(--ink-1)]"
                >
                  {feedText(e)}
                  <span className="mt-0.5 block font-mono text-[10px] text-[var(--ink-3)]">
                    {new Date(e.createdAt).toLocaleTimeString()}
                  </span>
                </button>
              </li>
            ))}
            {!events.length && <li className="px-3 py-2 text-xs text-[var(--ink-3)]">Listening for events…</li>}
          </ul>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="glass pointer-events-auto flex h-9 items-center gap-2 px-3 text-[12px] text-[var(--ink-2)] hover:text-[var(--ink-1)]"
        >
          <Radio size={14} className="text-[var(--accent)]" /> Cosmic feed
        </button>
      )}
    </aside>
  );
}
