/**
 * §8.6 — the nightly bake. Computes every position and writes immutable, versioned universe tiles.
 * Deterministic: same snapshot + same params = bit-identical positions (validated by replay before going live).
 */
import { createHash } from 'node:crypto';
import { CATALOG } from '@commitverse/contracts';
import type { Db, Sql } from '@commitverse/db';
import {
  buildOctree,
  C_CAP,
  decodeTile,
  deriveStar,
  encodeIds,
  encodeTile,
  type GalaxyDef,
  galaxyParams,
  galaxyTiers,
  impactQuantiles,
  languageColor,
  type Manifest,
  type ManifestGalaxy,
  POLYGLOT,
  placeGalaxies,
  placeStarSeparatedDetailed,
  populationContext,
  quantileTable,
  quantizeLuminosity,
  quantizeRadius,
  quantizeTemperature,
  R_MAX,
  R_MIN,
  replayPlacement,
  SeparationHash,
  tilePath,
  type Vec3,
  VOID,
} from '@commitverse/universe-core';
import { starInput } from './ingest';
import { log } from './log';
import { broadcast } from './realtime';
import { emitEvent, notify } from './social';
import { getStore, IMMUTABLE, type ObjectStore, SHORT } from './storage';
import { getState, invalidateUniverseCache, setState, summaryFromManifest } from './universe';

export const BAKE_PARAMS = { R_MIN, R_MAX, C_CAP, D_MIN: 100, NODE_CAPACITY: 4096, placement: 'v1', hist: 'v1' };
export const paramsHash = (): string => createHash('sha256').update(JSON.stringify(BAKE_PARAMS)).digest('hex').slice(0, 6);
export const KEEP_VERSIONS = 7;
export const HIST_FIRST_YEAR = 2008;

const CORONA_INDEX = new Map(CATALOG.filter((i) => i.slot === 'corona').map((i, k) => [i.id, k + 1]));

