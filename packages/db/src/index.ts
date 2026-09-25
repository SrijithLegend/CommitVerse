/**
 * Postgres access. Production: postgres.js against Supabase (DATABASE_URL, direct connection).
 * Local mode: PGlite (real Postgres compiled to WASM) persisted under DATA_DIR — same SQL, same migrations.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type Row = Record<string, unknown>;

export interface Sql {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Sql {
  kind: 'pglite' | 'postgres';
  /** Runs a multi-statement script (simple protocol, no parameters). */
  exec(script: string): Promise<void>;
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const INT8 = 20;
const DATE = 1082;
const NUMERIC = 1700;

export async function createPostgres(url: string, max = 10): Promise<Db> {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, {
    max,
    prepare: false, // safe behind Supabase's transaction pooler too
    types: {
      bigint: { to: INT8, from: [INT8], parse: (x: string) => Number(x), serialize: (x: number) => String(x) },
      date: { to: DATE, from: [DATE], parse: (x: string) => x, serialize: (x: string) => x },
      numeric: { to: NUMERIC, from: [NUMERIC], parse: (x: string) => Number(x), serialize: (x: number) => String(x) },
    },
    onnotice: () => {},
  });
  const wrap = (s: typeof sql): Sql => ({
    query: async <T>(text: string, params: unknown[] = []) => (await s.unsafe(text, params as never[])) as unknown as T[],
  });
  return {
    kind: 'postgres',
    ...wrap(sql),
    exec: async (script) => {
      await sql.unsafe(script).simple();
    },
    tx: <T>(fn: (q: Sql) => Promise<T>) => sql.begin((t) => fn(wrap(t as unknown as typeof sql))) as Promise<T>,
    close: () => sql.end({ timeout: 5 }),
  };
}

export async function createPglite(dataDir: string | null): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = await PGlite.create({
    dataDir: dataDir ?? undefined,
    extensions: { citext, pg_trgm, pgcrypto },
    parsers: { [INT8]: (v: string) => Number(v), [DATE]: (v: string) => v, [NUMERIC]: (v: string) => Number(v) },
  });
  const run = async <T>(q: { query: typeof pg.query }, text: string, params: unknown[] = []) => (await q.query<T>(text, params)).rows;
  return {
    kind: 'pglite',
    query: (text, params) => run(pg, text, params),
    exec: async (script) => {
      await pg.exec(script);
    },
    tx: (fn) => pg.transaction((t) => fn({ query: (text, params) => run(t, text, params) })),
    close: () => pg.close(),
  };
}

// ─── Migrations ───────────────────────────────────────────────────────────

/** Finds the monorepo root (the directory containing pnpm-workspace.yaml). */
export function repoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error('Could not find the Commitverse repo root');
    dir = up;
  }
}

const SUPABASE_SHIM = `
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
`;

/** Applies supabase/migrations/*.sql in order. In local mode it first installs a tiny Supabase shim (auth schema). */
export async function migrate(db: Db, opts: { shim?: boolean; dir?: string } = {}): Promise<string[]> {
  const dir = opts.dir ?? join(repoRoot(), 'supabase', 'migrations');
  if (opts.shim) await db.exec(SUPABASE_SHIM);
  await db.query('create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ name: string }>('select name from _migrations')).map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (done.has(file)) continue;
    const text = readFileSync(join(dir, file), 'utf8');
    await db.exec(`begin;
${text}
;insert into _migrations (name) values ('${file.replace(/'/g, '')}');
commit;`);
    applied.push(file);
  }
  return applied;
}

// ─── Singleton ─────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __cvDb?: Promise<Db> };

/**
 * Process-wide database. Local mode (no DATABASE_URL, not production) uses PGlite and auto-migrates.
 * DATA_DIR=":memory:" keeps local mode ephemeral (tests).
 */
export function getDb(): Promise<Db> {
  if (!g.__cvDb) {
    g.__cvDb = (async () => {
      const url = process.env.DATABASE_URL;
      if (url) return createPostgres(url, Number(process.env.DB_POOL_MAX ?? 10));
      if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production');
      const dataDir = process.env.DATA_DIR ?? join(repoRoot(), '.data');
      const db = await createPglite(dataDir === ':memory:' ? null : join(dataDir, 'pglite'));
      await migrate(db, { shim: true });
      return db;
    })();
    g.__cvDb.catch(() => {
      g.__cvDb = undefined;
    });
  }
  return g.__cvDb;
}

/** Test helper: a fresh in-memory, migrated database. */
export async function createTestDb(): Promise<Db> {
  const db = await createPglite(null);
  await migrate(db, { shim: true });
  return db;
}
