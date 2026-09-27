/**
 * §8.2 — job queues. Production: pg-boss (Postgres-backed). Local mode: an in-process queue with the
 * same semantics (priority, per-queue concurrency, singleton keys, 5 retries with backoff + jitter, dead letter).
 */
import type { Db } from '@commitverse/db';
import { log } from './log';

export const QUEUES = {
  materialize: { priority: 100, concurrency: 8 },
  refresh: { priority: 40, concurrency: 6 },
  'events-poll': { priority: 50, concurrency: 20 },
  webhook: { priority: 90, concurrency: 16 },
  'archive-ingest': { priority: 20, concurrency: 1 },
  delta: { priority: 60, concurrency: 1 },
  bake: { priority: 30, concurrency: 1 },
  achievements: { priority: 40, concurrency: 8 },
  notify: { priority: 40, concurrency: 8 },
  scheduler: { priority: 70, concurrency: 1 },
  maintenance: { priority: 10, concurrency: 1 },
} as const;
export type QueueName = keyof typeof QUEUES;

export interface SendOptions {
  priority?: number;
  singletonKey?: string;
  startAfterSeconds?: number;
}

export type Handler = (data: Record<string, unknown>) => Promise<void>;

export interface JobQueue {
  send(name: QueueName, data: Record<string, unknown>, opts?: SendOptions): Promise<string | null>;
  work(name: QueueName, handler: Handler): Promise<void>;
  schedule(name: QueueName, cron: string, data?: Record<string, unknown>): Promise<void>;
  depth(name: QueueName): Promise<number>;
  stop(): Promise<void>;
}

const RETRY_LIMIT = 5;

// ─── pg-boss ─────────────────────────────────────────────────────────────

/**
 * `sendOnly` (the web app on serverless): no supervision, cron or schema migration, and a 2-connection pool — the worker
 * owns maintenance, and many short-lived instances each running it would multiply DB connections and lock contention.
 */
export async function createPgBossQueue(connectionString: string, opts: { sendOnly?: boolean } = {}): Promise<JobQueue> {
  const { PgBoss } = await import('pg-boss');
  const boss = new PgBoss({
    connectionString,
    max: opts.sendOnly ? 2 : 10,
    application_name: opts.sendOnly ? 'commitverse-web' : 'commitverse-queue',
    ...(opts.sendOnly ? { supervise: false, schedule: false, migrate: false, createSchema: false } : {}),
  });
  boss.on('error', (e: unknown) => log.error({ err: e }, 'pg-boss error'));
  await boss.start();
  const created = new Set<string>();
  const ensure = async (name: string) => {
    if (created.has(name)) return;
    await boss.createQueue(`${name}-dlq`, { retentionSeconds: 14 * 86_400 });
    await boss.createQueue(name, {
      retryLimit: RETRY_LIMIT,
      retryDelay: 5,
      retryBackoff: true,
      retryDelayMax: 3600,
      expireInSeconds: name === 'bake' ? 3600 : 900,
      deadLetter: `${name}-dlq`,
    });
    created.add(name);
  };
  return {
    async send(name, data, opts = {}) {
      await ensure(name);
      return boss.send(name, data, {
        priority: opts.priority ?? QUEUES[name].priority,
        singletonKey: opts.singletonKey,
        startAfter: opts.startAfterSeconds,
      });
    },
    async work(name, handler) {
      await ensure(name);
      await boss.work(name, { batchSize: 1, localConcurrency: QUEUES[name].concurrency, pollingIntervalSeconds: 1 }, async (jobs) => {
        for (const job of jobs) await handler(job.data as Record<string, unknown>);
      });
    },
    async schedule(name, cron, data = {}) {
      await ensure(name);
      await boss.schedule(name, cron, data, { tz: 'UTC' });
    },
    async depth(name) {
      await ensure(name);
      const s =
        (await (boss as unknown as { getQueueStats?: (n: string) => Promise<{ queuedCount?: number }> }).getQueueStats?.(name)) ?? {};
      return s.queuedCount ?? 0;
    },
    stop: () => boss.stop({ graceful: true, timeout: 30_000 }),
  };
}

// ─── In-process (local mode) ─────────────────────────────────────────────

interface LocalJob {
  id: string;
  name: QueueName;
  data: Record<string, unknown>;
  priority: number;
  runAt: number;
  attempts: number;
  singletonKey?: string;
  seq: number;
}

