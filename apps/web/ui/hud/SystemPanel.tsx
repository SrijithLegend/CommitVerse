'use client';
/**
 * F3 System Panel (right side; bottom sheet on mobile): identity, three-axis readout, heatmap, planets, achievements,
 * cosmetics, actions (signal, gift, compare, share, refresh, bind), "Why does my star look like this?", embed snippet.
 */
import type { StarDetail } from '@commitverse/contracts';
import { Button, ClassChip, Dialog, fmt, Gauge, Label } from '@commitverse/ui-kit';
import { kelvinToHex, spectralSubclass } from '@commitverse/universe-core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, Gift, RefreshCw, Send, Share2, Swords, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Api, ApiProblem } from '@/lib/client/api';
import { play } from '@/lib/client/audio';
import { sceneCommands, useUniverse } from '@/stores/universe';
import { useMe } from '../Providers';
import { toast } from '../Toaster';
import { Heatmap } from './Heatmap';

export function screenReaderSummary(d: StarDetail): string {
  const state = d.body.state === 'main' ? 'main-sequence' : d.body.state.replace('_', ' ');
  return `@${d.user.login}, ${d.body.spectralClass}-class ${state} star in the ${d.body.galaxy.language} galaxy${d.body.rankGalaxy ? `, rank ${fmt(d.body.rankGalaxy)}` : ''}. ${fmt(d.metrics.cTotal)} contributions, ${fmt(d.metrics.c30)} in the last 30 days, ${fmt(d.metrics.starsTotal)} stars across ${d.planets.length} planets.`;
}

