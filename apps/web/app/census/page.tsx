/** F17 Galactic Census — universe-wide stats, refreshed monthly (aggregates cached 1 h per instance). */
import { compact, fmt, fmtDate, Stat } from '@commitverse/ui-kit';
import { kelvinToHex } from '@commitverse/universe-core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { db } from '@/lib/server/app';
import { cachedFor, census } from '@/lib/server/queries';
import { PageShell } from '@/ui/PageShell';
import { SceneIntent } from '@/ui/SceneIntent';

export const metadata: Metadata = {
  title: 'Galactic Census',
  description: 'The state of the universe: stars, classes, galaxies and events.',
};
const CLASS_T: Record<string, number> = { M: 3000, K: 4400, G: 5600, F: 6700, A: 8600, B: 17000, O: 34000 };

export default async function Census() {
  await connection(); // request-time only: no DB at build (every page is dynamic via the CSP nonce anyway)
  const c = await cachedFor('census', 3_600_000, async () => census(await db()));
  const t = c.totals ?? {};
  const classTotal = c.classes.reduce((a, b) => a + b.n, 0) || 1;
  const galTotal = c.galaxies.reduce((a, b) => a + b.population, 0) || 1;
  return (
    <PageShell title="State of the Universe" kicker={`Galactic census · bake ${c.bakeVersion ?? '—'}`} wide>
      <SceneIntent intent={{ type: 'dim' }} dim />
      <section className="glass grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
        <Stat label="Stars" value={compact(t.stars ?? 0)} />
        <Stat label="Claimed" value={compact(t.claimed ?? 0)} />
        <Stat label="Galaxies" value={fmt(t.galaxies ?? 0)} />
        <Stat label="Coding right now" value={fmt(t.coding_now ?? 0)} />
        <Stat label="Contributions" value={compact(t.contributions ?? 0)} hint="all-time, all stars" />
        <Stat label="Last 30 days" value={compact(t.contributions_30d ?? 0)} />
        <Stat label="Pulsars" value={compact(t.pulsars ?? 0)} hint="30+ day streaks" />
        <Stat label="Binaries" value={fmt(t.binaries ?? 0)} />
        <Stat label="Hypergiants" value={fmt(t.hypergiants ?? 0)} />
        <Stat label="Supernovas" value={fmt(t.supernovas_30d ?? 0)} hint="last 30 days" />
        <Stat label="Signals" value={compact(t.signals_30d ?? 0)} hint="last 30 days" />
      </section>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="glass p-5">
          <h2 className="label">Spectral classes</h2>
          <ul className="mt-3 space-y-2">
            {c.classes.map((k) => (
              <li key={k.cls} className="flex items-center gap-3 text-sm">
                <span className="w-4 font-mono text-[var(--ink-1)]">{k.cls}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-[rgba(160,190,255,0.06)]">
                  <span
                    className="block h-full"
                    style={{ width: `${(k.n / classTotal) * 100}%`, background: kelvinToHex(CLASS_T[k.cls] ?? 5000) }}
                  />
                </span>
                <span className="num w-20 text-right font-mono text-xs text-[var(--ink-2)]">{fmt((k.n / classTotal) * 100, 1)}%</span>
              </li>
            ))}
          </ul>
          <h2 className="label mt-6">Stellar states</h2>
          <ul className="mt-2 grid grid-cols-2 gap-2 text-sm">
            {c.states.map((s) => (
              <li key={s.state} className="flex justify-between text-[var(--ink-2)]">
                <span className="capitalize">{s.state.replace('_', ' ')}</span>
                <span className="num font-mono text-[var(--ink-1)]">{compact(s.n)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="glass p-5">
          <h2 className="label">Galaxies</h2>
          <ul className="mt-3 space-y-1.5">
            {c.galaxies.map((g) => (
              <li key={g.id} className="flex items-center gap-3 text-sm">
                <Link
                  href={`/galaxy/${encodeURIComponent(g.language)}`}
                  className="w-36 truncate text-[var(--ink-1)] hover:text-[var(--accent)]"
                >
                  {g.language}
                </Link>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(160,190,255,0.06)]">
                  <span className="block h-full bg-[var(--ink-3)]" style={{ width: `${(g.population / galTotal) * 100 * 4}%` }} />
                </span>
                <span className="num w-14 text-right font-mono text-xs text-[var(--ink-2)]">{compact(g.population)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {c.recentSupernovas.length > 0 && (
        <section className="glass mt-4 p-5">
          <h2 className="label">Recent supernovas</h2>
          <ul className="mt-2 space-y-1 text-sm text-[var(--ink-2)]">
            {c.recentSupernovas.map((s) => (
              <li key={`${s.login}-${s.at}`}>
                <Link href={`/@${s.login}`} className="font-mono text-[var(--ink-1)] hover:text-[var(--accent)]">
                  @{s.login}
                </Link>{' '}
                · {fmt(Number(s.payload.threshold))} {String(s.payload.kind).replace('_', ' ')} · {fmtDate(s.at)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
