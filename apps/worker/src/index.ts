/**
 * Commitverse worker (Fly.io / Railway): pg-boss queues for ingest, archive, bake, delta, achievements, notify.
 * Long-running by design — bake jobs run for minutes, which serverless functions can't host.
 */
import { createServer } from 'node:http';
import { parseServerEnv } from '@commitverse/contracts/env';
import { getDb } from '@commitverse/db';
import { createLocalQueue, createPgBossQueue, log, registerWorkers } from '@commitverse/pipeline';
import * as Sentry from '@sentry/node';
import { refundOrder, sendEmail } from './services';

const env = parseServerEnv();
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    release: process.env.FLY_IMAGE_REF ?? process.env.RAILWAY_GIT_COMMIT_SHA,
    beforeSend(event) {
      // §11.2: tokens never leave the process
      const scrub = (s?: string) => s?.replace(/(gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+\S+)/g, '[redacted]');
      if (event.message) event.message = scrub(event.message);
      for (const ex of event.exception?.values ?? []) ex.value = scrub(ex.value);
      return event;
    },
  });
}

const db = await getDb();
const queue = env.DATABASE_URL ? await createPgBossQueue(env.DATABASE_URL) : createLocalQueue(db);
await registerWorkers(db, queue, { refundGift: (orderId) => refundOrder(db, orderId), sendEmail });

let healthy = true;
const server = createServer(async (req, res) => {
  if (req.url === '/healthz') {
    try {
      await db.query('select 1');
      res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: healthy }));
    } catch {
      res.writeHead(503).end('{"ok":false}');
    }
    return;
  }
  res.writeHead(404).end();
});
server.listen(Number(process.env.PORT ?? 8080));
log.info({ port: process.env.PORT ?? 8080, queue: env.DATABASE_URL ? 'pg-boss' : 'local' }, 'worker started');

const shutdown = async (signal: string) => {
  healthy = false;
  log.info({ signal }, 'worker shutting down');
  await queue.stop();
  await db.close();
  server.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  log.error({ err: String(err) }, 'unhandled rejection');
  Sentry.captureException(err);
});
