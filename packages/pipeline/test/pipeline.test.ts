import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, type Db } from '@commitverse/db';
import { decodeTile, type Manifest, tilePath } from '@commitverse/universe-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildDelta,
  buildStarFetchQuery,
  createLocalQueue,
  createLocalStore,
  cronMatches,
  decodeDelta,
  gcVersions,
  ingestUser,
  type ObjectStore,
  parseStarFetch,
  rollbackTo,
  runAchievements,
  runBake,
  seedSynthetic,
  syncAchievementCatalog,
  syntheticUser,
  yearRanges,
} from '../src';
import type { RawStarFetch } from '../src/starfetch';

let db: Db;
let store: ObjectStore;
let dir: string;

beforeAll(async () => {
  db = await createTestDb();
  dir = mkdtempSync(join(tmpdir(), 'cv-tiles-'));
  store = createLocalStore(dir);
  await syncAchievementCatalog(db);
}, 120_000);
afterAll(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

const readJson = async <T>(key: string) => JSON.parse(new TextDecoder().decode((await store.get(key))!)) as T;

function fixture(overrides: { stars?: number; followers?: number; c2026?: number } = {}): RawStarFetch {
  const days = Array.from({ length: 7 * 52 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 8, 24) - (363 - i) * 86_400_000).toISOString().slice(0, 10),
    contributionCount: i > 320 ? 3 : i % 3 === 0 ? 1 : 0,
  }));
  return {
    user: {
      databaseId: 58213377,
      login: 'nova-dev',
      name: 'Nova Dev',
      avatarUrl: 'https://avatars.githubusercontent.com/u/58213377',
      bio: 'hi',
      createdAt: '2019-03-01T10:00:00Z',
      followers: { totalCount: overrides.followers ?? 312 },
      following: { totalCount: 10 },
      organizations: { nodes: [{ databaseId: 777, login: 'nova-org', name: 'Nova Org', avatarUrl: null }] },
      pinnedItems: { nodes: [{ databaseId: 2 }] },
      repositories: {
        totalCount: 27,
        nodes: [
          {
            databaseId: 1,
            name: 'tiny-llm',
            description: 'x',
            stargazerCount: overrides.stars ?? 900,
            forkCount: 212,
            isArchived: false,
            pushedAt: '2026-09-20T00:00:00Z',
            createdAt: '2025-12-01T00:00:00Z',
            primaryLanguage: { name: 'Python', color: '#3572A5' },
            releases: { totalCount: 9 },
            languages: { edges: [{ size: 90000, node: { name: 'Python', color: '#3572A5' } }] },
          },
          {
            databaseId: 2,
            name: 'dotfiles',
            description: null,
            stargazerCount: 3,
            forkCount: 0,
            isArchived: true,
            pushedAt: '2020-01-01T00:00:00Z',
            createdAt: '2019-04-01T00:00:00Z',
            primaryLanguage: { name: 'Shell', color: '#89e051' },
            releases: { totalCount: 0 },
            languages: { edges: [{ size: 1000, node: { name: 'Shell', color: '#89e051' } }] },
          },
        ],
      },
      y2019: { contributionCalendar: { totalContributions: 100 }, restrictedContributionsCount: 0 },
      y2020: { contributionCalendar: { totalContributions: 400 }, restrictedContributionsCount: 0 },
      y2026: { contributionCalendar: { totalContributions: overrides.c2026 ?? 450 }, restrictedContributionsCount: 12 },
      last365: { contributionCalendar: { totalContributions: 200, weeks: [{ contributionDays: days }] } },
    },
  } as unknown as RawStarFetch;
}

describe('§8.3 StarFetch', () => {
  it('builds one alias per year and the parser sums them', () => {
    const q = buildStarFetchQuery('2019-03-01T10:00:00Z', new Date('2026-09-24T12:00:00Z'));
    expect(yearRanges('2019-03-01T10:00:00Z', new Date('2026-09-24T12:00:00Z'))).toHaveLength(8);
    expect(q).toContain('y2019: contributionsCollection(from: "2019-01-01T00:00:00Z", to: "2019-12-31T23:59:59Z")');
    expect(q).toContain('y2026: contributionsCollection(from: "2026-01-01T00:00:00Z", to: "2026-09-24T12:00:00Z")');
    const f = parseStarFetch(fixture())!;
    expect(Object.values(f.yearly).reduce((a, b) => a + b, 0)).toBe(950);
    expect(f.pinnedRepoIds).toEqual([2]);
    expect(parseStarFetch({ user: null })).toBeNull();
  });
});

