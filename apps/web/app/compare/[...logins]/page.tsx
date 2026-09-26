/**
 * F12 Binary View `/compare/a/b` (up to 4 — P2 "star cluster compare"): the systems orbit a shared barycenter on a
 * staging point; below, a stat table with per-row winners, a radar of universe percentiles, heatmaps, shared orgs.
 */
import type { StarDetail } from '@commitverse/contracts';
import { LOGIN_RE } from '@commitverse/contracts';
import { compact, fmt, StarDot } from '@commitverse/ui-kit';
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/server/app';
import { resolveLogin, starDetail } from '@/lib/server/stars';
import { ComparePicker } from '@/ui/ComparePicker';
import { Heatmap } from '@/ui/hud/Heatmap';
import { PageShell } from '@/ui/PageShell';
import { Radar } from '@/ui/Radar';
import { SceneIntent } from '@/ui/SceneIntent';

type Props = { params: Promise<{ logins: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const logins = (await params).logins.map(decodeURIComponent);
  return { title: logins.length > 1 ? logins.map((l) => `@${l}`).join(' vs ') : 'Compare', robots: { index: false } };
}

const AXES = [
  { key: 'c_total', label: 'Radius' },
  { key: 'c_30', label: 'Temperature' },
  { key: 'impact', label: 'Luminosity' },
  { key: 'streak', label: 'Streak' },
  { key: 'stars', label: 'Stars' },
  { key: 'followers', label: 'Followers' },
] as const;

export default async function Compare({ params }: Props) {
  const logins = (await params).logins
    .map(decodeURIComponent)
    .filter((l) => LOGIN_RE.test(l))
    .slice(0, 4);
  const d = await db();
  const details: StarDetail[] = [];
  for (const l of logins) {
    const u = await resolveLogin(d, l);
    if (u && !u.optedOut) details.push(await starDetail(d, u.githubId).catch(() => null as never));
  }
  const stars = details.filter(Boolean);
  if (stars.length < 2) {
    return (
      <PageShell title="Binary View" kicker="Compare two to four stars">
        <SceneIntent intent={{ type: 'dim' }} dim />
        <ComparePicker first={stars[0]?.user.login ?? logins[0] ?? ''} />
      </PageShell>
    );
  }
  const pct = await Promise.all(
    stars.map(async (s) => {
      const [r] = await d.query<Record<string, number>>(
        `select (select count(*) from user_metrics where c_total < $1)::float8 / greatest(1, (select count(*) from user_metrics)) as c_total,
                (select count(*) from user_metrics where c_30 < $2)::float8 / greatest(1, (select count(*) from user_metrics)) as c_30,
                (select count(*) from bodies where impact < $3)::float8 / greatest(1, (select count(*) from bodies)) as impact,
                (select count(*) from user_metrics where streak_longest < $4)::float8 / greatest(1, (select count(*) from user_metrics)) as streak,
                (select count(*) from user_metrics where stars_total < $5)::float8 / greatest(1, (select count(*) from user_metrics)) as stars,
                (select count(*) from user_metrics where followers < $6)::float8 / greatest(1, (select count(*) from user_metrics)) as followers`,
        [s.metrics.cTotal, s.metrics.c30, s.body.impact, s.metrics.streakLongest, s.metrics.starsTotal, s.metrics.followers],
      );
      return AXES.map((a) => r![a.key] ?? 0);
    }),
  );
  const orgSets = stars.map((s) => new Set(s.orgs.map((o) => o.login)));
  const shared = [...orgSets[0]!].filter((o) => orgSets.every((set) => set.has(o)));
  const rows: [string, (s: StarDetail) => number, (n: number) => string][] = [
    ['All-time contributions', (s) => s.metrics.cTotal, (n) => fmt(n)],
    ['Last 30 days', (s) => s.metrics.c30, (n) => fmt(n)],
    ['Current streak', (s) => s.metrics.streakCurrent, (n) => `${n} d`],
    ['Longest streak', (s) => s.metrics.streakLongest, (n) => `${n} d`],
    ['Stars', (s) => s.metrics.starsTotal, compact],
    ['Followers', (s) => s.metrics.followers, compact],
    ['Public repos', (s) => s.metrics.reposPublic, (n) => fmt(n)],
    ['Temperature', (s) => s.body.temperature, (n) => `${fmt(n)} K`],
    ['Impact', (s) => s.body.impact, (n) => fmt(n, 2)],
    ['Signals received', (s) => s.social.signalsReceived, (n) => fmt(n)],
  ];
  return (
    <div className="pointer-events-none">
      <SceneIntent intent={{ type: 'compare', a: stars[0]!.user.login, b: stars[1]!.user.login }} />
      <div className="h-[80dvh]" aria-hidden />
      <PageShell title={stars.map((s) => `@${s.user.login}`).join(' vs ')} kicker="Binary View">
        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          <section className="glass overflow-x-auto p-4">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="label py-2 text-left font-normal">Metric</th>
                  {stars.map((s) => (
                    <th key={s.user.githubId} className="py-2 text-right">
                      <Link href={`/@${s.user.login}`} className="inline-flex items-center gap-1.5 font-mono text-xs text-[var(--ink-1)]">
                        <StarDot temperature={s.body.temperature} size={8} />@{s.user.login}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, get, show]) => {
                  const vals = stars.map(get);
                  const best = Math.max(...vals);
                  return (
                    <tr key={label} className="border-t border-[var(--panel-border)]">
                      <td className="py-2 text-[var(--ink-2)]">{label}</td>
                      {vals.map((v, i) => (
                        <td
                          key={i}
                          className={`num py-2 text-right font-mono ${v === best && vals.filter((x) => x === best).length === 1 ? 'text-[var(--accent)]' : 'text-[var(--ink-1)]'}`}
                        >
                          {show(v)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <section className="glass p-4">
            <h2 className="label">Universe percentiles</h2>
            <Radar
              axes={AXES.map((a) => a.label)}
              series={stars.map((s, i) => ({ label: `@${s.user.login}`, temperature: s.body.temperature, values: pct[i]! }))}
            />
          </section>
        </div>
        <section className="glass mt-4 space-y-3 p-4">
          <h2 className="label">Last 52 weeks</h2>
          {stars.map((s) => (
            <div key={s.user.githubId}>
              <div className="font-mono text-xs text-[var(--ink-2)]">@{s.user.login}</div>
              <Heatmap days={s.metrics.calendar52w} temperature={s.body.temperature} cell={7} />
            </div>
          ))}
        </section>
        <section className="glass mt-4 p-4">
          <h2 className="label">Shared constellations</h2>
          <p className="mt-2 text-sm text-[var(--ink-2)]">
            {shared.length ? shared.map((o) => `✧ ${o}`).join('  ') : 'No shared organisations.'}
          </p>
        </section>
      </PageShell>
    </div>
  );
}
