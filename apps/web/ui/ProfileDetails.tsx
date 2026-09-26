/** F4 below-the-fold profile content (server component): stats grid, heatmap, planets, achievements, rank history. */
import type { StarDetail } from '@commitverse/contracts';
import { compact, fmt, Stat } from '@commitverse/ui-kit';
import Link from 'next/link';
import { Heatmap } from './hud/Heatmap';
import { SystemBody } from './hud/SystemPanel';

function Sparkline({ points }: { points: (number | null)[] }) {
  const vals = points.filter((v): v is number => v !== null);
  if (vals.length < 2) return <p className="text-xs text-[var(--ink-3)]">Rank history appears after two nightly bakes.</p>;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const w = 280;
  const h = 48;
  const d = points
    .map((v, i) => (v === null ? null : `${(i / (points.length - 1)) * w},${h - ((v - min) / Math.max(1e-6, max - min)) * (h - 6) - 3}`))
    .filter(Boolean)
    .join(' L');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={`Galaxy percentile over the last ${points.length} bakes`}>
      <path d={`M${d}`} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

export function ProfileDetails({ detail: s }: { detail: StarDetail }) {
  return (
    <div className="pointer-events-auto relative mx-auto grid max-w-5xl gap-4 px-4 pb-24 md:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <section className="glass p-5" aria-labelledby="stats">
          <h2 id="stats" className="label">
            Statistics
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Contributions" value={fmt(s.metrics.cTotal)} hint="all-time" />
            <Stat label="Last 30 days" value={fmt(s.metrics.c30)} hint={`${fmt(s.metrics.c365)} this year`} />
            <Stat label="Streak" value={`${s.metrics.streakCurrent} d`} hint={`longest ${s.metrics.streakLongest} d`} />
            <Stat label="Stars" value={compact(s.metrics.starsTotal)} hint={s.metrics.starsApprox ? 'top 100 repos' : undefined} />
            <Stat label="Followers" value={compact(s.metrics.followers)} />
            <Stat label="Public repos" value={fmt(s.metrics.reposPublic)} />
            <Stat label="Signals" value={fmt(s.social.signalsReceived)} hint="received" />
            <Stat label="Galaxy rank" value={s.body.rankGalaxy ? `#${fmt(s.body.rankGalaxy)}` : '—'} hint={s.body.galaxy.language} />
          </div>
        </section>
        <section className="glass p-5" aria-labelledby="activity">
          <h2 id="activity" className="label">
            Activity · last 52 weeks
          </h2>
          <Heatmap days={s.metrics.calendar52w} temperature={s.body.temperature} cell={9} />
        </section>
        <section className="glass p-5" aria-labelledby="planets">
          <h2 id="planets" className="label">
            Planets
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {s.planets.map((p) => (
              <li key={p.repoId} className="rounded-lg border border-[var(--panel-border)] p-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.languageColor }} aria-hidden />
                  <Link
                    href={`/@${s.user.login}?focus=${encodeURIComponent(p.name)}`}
                    className="truncate text-sm text-[var(--ink-1)] hover:text-[var(--accent)]"
                  >
                    {p.name}
                  </Link>
                </div>
                {p.description && <p className="mt-1 line-clamp-2 text-xs text-[var(--ink-2)]">{p.description}</p>}
                <p className="mt-1.5 font-mono text-[11px] text-[var(--ink-3)]">
                  ★ {fmt(p.stars)} · ⑂ {fmt(p.forks)} · {p.language ?? '—'} · {p.type.replace('_', ' ')}
                  {p.releases ? ` · ${p.releases} releases` : ''}
                </p>
              </li>
            ))}
            {!s.planets.length && <li className="text-sm text-[var(--ink-3)]">No public repositories yet — a planetless protostar.</li>}
          </ul>
        </section>
        <section className="glass p-5" aria-labelledby="ach">
          <h2 id="ach" className="label">
            Achievements
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {s.achievements.map((a) => (
              <li key={a.id} className="rounded-full border border-[var(--panel-border)] px-3 py-1 text-xs text-[var(--ink-2)]">
                {a.name} <span className="font-mono text-[var(--ink-3)]">{fmt(a.rarity, 1)}%</span>
              </li>
            ))}
            {!s.achievements.length && <li className="text-sm text-[var(--ink-3)]">None yet.</li>}
          </ul>
        </section>
        <section className="glass p-5" aria-labelledby="rank">
          <h2 id="rank" className="label">
            Galactic drift
          </h2>
          <Sparkline points={s.rankHistory.map((r) => (r.pctGalaxy === null ? null : 1 - r.pctGalaxy))} />
        </section>
        {(s.orgs.length > 0 || s.social.binaryWith) && (
          <section className="glass p-5" aria-labelledby="rel">
            <h2 id="rel" className="label">
              Constellations & binaries
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {s.orgs.map((o) => (
                <li key={o.login} className="rounded-full border border-[var(--panel-border)] px-3 py-1 text-xs text-[var(--ink-2)]">
                  ✧ {o.name ?? o.login}
                </li>
              ))}
            </ul>
            {s.social.binaryWith && (
              <p className="mt-3 text-sm text-[var(--ink-2)]">
                Binary partner:{' '}
                <Link className="text-[var(--accent)]" href={`/@${s.social.binaryWith}`}>
                  @{s.social.binaryWith}
                </Link>
              </p>
            )}
          </section>
        )}
      </div>
      <aside className="glass h-fit p-5 md:sticky md:top-20">
        <SystemBody d={s} compact />
      </aside>
    </div>
  );
}
