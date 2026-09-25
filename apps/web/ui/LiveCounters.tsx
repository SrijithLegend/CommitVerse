'use client';
/** F21 live counters: stars mapped, explorers online (presence), comets in the last hour (+ live comets). */
import { compact } from '@commitverse/ui-kit';
import { useEffect, useState } from 'react';
import { subscribe } from '@/lib/client/realtime';
import { useUniverse } from '@/stores/universe';

export function LiveCounters({ initial }: { initial: { stars: number; comets: number; claimed: number } }) {
  const starCount = useUniverse((s) => s.starCount);
  const presence = useUniverse((s) => s.presence);
  const [comets, setComets] = useState(initial.comets);
  useEffect(() => subscribe('cosmic:global', (e) => (e === 'comet' || e === 'supernova') && setComets((c) => c + 1)), []);
  const items: [string, number][] = [
    ['stars mapped', Math.max(initial.stars, starCount)],
    ['stars claimed', initial.claimed],
    ['explorers online', Math.max(1, presence.total)],
    ['comets this hour', comets],
  ];
  return (
    <dl className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-3" aria-label="Live counters">
      {items.map(([k, v]) => (
        <div key={k} className="text-center">
          <dd className="num font-mono text-xl text-[var(--ink-1)]">{compact(v)}</dd>
          <dt className="label mt-0.5">{k}</dt>
        </div>
      ))}
    </dl>
  );
}
