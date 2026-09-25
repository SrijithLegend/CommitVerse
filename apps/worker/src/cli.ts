/**
 * Operator CLI:
 *   pnpm seed [count]         synthetic universe (default 20,000 locally; staging uses 1,000,000)
 *   pnpm bake                 run a bake now
 *   pnpm migrate              apply supabase/migrations (local PGlite or DATABASE_URL)
 *   tsx src/cli.ts materialize <login>   fetch one real user (needs GITHUB_TOKEN or App creds)
 *   tsx src/cli.ts rollback <version>
 */
import { getDb, migrate } from '@commitverse/db';
import {
  buildDelta,
  fetchUser,
  ingestUser,
  log,
  rollbackTo,
  runAchievements,
  runBake,
  seedSynthetic,
  syncAchievementCatalog,
  syncItems,
} from '@commitverse/pipeline';

const [cmd, arg] = process.argv.slice(2);
const db = await getDb();

try {
  switch (cmd) {
    case 'migrate': {
      const applied = process.env.DATABASE_URL ? await migrate(db) : [];
      log.info({ applied }, 'migrations applied');
      break;
    }
    case 'seed': {
      await syncAchievementCatalog(db);
      await syncItems(db);
      await seedSynthetic(db, { count: Number(arg ?? 20_000) });
      const r = await runBake(db, { triggeredBy: 'seed' });
      await buildDelta(db);
      log.info(r, 'seeded and baked');
      break;
    }
    case 'bake': {
      const r = await runBake(db, { triggeredBy: 'cli' });
      await buildDelta(db);
      log.info(r, 'baked');
      break;
    }
    case 'materialize': {
      if (!arg) throw new Error('usage: materialize <login>');
      const r = await fetchUser(db, arg);
      if (r.kind !== 'user') throw new Error(`not materializable: ${r.kind}`);
      const res = await ingestUser(db, r.fetched);
      await runAchievements(db, res.githubId);
      await buildDelta(db);
      log.info({ githubId: res.githubId, metrics: res.metrics, placed: res.placed }, 'materialized');
      break;
    }
    case 'rollback': {
      if (!arg) throw new Error('usage: rollback <bakeVersion>');
      await rollbackTo(db, arg);
      log.info({ version: arg }, 'rolled back');
      break;
    }
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
} finally {
  await db.close();
}
