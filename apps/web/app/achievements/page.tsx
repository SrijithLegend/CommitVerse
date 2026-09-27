import { fmt } from '@commitverse/ui-kit';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { db } from '@/lib/server/app';
import { achievementsCatalog, cachedFor } from '@/lib/server/queries';
import { PageShell } from '@/ui/PageShell';
import { SceneIntent } from '@/ui/SceneIntent';

export const metadata: Metadata = { title: 'Achievements', description: 'Every Commitverse achievement, with its global rarity.' };

const TIER_COLOR: Record<string, string> = { bronze: '#c98a5a', silver: '#c4cad6', gold: '#e8c268', cosmic: '#b48cff' };

export default async function Achievements() {
  await connection(); // request-time only: no DB at build (every page is dynamic via the CSP nonce anyway)
  const c = await cachedFor('achievements', 3_600_000, async () => achievementsCatalog(await db()));
  const tiers = ['bronze', 'silver', 'gold', 'cosmic'] as const;
  return (
    <PageShell title="Achievements" kicker={`${c.achievements.length} to earn · rarity among ${fmt(c.claimedUsers)} claimed stars`} wide>
      <SceneIntent intent={{ type: 'dim' }} dim />
      {tiers.map((t) => (
        <section key={t} className="mb-6">
          <h2 className="label mb-2" style={{ color: TIER_COLOR[t] }}>
            {t}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {c.achievements
              .filter((a) => a.tier === t)
              .map((a) => (
                <li key={a.id} className="glass p-3.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--ink-1)]">{a.name}</span>
                    <span className="num font-mono text-[11px] text-[var(--ink-3)]">{fmt(a.rarity, 1)}%</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--ink-2)]">{a.description}</p>
                  <p className="mt-1.5 font-mono text-[11px] text-[var(--accent)]">+{a.stardust} ✦</p>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </PageShell>
  );
}
