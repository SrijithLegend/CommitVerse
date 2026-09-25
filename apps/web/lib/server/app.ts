/**
 * Server bootstrap. Production: Postgres + pg-boss (send-only; the worker app consumes).
 * Local mode: embedded Postgres, an in-process worker, and an auto-seeded synthetic universe on first run.
 */
import 'server-only';
import { isLocalMode, parseServerEnv, type ServerEnv } from '@commitverse/contracts';
import { type Db, getDb } from '@commitverse/db';
import {
  buildDelta,
  createLocalQueue,
  createPgBossQueue,
  getUniverse,
  type JobQueue,
  log,
  registerWorkers,
  runBake,
  seedSynthetic,
  syncAchievementCatalog,
  syncItems,
} from '@commitverse/pipeline';

const g = globalThis as unknown as {
  __cvEnv?: ServerEnv;
  __cvApp?: Promise<{ db: Db; queue: JobQueue }>;
};

export function env(): ServerEnv {
  g.__cvEnv ??= parseServerEnv();
  return g.__cvEnv;
}

export const localMode = (): boolean => isLocalMode(env());

async function boot(): Promise<{ db: Db; queue: JobQueue }> {
  const e = env();
  const db = await getDb();
  if (!isLocalMode(e)) {
    const queue = await createPgBossQueue(e.DATABASE_URL!);
    return { db, queue };
  }
  const queue = createLocalQueue(db);
  await syncAchievementCatalog(db);
  await syncItems(db);
  await registerWorkers(db, queue);
  if (!(await getUniverse(db, true))) {
    const count = Number(process.env.LOCAL_SEED_COUNT ?? 20_000);
    log.info({ count }, 'local mode: seeding a synthetic universe (first run only)');
    await seedSynthetic(db, { count });
    await runBake(db, { triggeredBy: 'bootstrap' });
    await buildDelta(db);
  }
  return { db, queue };
}

export function app(): Promise<{ db: Db; queue: JobQueue }> {
  if (!g.__cvApp) {
    g.__cvApp = boot();
    g.__cvApp.catch((err) => {
      log.error({ err: String(err) }, 'boot failed');
      g.__cvApp = undefined;
    });
  }
  return g.__cvApp;
}

export const db = async (): Promise<Db> => (await app()).db;
export const queue = async (): Promise<JobQueue> => (await app()).queue;

export const tilesBase = (): string => process.env.NEXT_PUBLIC_TILES_BASE_URL?.replace(/\/$/, '') ?? '';
