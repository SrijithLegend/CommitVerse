'use client';
/**
 * F2 "Star Forming": collapsing-nebula overlay with the job status (queued → fetching → placing → born) and the queue
 * position when it takes > 5 s. Realtime job:{id} is primary; GET /jobs/:id polling is the fallback.
 */
import type { SearchResult } from '@commitverse/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Api } from '@/lib/client/api';
import { subscribe } from '@/lib/client/realtime';
import { useUniverse } from '@/stores/universe';

const STEPS = ['queued', 'fetching', 'placing', 'born'] as const;

export function StarForming() {
  const router = useRouter();
  const forming = useUniverse((s) => s.forming);
  const [since, setSince] = useState(0);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);

  useEffect(() => {
    if (!forming?.jobId) return;
    setSince(Date.now());
    const apply = (status: string, extra: { error?: string | null; queuePosition?: number | null } = {}) => {
      const cur = useUniverse.getState().forming;
      if (!cur || cur.jobId !== forming.jobId) return;
      useUniverse.getState().set({ forming: { ...cur, status, error: extra.error ?? cur.error, queuePosition: extra.queuePosition ?? cur.queuePosition } });
      if (status === 'born') {
        setTimeout(() => {
          useUniverse.getState().set({ forming: null });
          router.push(`/@${cur.login}`);
        }, 900);
      }
      if (status === 'failed' && (extra.error === 'not_found' || extra.error === 'organization' || extra.error === 'bot')) {
        void Api.search(cur.login)
          .then((r) => setSuggestions(r.results.slice(0, 3)))
          .catch(() => {});
      }
    };
    const off = subscribe(`job:${forming.jobId}`, (_e, p) => apply(String(p.status), { error: (p.error as string) ?? null }));
    const poll = setInterval(() => {
      void Api.job(forming.jobId!)
        .then((j) => apply(j.status, { error: j.error, queuePosition: j.queuePosition }))
        .catch(() => {});
    }, 2000);
    return () => {
      off();
      clearInterval(poll);
    };
  }, [forming?.jobId, router, forming]);

  if (!forming) return null;
  const failed = forming.status === 'failed';
  const idx = STEPS.indexOf(forming.status as (typeof STEPS)[number]);
  const slow = Date.now() - since > 5000;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center" role="status" aria-live="polite">
      {!failed && (
        <div aria-hidden className="absolute h-[60vmin] w-[60vmin] animate-[nebula_6s_ease-in-out_infinite] rounded-full opacity-70 blur-2xl" style={{ background: 'radial-gradient(circle, rgba(255,95,179,0.35), rgba(122,60,255,0.18) 45%, transparent 70%)' }} />
      )}
      <div className="glass pointer-events-auto relative w-[min(92vw,380px)] p-5 text-center">
        {failed ? (
          <>
            <div className="text-base text-[var(--ink-1)]">No such signal in the sky</div>
            <p className="mt-1 text-sm text-[var(--ink-2)]">
              {forming.error === 'organization'
                ? `@${forming.login} is an organization — organizations are constellations, not stars.`
                : forming.error === 'opted_out'
                  ? 'This star was removed at its owner’s request.'
                  : `We couldn’t find a GitHub user called @${forming.login}.`}
            </p>
            {suggestions.length > 0 && (
              <ul className="mt-3 space-y-1">
                {suggestions.map((s) => (
                  <li key={s.githubId}>
                    <button
                      type="button"
                      className="w-full rounded-md px-3 py-1.5 font-mono text-sm text-[var(--accent)] hover:bg-[rgba(124,196,255,0.08)]"
                      onClick={() => {
                        useUniverse.getState().set({ forming: null });
                        router.push(`/@${s.login}`);
                      }}
                    >
                      @{s.login}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => useUniverse.getState().set({ forming: null })} className="mt-4 text-sm text-[var(--ink-2)] hover:text-[var(--ink-1)]">
              Close
            </button>
          </>
        ) : (
          <>
            <div className="label">Star forming</div>
            <div className="mt-1 font-mono text-lg text-[var(--ink-1)]">@{forming.login}</div>
            <ol className="mt-4 flex items-center justify-between gap-1">
              {STEPS.map((s, i) => (
                <li key={s} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className={`h-1.5 w-full rounded-full ${i <= idx ? 'bg-[var(--accent)]' : 'bg-[rgba(160,190,255,0.12)]'} ${i === idx ? 'animate-pulse' : ''}`} />
                  <span className={`font-mono text-[10px] uppercase tracking-wider ${i <= idx ? 'text-[var(--ink-1)]' : 'text-[var(--ink-3)]'}`}>{s}</span>
                </li>
              ))}
            </ol>
            {slow && forming.queuePosition !== null && forming.status === 'queued' && (
              <p className="mt-3 text-xs text-[var(--ink-2)]">Position in queue: {forming.queuePosition}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
