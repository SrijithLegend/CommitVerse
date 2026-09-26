import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '../src';

/** §9.1 RLS, exercised as Supabase's `anon` and `authenticated` roles (with Supabase's default table grants). */
let db: Db;
const uid: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`grant usage on schema public, auth to anon, authenticated;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant usage, select on all sequences in schema public to anon, authenticated;
    grant execute on all functions in schema auth to anon, authenticated;`);
  for (const [id, login] of [
    [101, 'alice'],
    [102, 'bob'],
  ] as const) {
    await db.query(`insert into github_users (github_id, login, created_at_gh) values ($1, $2, now())`, [id, login]);
    const [u] = await db.query<{ id: string }>('insert into auth.users default values returning id');
    uid[login] = u!.id;
    await db.query('insert into accounts (auth_user_id, github_id, referral_code) values ($1, $2, $3)', [u!.id, id, `r${id}`]);
    await db.query(`insert into notifications (recipient_id, type, payload) values ($1, 'signal', '{}')`, [id]);
  }
}, 60_000);
afterAll(() => db.close());

/** Runs `sql` as a Supabase role; `sub` is the JWT subject (auth.uid()). */
async function as<T>(role: 'anon' | 'authenticated', sub: string | null, sql: string): Promise<T[]> {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub ?? ''}', false);`);
  try {
    return await db.query<T>(sql);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

describe('§9.1 row level security', () => {
  it('anon sees no private rows and nothing without a policy', async () => {
    expect(await as('anon', null, 'select * from accounts')).toEqual([]);
    expect(await as('anon', null, 'select * from notifications')).toEqual([]);
    expect(await as('anon', null, 'select * from github_users')).toEqual([]);
    expect(await as('anon', null, 'select * from stardust_ledger')).toEqual([]);
  });

  it('an authenticated user reads only their own account and notifications', async () => {
    const acc = await as<{ github_id: number }>('authenticated', uid.alice!, 'select github_id from accounts');
    expect(acc.map((r) => r.github_id)).toEqual([101]);
    const n = await as<{ recipient_id: number }>('authenticated', uid.alice!, 'select recipient_id from notifications');
    expect(n.map((r) => r.recipient_id)).toEqual([101]);
  });

  it("another user's rows stay invisible, and writes without a policy are refused", async () => {
    const n = await as<{ recipient_id: number }>('authenticated', uid.bob!, 'select recipient_id from notifications');
    expect(n.map((r) => r.recipient_id)).toEqual([102]);
    await expect(
      as('authenticated', uid.alice!, `insert into stardust_ledger (github_id, delta, reason, ref_id) values (101, 1000, 'grant', 'x')`),
    ).rejects.toThrow(/row-level security/);
    await expect(as('authenticated', uid.alice!, `update accounts set stardust_balance = 1e6 where github_id = 101`)).resolves.toEqual([]);
    const [a] = await db.query<{ stardust_balance: number }>('select stardust_balance from accounts where github_id = 101');
    expect(a!.stardust_balance).toBe(0);
  });
});
