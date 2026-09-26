'use client';
/** F13 leaderboard: pages of 50, "jump to me", each row with a mini star sprite in its real colour. */
import type { LeaderboardRow } from '@commitverse/contracts';
import { Button, compact, fmt, StarDot } from '@commitverse/ui-kit';
import { Tabs } from '@commitverse/ui-kit/radix';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Api } from '@/lib/client/api';
import { useMe } from './Providers';

export const METRICS = [
  { value: 'impact', label: 'Impact' },
  { value: 'c_total', label: 'All-time' },
  { value: 'c_30', label: '30 days' },
  { value: 'streak', label: 'Longest streak' },
  { value: 'stars', label: 'Stars' },
  { value: 'rising', label: 'Rising' },
  { value: 'signals', label: 'Signals' },
];

const format = (metric: string, v: number) =>
  metric === 'impact'
    ? fmt(v, 2)
    : metric === 'rising'
      ? `${v > 0 ? '+' : ''}${fmt(v, 1)} pts`
      : metric === 'streak'
        ? `${fmt(v)} d`
        : compact(v);

export function LeaderboardTable({
  scope,
  initialMetric = 'impact',
  initial,
}: {
  scope: string;
  initialMetric?: string;
  initial?: { rows: LeaderboardRow[]; nextCursor: number | null; total: number };
}) {
  const [metric, setMetric] = useState(initialMetric);
  const [cursor, setCursor] = useState(0);
  const [me, setMe] = useState<string | undefined>();
  const { data: account } = useMe();
  const { data, isFetching } = useQuery({
    queryKey: ['lb', scope, metric, cursor, me],
    queryFn: () => Api.leaderboard(scope, metric, cursor, me),
    initialData: metric === initialMetric && cursor === 0 && !me ? initial : undefined,
  });
  const rows = data?.rows ?? [];
  return (
    <div>
      <Tabs
        tabs={METRICS}
        value={metric}
        onValueChange={(v) => {
          setMetric(v);
          setCursor(0);
          setMe(undefined);
        }}
      />
      <div className="mt-3 flex items-center justify-between text-xs text-[var(--ink-3)]">
        <span className="num font-mono">{data ? `${fmt(data.total)} stars` : '…'}</span>
        {account?.claimed && (
          <Button size="sm" variant="quiet" onClick={() => setMe(account.login)}>
            Jump to me
          </Button>
        )}
      </div>
      <table className="mt-2 w-full text-sm" aria-busy={isFetching}>
        <thead>
          <tr className="label text-left">
            <th className="w-14 py-2 font-normal">#</th>
            <th className="py-2 font-normal">Star</th>
            <th className="hidden py-2 font-normal sm:table-cell">Galaxy</th>
            <th className="py-2 text-right font-normal">{METRICS.find((m) => m.value === metric)?.label}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.githubId}
              className={`border-t border-[var(--panel-border)] ${me && r.login.toLowerCase() === me.toLowerCase() ? 'bg-[rgba(124,196,255,0.08)]' : ''}`}
            >
              <td className="num py-2 font-mono text-[var(--ink-3)]">{fmt(r.rank)}</td>
              <td className="py-2">
                <Link href={`/@${r.login}`} className="flex items-center gap-2.5 hover:text-[var(--accent)]">
                  <StarDot temperature={r.temperature} />
                  <span className="truncate text-[var(--ink-1)]">@{r.login}</span>
                  <span className="font-mono text-[11px] text-[var(--ink-3)]">{r.spectralClass}</span>
                </Link>
              </td>
              <td className="hidden py-2 text-[var(--ink-2)] sm:table-cell">{r.galaxy}</td>
              <td className="num py-2 text-right font-mono text-[var(--ink-1)]">{format(metric, r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex justify-between">
        <Button size="sm" variant="ghost" disabled={cursor === 0} onClick={() => setCursor(Math.max(0, cursor - 50))}>
          Previous
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={data?.nextCursor == null}
          onClick={() => data?.nextCursor != null && setCursor(data.nextCursor)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
