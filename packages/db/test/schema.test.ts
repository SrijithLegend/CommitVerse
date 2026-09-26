import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '../src';

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(() => db.close());

async function user(id: number, login = `u${id}`) {
  await db.query(`insert into github_users (github_id, login, created_at_gh) values ($1, $2, now() - interval '5 years')`, [id, login]);
}
async function account(id: number) {
  const uid = (await db.query<{ id: string }>('insert into auth.users default values returning id'))[0]!.id;
  await db.query('insert into accounts (auth_user_id, github_id, referral_code) values ($1, $2, $3)', [uid, id, `ref${id}`]);
}

describe('Â§9 schema', () => {
  it('migrates and types int8 as numbers, dates as strings', async () => {
    await user(9_007_199_254, 'Octo-Cat');
    const [r] = await db.query<{ github_id: number; d: string }>(
      `select github_id, date '2026-09-24' as d from github_users where login = 'octo-cat'`,
    );
    expect(r).toEqual({ github_id: 9_007_199_254, d: '2026-09-24' });
  });

  it('stardust ledger is idempotent and the balance can never go negative', async () => {
    await user(1);
    await account(1);
    await db.query(`insert into stardust_ledger (github_id, delta, reason, ref_id) values (1, 10, 'daily', '2026-09-24')`);
    await expect(
      db.query(`insert into stardust_ledger (github_id, delta, reason, ref_id) values (1, 10, 'daily', '2026-09-24')`),
    ).rejects.toThrow();
    await expect(
      db.query(`insert into stardust_ledger (github_id, delta, reason, ref_id) values (1, -11, 'purchase', 'x')`),
    ).rejects.toThrow();
    const [row] = await db.query<{ stardust_balance: number }>('select stardust_balance from accounts where github_id = 1');
    const stardust_balance = row!.stardust_balance;
    expect(stardust_balance).toBe(10);
    await expect(db.query('delete from stardust_ledger')).rejects.toThrow(/append-only/);
  });

  it('signals: no self-signals, one per recipient per day', async () => {
    await user(2);
    await user(3);
    await expect(db.query('insert into signals (from_id, to_id) values (2, 2)')).rejects.toThrow();
    await db.query('insert into signals (from_id, to_id) values (2, 3)');
    await expect(db.query('insert into signals (from_id, to_id) values (2, 3)')).rejects.toThrow();
  });

  it('one active binary per user', async () => {
    await user(4);
    await user(5);
    await user(6);
    await db.query(`insert into bindings (a_id, b_id, requested_by, status) values (4, 5, 4, 'active')`);
    await expect(db.query(`insert into bindings (a_id, b_id, requested_by, status) values (4, 6, 4, 'active')`)).rejects.toThrow(
      /binary_limit/,
    );
  });

  it('a GitHub account can be claimed by exactly one auth user', async () => {
    await user(7);
    await account(7);
    await expect(account(7)).rejects.toThrow();
  });

  it('events are partitioned and accept inserts', async () => {
    await db.query(`insert into events (type, actor_id, payload) values ('claimed', 1, '{}')`);
    const parts = await db.query<{ n: number }>(`select count(*)::int as n from pg_inherits where inhparent = 'events'::regclass`);
    expect(parts[0]!.n).toBeGreaterThanOrEqual(3);
  });

  it('trigram search index works', async () => {
    const rows = await db.query<{ login: string }>(
      `select login from github_users where login % 'octocat' order by similarity(login, 'octocat') desc`,
    );
    expect(rows[0]?.login).toBe('Octo-Cat');
  });
});
