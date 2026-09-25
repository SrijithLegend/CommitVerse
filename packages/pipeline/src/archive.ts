/**
 * GH Archive hourly ingest (§8.4 multiplier 3). Stream-parses one hour of public events and keeps per-actor daily
 * push counts for mapped users; stale users get a c_30 approximation (c_30_source = 'archive'). No API cost.
 */

import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { Db } from '@commitverse/db';
import { log } from './log';

export const archiveUrl = (hour: Date): string => {
  const d = hour.toISOString();
  return `https://data.gharchive.org/${d.slice(0, 10)}-${Number(d.slice(11, 13))}.json.gz`;
};

/** Counts pushes per actor per day from GH Archive NDJSON lines (only for `mapped` actors). */
export async function countPushes(lines: AsyncIterable<string>, mapped: Set<number>): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for await (const line of lines) {
    if (!line.includes('"PushEvent"')) continue;
    let e: { type?: string; actor?: { id?: number }; created_at?: string; payload?: { size?: number; distinct_size?: number } };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const id = e.actor?.id;
    if (e.type !== 'PushEvent' || !id || !mapped.has(id) || !e.created_at) continue;
    const key = `${id}|${e.created_at.slice(0, 10)}`;
    counts.set(key, (counts.get(key) ?? 0) + Math.max(1, e.payload?.distinct_size ?? e.payload?.size ?? 1));
  }
  return counts;
}

export async function ingestArchiveHour(db: Db, hour: Date): Promise<number> {
  const h = new Date(Math.floor(hour.getTime() / 3_600_000) * 3_600_000);
  const [done] = await db.query('select 1 from archive_hours where hour = $1', [h]);
  if (done) return 0;
  const res = await fetch(archiveUrl(h));
  if (res.status === 404) return 0; // not published yet; the next run retries
  if (!res.ok || !res.body) throw new Error(`GH Archive ${res.status}`);
  const mapped = new Set(
    (await db.query<{ github_id: number }>('select github_id from github_users where not is_opted_out and not synthetic')).map(
      (r) => r.github_id,
    ),
  );
  const stream = Readable.fromWeb(res.body as never).pipe(createGunzip());
  const counts = await countPushes(createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY }), mapped);
  const ids: number[] = [];
  const days: string[] = [];
  const pushes: number[] = [];
  for (const [k, v] of counts) {
    const [id, day] = k.split('|');
    ids.push(Number(id));
    days.push(day!);
    pushes.push(v);
  }
  await db.tx(async (q) => {
    if (ids.length)
      await q.query(
        `insert into archive_daily (github_id, day, pushes) select * from unnest($1::bigint[], $2::date[], $3::int[])
         on conflict (github_id, day) do update set pushes = archive_daily.pushes + excluded.pushes`,
        [ids, days, pushes],
      );
    // Users whose API data is > 2 days old get their c_30 from the archive rollup.
    await q.query(
      `update user_metrics m set c_30 = s.total, c_30_source = 'archive', updated_at = now()
       from (select github_id, sum(pushes)::int as total from archive_daily where day > (now() at time zone 'utc')::date - 30
             and github_id = any($1::bigint[]) group by github_id) s
       where m.github_id = s.github_id and m.updated_at < now() - interval '2 days'`,
      [ids],
    );
    await q.query('insert into archive_hours (hour, actors) values ($1, $2) on conflict do nothing', [h, new Set(ids).size]);
    await q.query(`delete from archive_daily where day < (now() at time zone 'utc')::date - 400`);
  });
  log.info({ job: 'archive-ingest', hour: h.toISOString(), actors: new Set(ids).size }, 'archive hour');
  return ids.length;
}