/** Five-field cron matcher (minute hour dom month dow), supports * , - and /n. UTC. */
export function cronMatches(cron: string, d: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Invalid cron: ${cron}`);
  const values = [d.getUTCMinutes(), d.getUTCHours(), d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCDay()];
  const ranges: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ];
  return fields.every((f, i) =>
    f.split(',').some((part) => {
      const [rangePart, stepPart] = part.split('/');
      const step = stepPart ? Number(stepPart) : 1;
      let [lo, hi] = ranges[i]!;
      if (rangePart !== '*') {
        const [a, b] = rangePart!.split('-').map(Number);
        lo = a!;
        hi = b ?? (stepPart ? ranges[i]![1] : a!);
      }
      const v = values[i]!;
      return v >= lo && v <= hi && (v - lo) % step === 0;
    }),
  );
}

export function createLocalQueue(db?: Db): JobQueue {
  const pending: LocalJob[] = [];
  const active = new Map<QueueName, number>();
  const activeKeys = new Set<string>();
  const handlers = new Map<QueueName, Handler>();
  const crons: { name: QueueName; cron: string; data: Record<string, unknown> }[] = [];
  let seq = 0;
  let stopped = false;
  let lastCronMinute = -1;

  const pump = () => {
    if (stopped) return;
    const now = Date.now();
    pending.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    for (let i = 0; i < pending.length; i++) {
      const job = pending[i]!;
      const handler = handlers.get(job.name);
      if (!handler || job.runAt > now) continue;
      const running = active.get(job.name) ?? 0;
      if (running >= QUEUES[job.name].concurrency) continue;
      pending.splice(i--, 1);
      active.set(job.name, running + 1);
      if (job.singletonKey) activeKeys.add(`${job.name}:${job.singletonKey}`);
      handler(job.data)
        .catch(async (err: unknown) => {
          job.attempts++;
          const msg = err instanceof Error ? err.message : String(err);
          if (job.attempts <= RETRY_LIMIT) {
            const delay = Math.min(3600, 5 * 2 ** (job.attempts - 1)) * (0.5 + Math.random());
            log.warn({ queue: job.name, attempt: job.attempts, err: msg }, 'job failed, retrying');
            pending.push({ ...job, runAt: Date.now() + delay * 1000, seq: seq++ });
          } else {
            log.error({ queue: job.name, err: msg }, 'job dead-lettered');
            await db
              ?.query('insert into job_failures (queue, data, error) values ($1, $2, $3)', [job.name, JSON.stringify(job.data), msg])
              .catch(() => {});
          }
        })
        .finally(() => {
          active.set(job.name, (active.get(job.name) ?? 1) - 1);
          if (job.singletonKey) activeKeys.delete(`${job.name}:${job.singletonKey}`);
          setImmediate(pump);
        });
    }
  };

  const timer = setInterval(() => {
    const now = new Date();
    const minute = Math.floor(now.getTime() / 60_000);
    if (minute !== lastCronMinute) {
      lastCronMinute = minute;
      for (const c of crons) if (cronMatches(c.cron, now)) void api.send(c.name, c.data, { singletonKey: `cron:${minute}` });
    }
    pump();
  }, 1000);
  timer.unref?.();

  const api: JobQueue = {
    async send(name, data, opts = {}) {
      if (opts.singletonKey) {
        const k = `${name}:${opts.singletonKey}`;
        if (activeKeys.has(k) || pending.some((j) => j.name === name && j.singletonKey === opts.singletonKey)) return null;
      }
      const id = `local-${Date.now().toString(36)}-${(seq++).toString(36)}`;
      pending.push({
        id,
        name,
        data,
        priority: opts.priority ?? QUEUES[name].priority,
        runAt: Date.now() + (opts.startAfterSeconds ?? 0) * 1000,
        attempts: 0,
        singletonKey: opts.singletonKey,
        seq: seq++,
      });
      setImmediate(pump);
      return id;
    },
    async work(name, handler) {
      handlers.set(name, handler);
      setImmediate(pump);
    },
    async schedule(name, cron, data = {}) {
      cronMatches(cron, new Date()); // validate
      crons.push({ name, cron, data });
    },
    async depth(name) {
      return pending.filter((j) => j.name === name).length;
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
  return api;
}
