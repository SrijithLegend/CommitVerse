'use client';
import type { FeedEvent } from '@commitverse/contracts';
import { Button, fmtDate } from '@commitverse/ui-kit';
import Link from 'next/link';
import { useState } from 'react';
import { Api } from '@/lib/client/api';
import { feedText, useLiveFeed } from './hud/FeedPanel';

export function FeedList() {
  const { events } = useLiveFeed();
  const [older, setOlder] = useState<FeedEvent[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const all = [...events, ...older.filter((o) => !events.some((e) => e.id === o.id))];
  const last = all.at(-1)?.id;
  return (
    <section className="glass p-2">
      <ul aria-live="polite">
        {all.map((e) => (
          <li key={e.id} className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-[rgba(124,196,255,0.04)]">
            {e.actor?.avatarUrl && (
              // biome-ignore lint/performance/noImgElement: avatar
              <img
                src={`${e.actor.avatarUrl}${e.actor.avatarUrl.includes('?') ? '&' : '?'}s=48`}
                alt=""
                width={24}
                height={24}
                className="mt-0.5 h-6 w-6 rounded-md"
              />
            )}
            <div className="min-w-0 flex-1">
              {e.actor ? (
                <Link href={`/@${e.actor.login}`} className="text-sm text-[var(--ink-1)] hover:text-[var(--accent)]">
                  {feedText(e)}
                </Link>
              ) : (
                <span className="text-sm text-[var(--ink-1)]">{feedText(e)}</span>
              )}
              <div className="font-mono text-[11px] text-[var(--ink-3)]">{fmtDate(e.createdAt, true)}</div>
            </div>
          </li>
        ))}
        {!all.length && <li className="px-3 py-6 text-center text-sm text-[var(--ink-3)]">The universe is quiet right now.</li>}
      </ul>
      {last && cursor !== -1 && (
        <div className="p-2 text-center">
          <Button
            size="sm"
            variant="quiet"
            onClick={async () => {
              const r = await Api.feed(cursor ?? last);
              setOlder((o) => [...o, ...r.events]);
              setCursor(r.nextCursor ?? -1);
            }}
          >
            Older events
          </Button>
        </div>
      )}
    </section>
  );
}
