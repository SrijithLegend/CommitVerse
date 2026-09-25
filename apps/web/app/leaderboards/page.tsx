import type { Metadata } from 'next';
import { db } from '@/lib/server/app';
import { leaderboard } from '@/lib/server/queries';
import { LeaderboardTable } from '@/ui/LeaderboardTable';
import { PageShell } from '@/ui/PageShell';
import { SceneIntent } from '@/ui/SceneIntent';
import { ScopePicker } from '@/ui/ScopePicker';

export const metadata: Metadata = { title: 'Leaderboards', description: 'The brightest, hottest and fastest-rising stars in the Commitverse.' };
export const revalidate = 300;

export default async function Leaderboards({ searchParams }: { searchParams: Promise<{ scope?: string; metric?: string }> }) {
  const sp = await searchParams;
  const scope = sp.scope && /^(global|galaxy:\d+|org:[a-zA-Z0-9-]{1,39}|country:[A-Za-z]{2})$/.test(sp.scope) ? sp.scope : 'global';
  const d = await db();
  const initial = await leaderboard(d, scope, 'impact', 0).catch(() => ({ rows: [], nextCursor: null, total: 0 }));
  const galaxies = await d.query<{ id: number; language: string }>('select id, language from galaxies order by population desc');
  return (
    <PageShell title="Leaderboards" kicker="Global · per galaxy · per constellation" actions={<ScopePicker scope={scope} galaxies={galaxies} />}>
      <SceneIntent intent={{ type: 'dim' }} dim />
      <section className="glass p-4 sm:p-5">
        <LeaderboardTable key={scope} scope={scope} initial={initial} />
      </section>
    </PageShell>
  );
}
