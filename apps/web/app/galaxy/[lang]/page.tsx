/** Galaxy overview: camera goes to galaxy view; stats + class distribution + leaderboard. */
import { compact, fmt, Stat } from '@commitverse/ui-kit';
import { kelvinToHex } from '@commitverse/universe-core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/server/app';
import { ApiError } from '@/lib/server/errors';
import { galaxyOverview } from '@/lib/server/queries';
import { LeaderboardTable } from '@/ui/LeaderboardTable';
import { SceneIntent } from '@/ui/SceneIntent';

type Props = { params: Promise<{ lang: string }> };
const CLASS_T: Record<string, number> = { M: 3000, K: 4400, G: 5600, F: 6700, A: 8600, B: 17000, O: 34000 };

async function load(lang: string) {
  try {
    return await galaxyOverview(await db(), decodeURIComponent(lang));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const o = await load((await params).lang);
  return o
    ? {
        title: `${o.galaxy.language} galaxy`,
        description: `${fmt(o.galaxy.population)} developers whose primary language is ${o.galaxy.language}.`,
      }
    : { title: 'Galaxy not found' };
}

export default async function GalaxyPage({ params }: Props) {
  const o = await load((await params).lang);
  if (!o) notFound();
  const total = Object.values(o.classes).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="pointer-events-none min-h-dvh px-4 pb-24 pt-20">
      <SceneIntent intent={{ type: 'galaxy', lang: o.galaxy.language }} />
      <aside className="glass pointer-events-auto ml-auto max-h-[calc(100dvh-7rem)] w-full max-w-md overflow-auto p-5 scroll-thin">
        <div className="label">
          {o.galaxy.tier} galaxy{o.galaxy.arms ? ` · ${o.galaxy.arms} arms` : ''}
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-[var(--ink-1)]">{o.galaxy.language}</h1>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="Stars" value={compact(o.stats.stars ?? 0)} />
          <Stat label="Claimed" value={compact(o.stats.claimed ?? 0)} />
          <Stat label="Pulsars" value={compact(o.stats.pulsars ?? 0)} />
          <Stat label="30-day contrib" value={compact(o.stats.c30 ?? 0)} />
          <Stat label="Red giants" value={compact(o.stats.red_giants ?? 0)} />
          <Stat label="Protostars" value={compact(o.stats.protostars ?? 0)} />
        </div>
        <div className="mt-5">
          <div className="label">Spectral classes</div>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full" role="img" aria-label="Spectral class distribution">
            {['M', 'K', 'G', 'F', 'A', 'B', 'O'].map((c) => (
              <div
                key={c}
                style={{ width: `${((o.classes[c] ?? 0) / total) * 100}%`, background: kelvinToHex(CLASS_T[c]!) }}
                title={`${c}: ${o.classes[c] ?? 0}`}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--ink-3)]">
            {['M', 'K', 'G', 'F', 'A', 'B', 'O'].map((c) => (
              <span key={c}>
                {c} {fmt(((o.classes[c] ?? 0) / total) * 100)}%
              </span>
            ))}
          </div>
        </div>
        <div className="mt-6">
          <LeaderboardTable
            scope={`galaxy:${o.galaxy.id}`}
            initial={{ rows: o.top, nextCursor: o.top.length === 50 ? 50 : null, total: o.galaxy.population }}
          />
        </div>
      </aside>
    </div>
  );
}