export function bakeVersionFor(d: Date, hash = paramsHash()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}-${hash}`;
}

interface SnapRow {
  github_id: number;
  login: string;
  created_at_gh: Date;
  c_total: number;
  c_30: number;
  c_90: number;
  stars_total: number;
  followers: number;
  streak_current: number;
  last_active_on: string | null;
  primary_language: string;
  yearly_contrib: Record<string, number>;
  claimed: boolean;
  binary: boolean;
  online: boolean;
  corona: string | null;
  old_pct: number | null;
  old_rank: number | null;
  old_galaxy: number | null;
  old_x: number | null;
  old_y: number | null;
  old_z: number | null;
}

interface Placed {
  row: SnapRow;
  galaxy: GalaxyDef;
  pos: Vec3;
  attempts: number;
  p: number;
  rankGalaxy: number;
  rankGlobal: number;
  starIndex: number;
  derived: ReturnType<typeof deriveStar>;
}

export interface BakeResult {
  version: string;
  stats: Record<string, unknown>;
}

export class BakeValidationError extends Error {}

const SNAPSHOT_SQL = `
  select u.github_id, u.login::text as login, u.created_at_gh, m.c_total, m.c_30, m.c_90, m.stars_total, m.followers, m.streak_current,
         m.last_active_on, coalesce(m.primary_language, 'Void') as primary_language, m.yearly_contrib,
         (a.github_id is not null and a.banned_at is null) as claimed,
         exists(select 1 from bindings bd where bd.status = 'active' and (bd.a_id = u.github_id or bd.b_id = u.github_id)) as binary,
         coalesce(a.beacon_last_at > now() - interval '2 minutes' and not coalesce((a.settings->>'hideBeacon')::boolean, false), false) as online,
         (select i.item_id from equipped e join inventory i on i.id = e.inventory_id
            where e.github_id = u.github_id and e.slot = 'corona' and i.revoked_at is null) as corona,
         b.pct_galaxy as old_pct, b.rank_galaxy as old_rank, b.galaxy_id as old_galaxy, b.x as old_x, b.y as old_y, b.z as old_z
  from github_users u
  join user_metrics m using (github_id)
  left join accounts a on a.github_id = u.github_id
  left join bodies b on b.github_id = u.github_id and not b.provisional
  where not u.is_opted_out`;

function histRecord(row: SnapRow, years: number): Uint8Array {
  const out = new Uint8Array(2 + years);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, Math.max(0, Math.min(65535, Math.floor(row.created_at_gh.getTime() / 86_400_000))), true);
  let cum = 0;
  for (let i = 0; i < years; i++) {
    cum += Number(row.yearly_contrib?.[String(HIST_FIRST_YEAR + i)] ?? 0);
    out[2 + i] = Math.round(Math.min(1, Math.log10(1 + cum) / Math.log10(1 + C_CAP * 10)) * 255);
  }
  return out;
}

function encodeHist(records: Uint8Array[], years: number): Uint8Array {
  const recLen = 2 + years;
  const out = new Uint8Array(12 + records.length * recLen);
  const dv = new DataView(out.buffer);
  out.set([0x43, 0x56, 0x48, 0x31], 0); // "CVH1"
  dv.setUint16(4, HIST_FIRST_YEAR, true);
  dv.setUint16(6, years, true);
  dv.setUint32(8, records.length, true);
  records.forEach((r, i) => out.set(r, 12 + i * recLen));
  return out;
}

/** Stable galaxy ids across bakes (URLs and leaderboard scopes stay valid). */
async function stableGalaxyIds(db: Sql, languages: string[]): Promise<Map<string, number>> {
  const map = new Map(Object.entries((await getState<Record<string, number>>(db, 'galaxy_ids')) ?? {}));
  let next = Math.max(0, ...map.values()) + 1;
  for (const l of languages) if (!map.has(l)) map.set(l, next++);
  await setState(db, 'galaxy_ids', Object.fromEntries(map));
  return map;
}

export async function runBake(db: Db, opts: { now?: Date; store?: ObjectStore; triggeredBy?: string } = {}): Promise<BakeResult> {
  const now = opts.now ?? new Date();
  const store = opts.store ?? (await getStore());
  const hash = paramsHash();
  let version = bakeVersionFor(now, hash);
  const existing = new Set(
    (await db.query<{ version: string }>('select version from bake_runs where version like $1', [`${version}%`])).map((r) => r.version),
  );
  for (let k = 2; existing.has(version); k++) version = `${bakeVersionFor(now, hash)}-${k}`;
  await db.query(`insert into bake_runs (version, status, params_hash) values ($1, 'running', $2)`, [version, hash]);
  const t0 = Date.now();

  try {
    // 1. Freeze a consistent snapshot
    const rows = await db.tx(async (q) => {
      await q.query('set transaction isolation level repeatable read');
      return q.query<SnapRow>(SNAPSHOT_SQL);
    });
    if (!rows.length) throw new BakeValidationError('empty universe: nothing to bake');

    // 2. Percentiles / population context
    const nowMs = now.getTime();
    const inputs = rows.map((r) => starInput(r, r.created_at_gh, nowMs));
    const withImpact = rows.map((r, i) => {
      const d = deriveStar(inputs[i]!, { c30ActiveSorted: [], cTotalP80: 0, impactP999: 1, hypergiantImpact: Number.POSITIVE_INFINITY });
      return { c30: r.c_30, cTotal: r.c_total, impact: d.impact };
    });
    const ctx = populationContext(withImpact);
    const hyper = new Set(
      rows
        .map((r, i) => ({ id: r.github_id, impact: withImpact[i]!.impact, age: inputs[i]!.accountAgeDays }))
        .filter((x) => x.age >= 90)
        .sort((a, b) => b.impact - a.impact || a.id - b.id)
        .slice(0, 100)
        .map((x) => x.id),
    );

    // 3. Language assignment → galaxy tiers → params
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.primary_language, (counts.get(r.primary_language) ?? 0) + 1);
    const tiers = galaxyTiers(counts);

    // 4. Place galaxies
    const placedGalaxies = placeGalaxies(tiers.map((t) => galaxyParams(t.language, t.tier, t.population)));
    const ids = await stableGalaxyIds(
      db,
      placedGalaxies.map((g) => g.language),
    );
    const galaxies = placedGalaxies.map((g) => ({ ...g, id: ids.get(g.language)! }));
    const memberOf = new Map<string, GalaxyDef>();
    for (const t of tiers) {
      const g = galaxies.find((x) => x.language === t.language)!;
      for (const m of t.members) memberOf.set(m, g);
    }

    // 5–6. Rank within each galaxy → placement → derived record, dense star index
    const byGalaxy = new Map<number, number[]>();
    rows.forEach((r, i) => {
      const g = memberOf.get(r.primary_language) ?? memberOf.get(POLYGLOT) ?? memberOf.get(VOID)!;
      const list = byGalaxy.get(g.id) ?? [];
      list.push(i);
      byGalaxy.set(g.id, list);
    });
    const globalOrder = rows
      .map((_, i) => i)
      .sort((a, b) => withImpact[b]!.impact - withImpact[a]!.impact || rows[a]!.github_id - rows[b]!.github_id);
    const rankGlobal = new Int32Array(rows.length);
    globalOrder.forEach((i, k) => {
      rankGlobal[i] = k + 1;
    });

    const placed: Placed[] = [];
    const manifestGalaxies: ManifestGalaxy[] = [];
    let starIndex = 0;
    const store_: { key: string; body: Uint8Array | string; contentType: string }[] = [];
    const years = now.getUTCFullYear() - HIST_FIRST_YEAR + 1;

    for (const g of [...galaxies].sort((a, b) => a.id - b.id)) {
      const members = (byGalaxy.get(g.id) ?? []).sort(
        (a, b) => withImpact[b]!.impact - withImpact[a]!.impact || rows[a]!.github_id - rows[b]!.github_id,
      );
      const grid = new SeparationHash();
      const n = members.length;
      const galaxyPlaced: Placed[] = [];
      members.forEach((i, rank) => {
        const r = rows[i]!;
        const p = n <= 1 ? 0 : rank / n;
        const { pos, attempts } = placeStarSeparatedDetailed(p, r.github_id, g, grid);
        const derived = deriveStar(inputs[i]!, ctx, {
          claimed: r.claimed,
          binary: r.binary,
          online: r.online,
          hypergiant: hyper.has(r.github_id),
        });
        const pl: Placed = {
          row: r,
          galaxy: g,
          pos,
          attempts,
          p,
          rankGalaxy: rank + 1,
          rankGlobal: rankGlobal[i]!,
          starIndex: starIndex++,
          derived,
        };
        placed.push(pl);
        galaxyPlaced.push(pl);
      });

      // 7. Octree + tiles (positions relative to the galaxy centre)
      const pts = galaxyPlaced.map((pl) => ({
        x: pl.pos[0] - g.center[0],
        y: pl.pos[1] - g.center[1],
        z: pl.pos[2] - g.center[2],
        lq: quantizeLuminosity(pl.derived.L),
        idx: pl.starIndex,
        pl,
      }));
      const tree = buildOctree(pts);
      const nodes: ManifestGalaxy['nodes'] = [];
      for (const node of tree.values()) {
        const recs = node.points.map((pt) => ({
          x: pt.x,
          y: pt.y,
          z: pt.z,
          rq: quantizeRadius(pt.pl.derived.baseRadius),
          tq: quantizeTemperature(pt.pl.derived.T),
          lq: pt.lq,
          flags: pt.pl.derived.flags,
          cosmetic: (pt.pl.row.corona && CORONA_INDEX.get(pt.pl.row.corona)) || 0,
          starIndex: pt.pl.starIndex,
        }));
        store_.push({
          key: tilePath(version, g.id, node.key),
          body: new Uint8Array(encodeTile(recs)),
          contentType: 'application/octet-stream',
        });
        store_.push({
          key: tilePath(version, g.id, node.key, 'ids.bin'),
          body: new Uint8Array(encodeIds(node.points.map((pt) => pt.pl.row.github_id))),
          contentType: 'application/octet-stream',
        });
        store_.push({
          key: tilePath(version, g.id, node.key, 'hist.bin'),
          body: encodeHist(
            node.points.map((pt) => histRecord(pt.pl.row, years)),
            years,
          ),
          contentType: 'application/octet-stream',
        });
        nodes.push({ key: node.key, count: node.points.length, cube: node.cube });
      }
      const t = tiers.find((x) => x.language === g.language)!;
      manifestGalaxies.push({
        id: g.id,
        language: g.language,
        tier: g.tier,
        form: g.form,
        arms: g.arms,
        radius: g.radius,
        coreRadius: g.coreRadius,
        thickness: g.thickness,
        pitch: g.pitch,
        tilt: g.tilt,
        center: g.center,
        population: g.population,
        color: g.language === POLYGLOT ? '#b48cff' : g.language === VOID ? '#5b6480' : languageColor(g.language),
        members: t.members,
        nodes: nodes.sort((a, b) => a.key.length - b.key.length || (a.key < b.key ? -1 : 1)),
        quantiles: impactQuantiles(members.map((i) => withImpact[i]!.impact)),
      });
    }

    const manifest: Manifest = {
      format: 1,
      bakeVersion: version,
      createdAt: now.toISOString(),
      paramsHash: hash,
      counts: { stars: placed.length, galaxies: manifestGalaxies.length },
      impactP999: ctx.impactP999,
      cTotalP80: ctx.cTotalP80,
      hypergiantImpact: ctx.hypergiantImpact,
      c30Quantiles: quantileTable(ctx.c30ActiveSorted),
      galaxies: manifestGalaxies,
    };

    // 9. Validate BEFORE anything goes live
    validate(manifest, placed, store_, rows.length);

    // 8. Upload tiles + manifest + rollback snapshot under /u/{version}/
    const concurrency = 16;
    for (let i = 0; i < store_.length; i += concurrency) {
      await Promise.all(
        store_
          .slice(i, i + concurrency)
          .map((o) => store.put(o.key, o.body, { contentType: o.contentType, cacheControl: IMMUTABLE, brotli: true })),
      );
    }
    await store.put(`u/${version}/manifest.json`, JSON.stringify(manifest), {
      contentType: 'application/json',
      cacheControl: IMMUTABLE,
      brotli: true,
    });
    await store.put(`u/${version}/positions.bin`, encodePositions(placed), {
      contentType: 'application/octet-stream',
      cacheControl: IMMUTABLE,
      brotli: true,
    });
    await db.query(`update bake_runs set status = 'validated' where version = $1`, [version]);

    // 10. Flip to live
    await flip(db, store, manifest, placed);

    // 11. Drift notifications, reset delta
    const drifted = await driftNotifications(db, placed);
    await setState(db, 'hidden_indices', []);

    // 12. GC old versions
    const removed = await gcVersions(store, version);

    const stats = {
      stars: placed.length,
      galaxies: manifestGalaxies.length,
      tiles: store_.length / 3,
      durationMs: Date.now() - t0,
      drifted,
      removedVersions: removed,
      impactP999: ctx.impactP999,
      triggeredBy: opts.triggeredBy ?? 'schedule',
    };
    await db.query(`update bake_runs set status = 'live', finished_at = now(), stats = $2 where version = $1`, [
      version,
      JSON.stringify(stats),
    ]);
    await db.query(`update bake_runs set status = 'retired' where status = 'live' and version <> $1`, [version]);
    void broadcast('cosmic:global', 'bake', { bakeVersion: version });
    log.info({ job: 'bake', version, ...stats }, 'bake live');
    return { version, stats };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.query(`update bake_runs set status = 'failed', finished_at = now(), stats = $2 where version = $1`, [
      version,
      JSON.stringify({ error: message }),
    ]);
    log.error({ job: 'bake', version, err: message }, 'bake failed — keeping the previous version');
    await emitEvent(db, { type: 'bake_failed', payload: { version, error: message }, visibility: 'private' }).catch(() => {});
    throw err;
  }
}

function validate(manifest: Manifest, placed: Placed[], objects: { key: string; body: Uint8Array | string }[], expected: number) {
  // record counts == staging counts
  const total = manifest.galaxies.reduce((s, g) => s + g.nodes.reduce((a, n) => a + n.count, 0), 0);
  if (total !== expected || placed.length !== expected)
    throw new BakeValidationError(`count mismatch ${total}/${placed.length} vs ${expected}`);
  // no NaN anywhere
  for (const pl of placed) {
    if (
      !pl.pos.every(Number.isFinite) ||
      !Number.isFinite(pl.derived.T) ||
      !Number.isFinite(pl.derived.L) ||
      !Number.isFinite(pl.derived.radius)
    )
      throw new BakeValidationError(`non-finite star ${pl.row.github_id}`);
  }
  // AABB containment: every decoded point lies within its node's header AABB (with quantization tolerance)
  for (const o of objects) {
    if (!o.key.endsWith('.bin') || o.key.endsWith('.ids.bin') || o.key.endsWith('.hist.bin')) continue;
    const bytes = o.body as Uint8Array;
    const { header, records } = decodeTile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const b = header.aabb;
    for (const r of records)
      if (r.x < b[0] - 1e-3 || r.x > b[3] + 1e-3 || r.y < b[1] - 1e-3 || r.y > b[4] + 1e-3 || r.z < b[2] - 1e-3 || r.z > b[5] + 1e-3)
        throw new BakeValidationError(`AABB containment failed in ${o.key}`);
  }
  // 1,000 random stars re-placed and compared bit-exactly (deterministic sample)
  const sample = Math.min(1000, placed.length);
  const step = placed.length / sample;
  for (let k = 0; k < sample; k++) {
    const pl = placed[Math.floor(k * step)]!;
    const re = replayPlacement(pl.p, pl.row.github_id, pl.galaxy, pl.attempts);
    if (re[0] !== pl.pos[0] || re[1] !== pl.pos[1] || re[2] !== pl.pos[2])
      throw new BakeValidationError(`replay mismatch for ${pl.row.github_id}`);
  }
  // manifest schema check
  if (
    manifest.format !== 1 ||
    !manifest.bakeVersion ||
    !Array.isArray(manifest.galaxies) ||
    manifest.galaxies.some((g) => !g.nodes.length || g.quantiles.length !== 1000)
  )
    throw new BakeValidationError('manifest schema check failed');
}

/** Rollback snapshot: per star uint32 github_id, uint16 galaxy, uint32 star_index, float64 xyz (26 bytes). */
function encodePositions(placed: Placed[]): Uint8Array {
  const out = new Uint8Array(4 + placed.length * 34);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, placed.length, true);
  placed.forEach((pl, i) => {
    const o = 4 + i * 34;
    dv.setUint32(o, pl.row.github_id, true);
    dv.setUint16(o + 4, pl.galaxy.id, true);
    dv.setUint32(o + 6, pl.starIndex, true);
    dv.setFloat64(o + 10, pl.pos[0], true);
    dv.setFloat64(o + 18, pl.pos[1], true);
    dv.setFloat64(o + 26, pl.pos[2], true);
  });
  return out;
}

async function flip(db: Db, store: ObjectStore, manifest: Manifest, placed: Placed[]) {
  const version = manifest.bakeVersion;
  await db.tx(async (q) => {
    for (const g of manifest.galaxies) {
      await q.query(
        `insert into galaxies (id, language, tier, arms, radius, pitch, tilt, center, population, bake_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (id) do update set language = excluded.language, tier = excluded.tier, arms = excluded.arms, radius = excluded.radius,
           pitch = excluded.pitch, tilt = excluded.tilt, center = excluded.center, population = excluded.population, bake_version = excluded.bake_version`,
        [g.id, g.language, g.tier, g.arms, g.radius, g.pitch, g.tilt, g.center, g.population, version],
      );
    }
    const CHUNK = 2000;
    for (let i = 0; i < placed.length; i += CHUNK) {
      const c = placed.slice(i, i + CHUNK);
      await q.query(
        `insert into bodies (github_id, bake_version, provisional, galaxy_id, star_index, x, y, z, radius, base_radius, temperature,
           spectral_class, luminosity, impact, state, flags, rank_galaxy, rank_global, pct_galaxy, delta_at)
         select t.*, null::timestamptz from unnest($1::bigint[], $2::text[], $3::boolean[], $4::smallint[], $5::int[], $6::float8[], $7::float8[],
           $8::float8[], $9::real[], $10::real[], $11::real[], $12::char(1)[], $13::real[], $14::real[], $15::text[], $16::int[], $17::int[],
           $18::int[], $19::real[]) as t
         on conflict (github_id) do update set bake_version = excluded.bake_version, provisional = false, galaxy_id = excluded.galaxy_id,
           star_index = excluded.star_index, x = excluded.x, y = excluded.y, z = excluded.z, radius = excluded.radius,
           base_radius = excluded.base_radius, temperature = excluded.temperature, spectral_class = excluded.spectral_class,
           luminosity = excluded.luminosity, impact = excluded.impact, state = excluded.state, flags = excluded.flags,
           rank_galaxy = excluded.rank_galaxy, rank_global = excluded.rank_global, pct_galaxy = excluded.pct_galaxy, delta_at = null`,
        [
          c.map((p) => p.row.github_id),
          c.map(() => version),
          c.map(() => false),
          c.map((p) => p.galaxy.id),
          c.map((p) => p.starIndex),
          c.map((p) => p.pos[0]),
          c.map((p) => p.pos[1]),
          c.map((p) => p.pos[2]),
          c.map((p) => p.derived.radius),
          c.map((p) => p.derived.baseRadius),
          c.map((p) => p.derived.T),
          c.map((p) => p.derived.cls),
          c.map((p) => p.derived.L),
          c.map((p) => p.derived.impact),
          c.map((p) => p.derived.state),
          c.map((p) => p.derived.flags),
          c.map((p) => p.rankGalaxy),
          c.map((p) => p.rankGlobal),
          c.map((p) => p.p),
        ],
      );
      await q.query(
        `insert into rank_history (github_id, bake_version, galaxy_id, rank_galaxy, pct_galaxy)
         select * from unnest($1::bigint[], $2::text[], $3::smallint[], $4::int[], $5::real[])
         on conflict do nothing`,
        [c.map((p) => p.row.github_id), c.map(() => version), c.map((p) => p.galaxy.id), c.map((p) => p.rankGalaxy), c.map((p) => p.p)],
      );
    }
    // Stars no longer in the universe (opted out after the previous bake, or metrics missing)
    await q.query(`delete from bodies where bake_version <> $1 and not provisional`, [version]);
    // Provisional stars that arrived mid-bake get fresh indices after the dense baked range.
    await q.query(
      `with p as (select github_id, (row_number() over (order by github_id) - 1 + $1)::int as idx from bodies where provisional)
       update bodies b set star_index = p.idx, delta_at = now() from p where b.github_id = p.github_id`,
      [placed.length],
    );
    const n = (await q.query<{ n: number }>('select count(*)::int as n from bodies where provisional'))[0]!.n;
    await q.query(
      `insert into universe_state (key, value) values ('next_star_index', to_jsonb($1::bigint))
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [placed.length + n],
    );
    await q.query('delete from galaxies where id not in (select distinct galaxy_id from bodies)');
    await q.query(
      `insert into universe_state (key, value, updated_at) values ('current', $1, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [JSON.stringify(summaryFromManifest(manifest))],
    );
  });
  await store.put('u/current.json', JSON.stringify({ bakeVersion: version }), { contentType: 'application/json', cacheControl: SHORT });
  invalidateUniverseCache();
}

async function driftNotifications(db: Db, placed: Placed[]): Promise<number> {
  let n = 0;
  for (const pl of placed) {
    const r = pl.row;
    if (!r.claimed || r.old_pct === null || r.old_rank === null || r.old_x === null) continue;
    if (Math.abs(pl.p - r.old_pct) < 0.01) continue;
    const dist = Math.hypot(pl.pos[0] - r.old_x, pl.pos[1] - (r.old_y ?? 0), pl.pos[2] - (r.old_z ?? 0));
    const inward = pl.p < r.old_pct;
    const payload = {
      distance: Math.round(dist),
      direction: inward ? 'toward' : 'away from',
      galaxy: pl.galaxy.language,
      fromRank: r.old_rank,
      toRank: pl.rankGalaxy,
      from: [r.old_x, r.old_y, r.old_z],
      to: pl.pos,
      message: `Your star drifted ${Math.round(dist).toLocaleString('en-US')} ly ${inward ? 'toward' : 'away from'} the ${pl.galaxy.language} core (rank ${r.old_rank.toLocaleString('en-US')} → ${pl.rankGalaxy.toLocaleString('en-US')}).`,
    };
    await notify(db, r.github_id, 'drift', payload);
    n++;
  }
  return n;
}

export async function gcVersions(store: ObjectStore, current: string): Promise<number> {
  const versions = (await store.listPrefixes('u/'))
    .map((p) => p.slice(2, -1))
    .filter((v) => v !== 'live' && /^\d{8}-\d{4}-/.test(v))
    .sort()
    .reverse();
  const keep = new Set([current, ...versions.slice(0, KEEP_VERSIONS)]);
  let removed = 0;
  for (const v of versions) {
    if (keep.has(v)) continue;
    await store.deletePrefix(`u/${v}/`);
    removed++;
  }
  return removed;
}

/** Admin rollback: repoint the manifest to a retained version and restore its positions (tiles are immutable). */
export async function rollbackTo(db: Db, version: string, store?: ObjectStore): Promise<void> {
  const s = store ?? (await getStore());
  const manifestBytes = await s.get(`u/${version}/manifest.json`);
  const positions = await s.get(`u/${version}/positions.bin`);
  if (!manifestBytes || !positions) throw new Error(`version ${version} is not retained`);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest;
  const dv = new DataView(positions.buffer, positions.byteOffset, positions.byteLength);
  const n = dv.getUint32(0, true);
  await db.tx(async (q) => {
    for (const g of manifest.galaxies) {
      await q.query(
        `insert into galaxies (id, language, tier, arms, radius, pitch, tilt, center, population, bake_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (id) do update set language = excluded.language, tier = excluded.tier, arms = excluded.arms, radius = excluded.radius,
           pitch = excluded.pitch, tilt = excluded.tilt, center = excluded.center, population = excluded.population, bake_version = excluded.bake_version`,
        [g.id, g.language, g.tier, g.arms, g.radius, g.pitch, g.tilt, g.center, g.population, version],
      );
    }
    for (let i = 0; i < n; i += 2000) {
      const ids: number[] = [];
      const gal: number[] = [];
      const idx: number[] = [];
      const xs: number[] = [];
      const ys: number[] = [];
      const zs: number[] = [];
      for (let k = i; k < Math.min(n, i + 2000); k++) {
        const o = 4 + k * 34;
        ids.push(dv.getUint32(o, true));
        gal.push(dv.getUint16(o + 4, true));
        idx.push(dv.getUint32(o + 6, true));
        xs.push(dv.getFloat64(o + 10, true));
        ys.push(dv.getFloat64(o + 18, true));
        zs.push(dv.getFloat64(o + 26, true));
      }
      await q.query(
        `update bodies b set galaxy_id = t.g, star_index = t.i, x = t.x, y = t.y, z = t.z, bake_version = $7, provisional = false
         from unnest($1::bigint[], $2::smallint[], $3::int[], $4::float8[], $5::float8[], $6::float8[]) as t(id, g, i, x, y, z)
         where b.github_id = t.id`,
        [ids, gal, idx, xs, ys, zs, version],
      );
    }
    await q.query(
      `insert into universe_state (key, value, updated_at) values ('current', $1, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [JSON.stringify(summaryFromManifest(manifest))],
    );
    await q.query(`update bake_runs set status = case when version = $1 then 'live' when status = 'live' then 'retired' else status end`, [
      version,
    ]);
  });
  await s.put('u/current.json', JSON.stringify({ bakeVersion: version }), { contentType: 'application/json', cacheControl: SHORT });
  invalidateUniverseCache();
  void broadcast('cosmic:global', 'bake', { bakeVersion: version });
}