describe('pipeline end-to-end (local mode)', () => {
  let manifest: Manifest;

  it('seeds a synthetic universe deterministically', async () => {
    expect(syntheticUser(5, 42, 1e12)).toEqual(syntheticUser(5, 42, 1e12));
    await seedSynthetic(db, { count: 6000, seed: 42, orgs: 20 });
    const [{ n }] = (await db.query<{ n: number }>('select count(*)::int as n from github_users where synthetic')) as [{ n: number }];
    expect(n).toBe(6000);
  }, 120_000);

  it('bakes, validates and publishes tiles + manifest', async () => {
    const { version, stats } = await runBake(db, { store, now: new Date('2026-09-25T02:00:00Z') });
    expect(version).toMatch(/^20260925-0200-[0-9a-f]{6}$/);
    expect(stats.stars).toBe(6000);
    manifest = await readJson<Manifest>(`u/${version}/manifest.json`);
    expect((await readJson<{ bakeVersion: string }>('u/current.json')).bakeVersion).toBe(version);
    const total = manifest.galaxies.reduce((s, g) => s + g.nodes.reduce((a, n) => a + n.count, 0), 0);
    expect(total).toBe(6000);
    const g = manifest.galaxies[0]!;
    const bytes = (await store.get(tilePath(version, g.id, 'r')))!;
    const { records } = decodeTile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(records.length).toBeGreaterThan(0);
    const [{ n }] = (await db.query<{ n: number }>(`select count(*)::int as n from bodies where bake_version = $1`, [version])) as [
      { n: number },
    ];
    expect(n).toBe(6000);
    expect(manifest.galaxies.some((x) => x.language === 'Polyglot')).toBe(true);
    expect(manifest.galaxies.filter((x) => x.tier === 'major')).toHaveLength(12);
  }, 120_000);

  it('re-baking the same snapshot gives bit-identical positions', async () => {
    const before = await db.query<{ github_id: number; x: number; y: number; z: number }>(
      'select github_id, x, y, z from bodies order by github_id',
    );
    await runBake(db, { store, now: new Date('2026-09-25T02:00:00Z') });
    const after = await db.query<{ github_id: number; x: number; y: number; z: number }>(
      'select github_id, x, y, z from bodies order by github_id',
    );
    expect(after).toEqual(before);
  }, 120_000);

  it('ingests a real-shaped user with a provisional placement, then fires a supernova on a milestone crossing', async () => {
    const f = parseStarFetch(fixture())!;
    const first = await ingestUser(db, f, new Date('2026-09-24T12:00:00Z'));
    expect(first.placed).toBe(true);
    expect(first.milestones).toEqual([]);
    const [body] = await db.query<{ provisional: boolean; galaxy_id: number; delta_at: Date | null }>(
      'select provisional, galaxy_id, delta_at from bodies where github_id = 58213377',
    );
    expect(body!.provisional).toBe(true);
    expect(body!.delta_at).not.toBeNull();
    const pyGalaxy = manifest.galaxies.find((g) => g.members.includes('Python'))!;
    expect(body!.galaxy_id).toBe(pyGalaxy.id);
    const planets = await db.query<{ name: string; planet_slot: number | null }>(
      'select name, planet_slot from repos where owner_id = 58213377 order by planet_slot',
    );
    expect(planets.map((p) => p.planet_slot)).toEqual([0, 1]);

    const second = await ingestUser(db, parseStarFetch(fixture({ stars: 1200, c2026: 600 }))!, new Date('2026-09-24T13:00:00Z'));
    expect(second.milestones.map((m) => `${m.kind}:${m.threshold}`).sort()).toEqual([
      'c_total:1000',
      'repo_stars:1000',
      'stars_total:1000',
    ]);
    const events = await db.query<{ type: string }>(`select type from events where actor_id = 58213377 and type = 'supernova'`);
    expect(events).toHaveLength(3);
  }, 60_000);

  it('grants achievements exactly once', async () => {
    const first = await runAchievements(db, 58213377);
    expect(first).toContain('stellar_mass');
    expect(first).toContain('gas_giant');
    expect(first).toContain('supernova');
    expect(await runAchievements(db, 58213377)).toEqual([]);
  });

  it('builds the delta layer with the provisional star', async () => {
    const r = await buildDelta(db, store);
    expect(r.count).toBe(1);
    const bytes = (await store.get('u/live/delta.bin'))!;
    const d = decodeDelta(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(d.groups).toHaveLength(1);
    expect(Array.from(d.groups[0]!.ids)).toEqual([58213377]);
  });

  it('the next bake absorbs provisional stars; rollback restores the previous version', async () => {
    const prev = (await readJson<{ bakeVersion: string }>('u/current.json')).bakeVersion;
    const { version } = await runBake(db, { store, now: new Date('2026-09-26T02:00:00Z') });
    const [b] = await db.query<{ provisional: boolean; bake_version: string }>(
      'select provisional, bake_version from bodies where github_id = 58213377',
    );
    expect(b).toEqual({ provisional: false, bake_version: version });
    await rollbackTo(db, prev, store);
    expect((await readJson<{ bakeVersion: string }>('u/current.json')).bakeVersion).toBe(prev);
    const [live] = await db.query<{ version: string }>(`select version from bake_runs where status = 'live'`);
    expect(live!.version).toBe(prev);
  }, 120_000);

  it('garbage-collects all but the last 7 versions', async () => {
    for (let i = 0; i < 9; i++)
      await store.put(`u/2026010${i}-0200-aaaaaa/manifest.json`, '{}', { contentType: 'application/json', cacheControl: 'x' });
    await gcVersions(store, '20260101-0200-aaaaaa');
    const left = await store.listPrefixes('u/');
    expect(left.filter((p) => /^u\/\d{8}/.test(p)).length).toBeLessThanOrEqual(8);
    expect(left).toContain('u/20260101-0200-aaaaaa/');
  });
});

describe('local queue', () => {
  it('cron matcher', () => {
    const d = new Date('2026-09-25T02:00:00Z');
    expect(cronMatches('0 2 * * *', d)).toBe(true);
    expect(cronMatches('*/5 * * * *', d)).toBe(true);
    expect(cronMatches('15 * * * *', d)).toBe(false);
    expect(cronMatches('0 1-3 * * 5', d)).toBe(true);
  });
  it('priority, singleton keys and retries', async () => {
    const q = createLocalQueue();
    const seen: number[] = [];
    let fails = 0;
    await q.send('notify', { n: 1 }, { priority: 1 });
    await q.send('notify', { n: 2 }, { priority: 99, singletonKey: 'k' });
    expect(await q.send('notify', { n: 3 }, { singletonKey: 'k' })).toBeNull();
    await q.work('notify', async (d) => {
      if (d.n === 1 && fails++ === 0) throw new Error('flaky');
      seen.push(Number(d.n));
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(seen[0]).toBe(2);
    await q.stop();
  });
});
