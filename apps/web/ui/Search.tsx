'use client';
/**
 * F2 search & warp: prefix/trigram autocomplete (debounced 120 ms, top 8 with avatar, galaxy badge, class chip).
 * Known user → warp immediately (detail loads in parallel). Unknown → "Star Forming" materialization.
 * Organisations → constellation overlay. `/` or Ctrl+K focuses.
 */
import type { SearchResult } from '@commitverse/contracts';
import { ClassChip } from '@commitverse/ui-kit';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { Api, ApiProblem } from '@/lib/client/api';
import { play } from '@/lib/client/audio';
import { useSettings } from '@/lib/client/settings';
import { useUniverse } from '@/stores/universe';
import { toast } from './Toaster';

const CLASS_T: Record<string, number> = { M: 3000, K: 4400, G: 5600, F: 6700, A: 8600, B: 17000, O: 34000 };
const LOGIN = /^@?[a-zA-Z0-9-]{1,39}$/;

export async function goToStar(router: ReturnType<typeof useRouter>, login: string) {
  const clean = login.replace(/^@/, '');
  try {
    const r = await Api.materialize(clean);
    if (r.status === 'mapped') {
      router.push(`/@${r.login}`);
      play('warp');
      return;
    }
    useUniverse
      .getState()
      .set({ forming: { login: clean, jobId: r.jobId, status: 'queued', queuePosition: r.queuePosition ?? null, error: null } });
    const voidG =
      useUniverse.getState().manifest?.galaxies.find((g) => g.language === 'Void') ?? useUniverse.getState().manifest?.galaxies.at(-1);
    if (voidG) {
      const { sceneCommands } = await import('@/stores/universe');
      sceneCommands.push({ type: 'warpTo', position: voidG.center, radius: 40, frame: 400 });
    }
  } catch (e) {
    if (e instanceof ApiProblem && e.status === 410) toast('That star was removed at its owner’s request.');
    else if (e instanceof ApiProblem && e.code === 'github_unavailable')
      toast('This deployment can’t fetch new stars from GitHub right now. Try a mapped star.');
    else if (e instanceof ApiProblem && e.status === 429) toast(e.message, { tone: 'error' });
    else if (e instanceof ApiProblem && e.code === 'challenge_required') toast('Please complete the challenge to keep forming stars.');
    else toast('The search signal was lost. Try again.', { tone: 'error' });
  }
}

export function Search({
  autoFocus,
  variant = 'bar',
  placeholder = 'Find a star — GitHub username',
}: {
  autoFocus?: boolean;
  variant?: 'bar' | 'hero';
  placeholder?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultsFor, setResultsFor] = useState(''); // the term that results answer; stale while the debounce is pending
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const keys = useSettings((s) => s.keys);

  useEffect(() => {
    const onAction = (e: Event) => {
      if ((e as CustomEvent).detail === 'search' && variant === 'bar') input.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if ((e.code === keys.search && !e.shiftKey) || ((e.ctrlKey || e.metaKey) && e.code === 'KeyK')) {
        if (variant !== 'bar') return;
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('cv:action', onAction);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('cv:action', onAction);
      window.removeEventListener('keydown', onKey);
    };
  }, [keys.search, variant]);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      Api.search(term, ctrl.signal)
        .then((r) => {
          setResults(r.results);
          setResultsFor(term);
          setActive(0);
        })
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const choose = async (r: SearchResult | null) => {
    setOpen(false);
    input.current?.blur();
    if (r?.kind === 'org') {
      useUniverse.getState().set({ constellationOrg: r.login });
      useSettings.getState().set({ constellations: true });
      toast(`Showing the ${r.name ?? r.login} constellation`);
      return;
    }
    const login = r?.login ?? q.trim();
    if (!LOGIN.test(login)) return;
    setQ('');
    await goToStar(router, login);
  };

  const hero = variant === 'hero';
  return (
    <div className={`pointer-events-auto relative ${hero ? 'w-full max-w-lg' : 'w-full max-w-sm'}`}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const exact = results.find((r) => r.login.toLowerCase() === q.trim().replace(/^@/, '').toLowerCase());
          // Enter before the debounce lands must not pick the top hit of the previous (prefix) query
          const fresh = resultsFor === q.trim();
          void choose(open && fresh && results[active] ? results[active] : (exact ?? null));
        }}
      >
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search for a GitHub username
        </label>
        <input
          id={`${listId}-input`}
          ref={input}
          // biome-ignore lint/a11y/noAutofocus: opt-in per caller (search overlay opened by the / shortcut)
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Escape') {
              setOpen(false);
              input.current?.blur();
            }
          }}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={open && results.length > 0 ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          className={`glass w-full border-[rgba(160,190,255,0.14)] bg-[rgba(10,14,26,0.6)] font-mono text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)] focus:border-[rgba(124,196,255,0.55)] ${hero ? 'h-14 px-5 text-base' : 'h-9 px-3 text-[13px]'}`}
        />
        {!hero && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[rgba(160,190,255,0.18)] px-1.5 font-mono text-[10px] text-[var(--ink-3)]">
            /
          </span>
        )}
      </form>
      {open && results.length > 0 && (
        <ul id={listId} role="listbox" className="glass absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[60vh] overflow-auto p-1">
          {results.map((r, i) => (
            <li
              key={`${r.kind}-${r.githubId}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void choose(r)}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 ${i === active ? 'bg-[rgba(124,196,255,0.08)]' : ''}`}
            >
              {r.avatarUrl ? (
                // biome-ignore lint/performance/noImgElement: tiny remote avatars
                <img
                  src={`${r.avatarUrl}${r.avatarUrl.includes('?') ? '&' : '?'}s=48`}
                  alt=""
                  width={24}
                  height={24}
                  className="h-6 w-6 rounded-full"
                />
              ) : (
                <span className="h-6 w-6 rounded-full bg-[rgba(160,190,255,0.1)]" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-[var(--ink-1)]">
                  {r.kind === 'org' ? '✧ ' : '@'}
                  {r.login}
                </span>
                {r.name && <span className="block truncate text-xs text-[var(--ink-3)]">{r.name}</span>}
              </span>
              {r.galaxy && <span className="label shrink-0">{r.galaxy}</span>}
              {r.spectralClass && <ClassChip temperature={CLASS_T[r.spectralClass] ?? 5000} label={r.spectralClass} />}
              {r.kind === 'org' && <span className="label">constellation</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
