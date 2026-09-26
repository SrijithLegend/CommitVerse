/** F21 landing: the hero IS the live universe. Headline + "Find your star" + "Claim yours" + live counters. */
import { compact } from '@commitverse/ui-kit';
import { db } from '@/lib/server/app';
import { liveCounters } from '@/lib/server/queries';
import { LiveCounters } from '@/ui/LiveCounters';
import { SceneIntent } from '@/ui/SceneIntent';
import { Search } from '@/ui/Search';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ invitedBy?: string }> }) {
  const { invitedBy } = await searchParams;
  const counters = await liveCounters(await db()).catch(() => ({ stars: 0, comets: 0, claimed: 0 }));
  const invited = invitedBy && /^[a-zA-Z0-9-]{1,39}$/.test(invitedBy) ? invitedBy : null;
  return (
    <section className="flex min-h-dvh flex-col items-center justify-center px-5 pb-28 pt-24 text-center">
      <SceneIntent intent={invited ? { type: 'star', login: invited } : { type: 'hero' }} tourAfterIdleMs={60_000} />
      {invited && (
        <p className="glass pointer-events-auto mb-6 px-4 py-2 text-sm text-[var(--ink-2)]">
          <span className="font-mono text-[var(--ink-1)]">@{invited}</span> invited you to the universe
        </p>
      )}
      <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-[var(--ink-1)] sm:text-6xl">
        Every developer is a star.
      </h1>
      <p className="mt-4 max-w-xl text-balance text-base text-[var(--ink-2)] sm:text-lg">
        Every repo is a planet. Every language is a galaxy. A live universe generated from public GitHub activity.
      </p>
      <div className="mt-8 flex w-full max-w-lg flex-col items-center gap-3">
        <Search variant="hero" autoFocus={false} placeholder="Find your star — enter a GitHub username" />
        <a
          href="/auth/signin"
          className="pointer-events-auto inline-flex h-11 items-center rounded-[10px] bg-[var(--accent)] px-5 text-sm font-medium text-[var(--space-0)] hover:bg-[#9dd3ff]"
        >
          Claim yours
        </a>
      </div>
      <LiveCounters initial={counters} />
      <noscript>
        <p className="mt-6 text-sm text-[var(--ink-2)]">
          The universe needs JavaScript. You can still browse the <a href="/leaderboards">leaderboards</a> ({compact(counters.stars)} stars
          mapped).
        </p>
      </noscript>
    </section>
  );
}
