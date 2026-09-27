/**
 * Operator CLI:
 *   pnpm seed [count]         synthetic universe (default 20,000 locally; staging uses 1,000,000)
 *   pnpm bake                 run a bake now
 *   pnpm migrate              apply supabase/migrations (local PGlite or DATABASE_URL)
 *   tsx src/cli.ts materialize <login>   fetch one real user (needs GITHUB_TOKEN or App creds)
 *   tsx src/cli.ts rollback <version>
 *   tsx src/cli.ts enqueue <file>        pre-launch seeding: queue a login list (one per line) for the worker
 */
import { readFileSync } from 'node:fs';
import { parseServerEnv } from '@commitverse/contracts/env';
import { getDb, migrate } from '@commitverse/db';
import {
  buildDelta,
  createPgBossQueue,
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
    case 'enqueue': {
      // Appendix E seeding: the running worker drains these within the GitHub budget guard (§8.4). Priority 10 sits
      // below user-initiated lookups (100), so live users are never stuck behind the seed list.
      const url = parseServerEnv().DATABASE_URL;
      if (!arg || !url) throw new Error('usage: DATABASE_URL=… enqueue <file-with-one-login-per-line>');
      const logins = [
        ...new Set(
          readFileSync(arg, 'utf8')
            .split(/\s+/)
            .map((s) => s.replace(/^@/, '')),
        ),
      ].filter((l) => /^[a-zA-Z0-9-]{1,39}$/.test(l));
      const q = await createPgBossQueue(url, { sendOnly: true });
      let queued = 0;
      for (const login of logins) {
        const [job] = await db.query<{ id: string }>(
          `insert into materialize_jobs (login, priority) select $1::text, 10
           where not exists (select 1 from github_users where login = $1::citext) on conflict do nothing returning id`,
          [login],
        );
        if (!job) continue; // already mapped or already in flight
        await q.send('materialize', { jobId: job.id, login }, { priority: 10, singletonKey: `m:${login.toLowerCase()}` });
        queued++;
      }
      await q.stop();
      log.info({ listed: logins.length, queued }, 'seed list enqueued');
      break;
    }
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
} finally {
  await db.close();
}