function WhyPanel({ d }: { d: StarDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-[var(--panel-border)] pt-3">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between text-left text-sm text-[var(--ink-1)]">
        Why does this star look like this?
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <dl className="mt-3 space-y-3">
          {d.why.map((w) => (
            <div key={w.axis}>
              <dt className="label">{w.axis}</dt>
              <dd className="mt-1 text-[12.5px] text-[var(--ink-2)]">{w.raw}</dd>
              <dd className="mt-0.5 font-mono text-[11px] text-[var(--ink-3)]">{w.formula}</dd>
              <dd className="mt-0.5 font-mono text-[12px] text-[var(--ink-1)]">→ {w.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function SignalDialog({ d, onClose }: { d: StarDetail; onClose: () => void }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Signal @${d.user.login}`} description="A beam of light from your star to theirs. Optional message (60 chars, only they can see it).">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await Api.signal(d.user.login, msg || undefined);
            play('signal');
            toast(`Signal sent to @${d.user.login}`);
            onClose();
          } catch (err) {
            toast(err instanceof ApiProblem ? err.message : 'Signal lost in transit', { tone: 'error' });
          } finally {
            setBusy(false);
          }
        }}
      >
        <input value={msg} onChange={(e) => setMsg(e.target.value.slice(0, 60))} maxLength={60} placeholder="Great work on…" className="glass h-10 w-full px-3 text-sm outline-none" aria-label="Message" />
        <div className="mt-1 text-right font-mono text-[11px] text-[var(--ink-3)]">{msg.length}/60</div>
        <div className="mt-3 flex justify-end">
          <Button variant="primary" disabled={busy} type="submit" icon={<Send size={14} />}>
            Send signal
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function GiftDialog({ d, onClose }: { d: StarDetail; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['shop'], queryFn: Api.shop });
  const [anon, setAnon] = useState(false);
  const premium = (data?.items ?? []).filter((i) => i.track === 'premium');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Gift @${d.user.login}`} description="A wrapped gift pod will orbit their star until they open it. Unclaimed stars hold gifts for 90 days, then auto-refund." wide>
      <ul className="grid gap-2 sm:grid-cols-2">
        {premium.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              className="glass w-full p-3 text-left hover:border-[rgba(124,196,255,0.5)]"
              onClick={async () => {
                try {
                  const r = await Api.checkout(i.id, d.user.login, anon);
                  location.href = r.checkoutUrl;
                } catch (err) {
                  toast(err instanceof ApiProblem ? err.message : 'Checkout failed', { tone: 'error' });
                }
              }}
            >
              <div className="text-sm text-[var(--ink-1)]">{i.name}</div>
              <div className="mt-0.5 flex justify-between text-xs text-[var(--ink-3)]">
                <span className="capitalize">
                  {i.rarity} · {i.slot.replace('_', ' ')}
                </span>
                <span className="font-mono">${((i.priceMinor?.USD ?? 0) / 100).toFixed(2)}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <label className="mt-3 flex items-center gap-2 text-sm text-[var(--ink-2)]">
        <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} /> Send anonymously
      </label>
    </Dialog>
  );
}

function PlanetDetail({ d, slot }: { d: StarDetail; slot: number }) {
  const p = d.planets.find((x) => x.slot === slot);
  if (!p) return null;
  return (
    <div className="space-y-3">
      <button type="button" className="text-xs text-[var(--ink-2)] hover:text-[var(--ink-1)]" onClick={() => {
        sceneCommands.push({ type: 'focusPlanet', slot: null });
        useUniverse.getState().set({ panel: 'system' });
      }}>
        ← Back to @{d.user.login}
      </button>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: p.languageColor }} aria-hidden />
        <h3 className="truncate text-base font-semibold text-[var(--ink-1)]">{p.name}</h3>
      </div>
      {p.description && <p className="text-sm text-[var(--ink-2)]">{p.description}</p>}
      <dl className="grid grid-cols-3 gap-3 font-mono text-[12px]">
        <div><dt className="label">Stars</dt><dd className="num text-[var(--ink-1)]">{fmt(p.stars)}</dd></div>
        <div><dt className="label">Forks</dt><dd className="num text-[var(--ink-1)]">{fmt(p.forks)}</dd></div>
        <div><dt className="label">Releases</dt><dd className="num text-[var(--ink-1)]">{fmt(p.releases)}</dd></div>
        <div><dt className="label">Type</dt><dd className="text-[var(--ink-1)]">{p.type.replace('_', ' ')}</dd></div>
        <div><dt className="label">Moons</dt><dd className="text-[var(--ink-1)]">{p.moons}</dd></div>
        <div><dt className="label">Rings</dt><dd className="text-[var(--ink-1)]">{p.ringBands}</dd></div>
      </dl>
      <div className="text-xs text-[var(--ink-3)]">
        {p.language ?? 'Unknown language'} · last push {p.pushedAt ? new Date(p.pushedAt).toLocaleDateString() : 'never'}
        {p.isArchived ? ' · archived (frozen)' : ''}
        {p.aurora ? ' · aurora (pushed this week)' : ''}
      </div>
      {p.repoId < 4_000_000_000 ? (
        <a href={`https://github.com/${d.user.login}/${p.name}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-[var(--accent)]">
          Open on GitHub <ExternalLink size={13} />
        </a>
      ) : null}
    </div>
  );
}

export function SystemBody({ d, compact = false }: { d: StarDetail; compact?: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [dialog, setDialog] = useState<'signal' | 'gift' | null>(null);
  const mine = me?.githubId === d.user.githubId;
  const claimed = !!me?.claimed;
  const color = kelvinToHex(d.body.temperature);
  const flags = d.body.flags.filter((f) => f !== 'claimed' && f !== 'online');
  const label = `${d.body.subclass}${d.body.state !== 'main' ? ` · ${d.body.state.replace('_', ' ')}` : ''}${flags.length ? ` · ${flags.join(' · ')}` : ''}`;

  const refresh = async () => {
    try {
      await Api.refresh(d.user.login);
      toast(mine ? 'Refreshing your star (high priority)…' : 'Refresh queued');
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['star', d.user.login] }), 8000);
    } catch (e) {
      toast(e instanceof ApiProblem ? e.message : 'Refresh failed', { tone: 'error' });
    }
  };

  return (
    <div className="space-y-4">
      <p className="sr-only">{screenReaderSummary(d)}</p>
      <div className="flex items-start gap-3">
        {d.user.avatarUrl && (
          // biome-ignore lint/performance/noImgElement: avatar
          <img src={`${d.user.avatarUrl}${d.user.avatarUrl.includes('?') ? '&' : '?'}s=96`} alt="" width={48} height={48} className="h-12 w-12 rounded-[10px]" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-[var(--ink-1)]">{d.user.name ?? d.user.login}</h2>
          <Link href={`/@${d.user.login}`} className="block truncate font-mono text-xs text-[var(--ink-2)] hover:text-[var(--ink-1)]">
            @{d.user.login}
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <ClassChip temperature={d.body.temperature} label={label} />
            {d.social.claimed && <span className="label !text-[var(--accent)]">claimed</span>}
            {d.social.beaconActive && <span className="label !text-[#5ff]">coding now</span>}
          </div>
        </div>
      </div>
      {d.user.bio && !compact && <p className="text-[13px] leading-relaxed text-[var(--ink-2)]">{d.user.bio}</p>}
      <div className="text-xs text-[var(--ink-3)]">
        <Link href={`/galaxy/${encodeURIComponent(d.body.galaxy.language)}`} className="text-[var(--ink-2)] hover:text-[var(--ink-1)]">
          {d.body.galaxy.language} galaxy
        </Link>
        {d.body.rankGalaxy ? ` · rank #${fmt(d.body.rankGalaxy)}` : ''}
        {d.body.rankGlobal ? ` · #${fmt(d.body.rankGlobal)} universe` : ''}
        {d.body.provisional ? ' · provisional position' : ''}
      </div>

      <div className="space-y-3">
        <Gauge label="Radius · all-time" value={d.body.baseRadius - 0.6} max={5.4} display={`${fmt(d.metrics.cTotal)} contributions`} caption={`R ${fmt(d.body.radius, 2)} u`} />
        <Gauge label="Temperature · 30 days" value={Math.log(d.body.temperature / 2400)} max={Math.log(40000 / 2400)} color={color} display={`${fmt(d.metrics.c30)} · ${fmt(d.body.temperature)} K`} caption={d.metrics.streakCurrent ? `${d.metrics.streakCurrent}-day streak` : undefined} />
        <Gauge label="Luminosity · impact" value={d.body.luminosity} max={1.25} display={`${fmt(d.metrics.starsTotal)}★ · ${fmt(d.metrics.followers)} followers`} caption={`L ${fmt(d.body.luminosity, 2)} · impact ${fmt(d.body.impact, 2)}`} />
      </div>

      <div>
        <Label>Last 52 weeks</Label>
        <Heatmap days={d.metrics.calendar52w} temperature={d.body.temperature} />
      </div>

      {d.planets.length > 0 && (
        <div>
          <Label>Planets</Label>
          <ul className="mt-1.5 space-y-0.5">
            {d.planets.map((p) => (
              <li key={p.repoId}>
                <button
                  type="button"
                  onClick={() => {
                    sceneCommands.push({ type: 'focusPlanet', slot: p.slot });
                    const f = useUniverse.getState().focus;
                    useUniverse.getState().set({ panel: 'planet', ...(f?.kind === 'star' ? { focus: { ...f, planetSlot: p.slot } } : {}) });
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[rgba(124,196,255,0.06)]"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.languageColor }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink-1)]">{p.name}</span>
                  <span className="num font-mono text-[11px] text-[var(--ink-3)]">★ {fmt(p.stars)}</span>
                </button>
              </li>
            ))}
          </ul>
          {d.body.beltCount > 0 && <p className="mt-1 text-[11px] text-[var(--ink-3)]">+ {fmt(d.metrics.reposPublic - d.planets.length)} repos in the asteroid belt</p>}
        </div>
      )}

      {d.achievements.length > 0 && (
        <div>
          <Label>Achievements</Label>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {d.achievements.slice(0, 6).map((a) => (
              <li key={a.id} className="rounded-full border border-[var(--panel-border)] px-2 py-0.5 text-[11px] text-[var(--ink-2)]" title={`${a.tier} · ${fmt(a.rarity, 1)}% of claimed stars`}>
                {a.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!mine && (
          <Button size="sm" variant="ghost" icon={<Send size={13} />} disabled={!claimed} title={claimed ? undefined : 'Claim your star to send signals'} onClick={() => setDialog('signal')}>
            Signal · {fmt(d.social.signalsReceived)}
          </Button>
        )}
        {!mine && (
          <Button size="sm" variant="ghost" icon={<Gift size={13} />} disabled={!claimed} onClick={() => setDialog('gift')}>
            Gift
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<Swords size={13} />} onClick={() => router.push(me?.claimed && !mine ? `/compare/${me.login}/${d.user.login}` : `/compare/${d.user.login}`)}>
          Compare
        </Button>
        <Button size="sm" variant="ghost" icon={<Share2 size={13} />} onClick={() => useUniverse.getState().set({ overlay: 'share' })}>
          Share
        </Button>
        {d.fetchedAt ? (
          <Button size="sm" variant="quiet" icon={<RefreshCw size={13} />} onClick={() => void refresh()}>
            Refresh
          </Button>
        ) : null}
        {claimed && !mine && d.social.claimed && !d.social.binaryWith && (
          <Button
            size="sm"
            variant="quiet"
            onClick={async () => {
              try {
                await Api.bind(d.user.login);
                toast('Binary request sent');
              } catch (e) {
                toast(e instanceof ApiProblem ? e.message : 'Request failed', { tone: 'error' });
              }
            }}
          >
            Form binary
          </Button>
        )}
      </div>
      {d.social.binaryWith && (
        <p className="text-xs text-[var(--ink-2)]">
          Binary system with{' '}
          <Link className="text-[var(--accent)]" href={`/@${d.social.binaryWith}`}>
            @{d.social.binaryWith}
          </Link>
        </p>
      )}

      <WhyPanel d={d} />

      {mine && (
        <div className="border-t border-[var(--panel-border)] pt-3">
          <Label>README embed</Label>
          <code className="mt-1.5 block break-all rounded-md bg-[rgba(160,190,255,0.05)] p-2 font-mono text-[11px] text-[var(--ink-2)]">
            {`[![My star](${typeof location !== 'undefined' ? location.origin : ''}/api/embed/${d.user.login}.svg)](${typeof location !== 'undefined' ? location.origin : ''}/@${d.user.login})`}
          </code>
        </div>
      )}
      <p className="font-mono text-[10px] text-[var(--ink-3)]">
        {d.fetchedAt ? `Refreshed ${new Date(d.fetchedAt).toLocaleString()}` : 'Synthetic star (staging universe)'} · bake {d.bakeVersion}
      </p>

      {dialog === 'signal' && <SignalDialog d={d} onClose={() => setDialog(null)} />}
      {dialog === 'gift' && <GiftDialog d={d} onClose={() => setDialog(null)} />}
    </div>
  );
}

export function SystemPanel() {
  const panel = useUniverse((s) => s.panel);
  const d = useUniverse((s) => s.focusDetail);
  const focus = useUniverse((s) => s.focus);
  if (!panel || !d || focus?.kind !== 'star') return null;
  const slot = focus.planetSlot ?? null;
  return (
    <aside
      aria-label="System panel"
      className="glass pointer-events-auto fixed inset-x-2 bottom-2 z-30 max-h-[58vh] overflow-y-auto p-4 scroll-thin sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-16 sm:max-h-[calc(100vh-5.5rem)] sm:w-[340px]"
    >
      <button type="button" className="absolute right-2 top-2 rounded p-1 text-[var(--ink-3)] hover:text-[var(--ink-1)]" aria-label="Close panel" onClick={() => useUniverse.getState().set({ panel: null })}>
        <X size={15} />
      </button>
      {panel === 'planet' && slot !== null ? <PlanetDetail d={d} slot={slot} /> : <SystemBody d={d} />}
      <span className="sr-only">{`${spectralSubclass(d.body.temperature)}`}</span>
    </aside>
  );
}
