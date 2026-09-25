/**
 * Synthetic universe (§13.3 staging "synthetic 1M-star universe", and the zero-config local demo).
 * Synthetic stars are flagged `synthetic`, never fetched from GitHub, and use ids ≥ 3,000,000,000 (no collision
 * with real GitHub ids, still uint32). Their repos and calendars are derived deterministically on read.
 */
import type { Db } from '@commitverse/db';
import { gaussian, hash32, languageColor, mulberry32 } from '@commitverse/universe-core';
import { log } from './log';

export const SYNTHETIC_ID_BASE = 3_000_000_000;

const LANGS: [string, number][] = [
  ['JavaScript', 17],
  ['Python', 17],
  ['TypeScript', 14],
  ['Java', 7],
  ['Go', 5],
  ['C++', 4.5],
  ['C#', 4.5],
  ['Rust', 4],
  ['PHP', 3.5],
  ['Ruby', 2.5],
  ['C', 2.5],
  ['Kotlin', 2],
  ['Swift', 1.8],
  ['Dart', 1.4],
  ['Shell', 1.3],
  ['Scala', 0.8],
  ['Lua', 0.7],
  ['R', 0.7],
  ['Elixir', 0.5],
  ['Haskell', 0.45],
  ['Zig', 0.35],
  ['Julia', 0.3],
  ['OCaml', 0.2],
  ['Clojure', 0.2],
  ['Nim', 0.12],
  ['Crystal', 0.1],
  ['Gleam', 0.08],
  ['Erlang', 0.1],
  ['F#', 0.1],
  ['Vue', 0.6],
  ['Svelte', 0.3],
  ['Jupyter Notebook', 0.9],
  ['HTML', 1.2],
  ['CSS', 0.6],
];
const POLYGLOT_SHARE = 0.07;
const VOID_SHARE = 0.03;

const ADJ =
  'amber arcane astral bright cosmic crimson dark distant dusky electric ember fading faint frozen gentle golden hollow hyper icy iron lucid lunar molten neon nova obsidian orbital pale polar quantum quiet radiant red rogue rusty sable silent silver solar spectral stellar swift tidal ultra velvet violet void wandering warm wild'.split(
    ' ',
  );
const NOUN =
  'anvil apex arc atlas beacon bolt comet core crane delta drift echo ember falcon flare forge fox gale ghost glyph harbor helix heron ion jet kite lance lark lynx maple meteor moth nebula oak orbit otter owl photon pike pulsar quasar raven reef rune sparrow spire tern vector vertex warp wolf wren zenith'.split(
    ' ',
  );
const FIRST =
  'Ada Alan Amara Arjun Aya Bea Bruno Chen Dara Diego Eli Emi Farah Felix Gia Hana Ilya Iris Jae Jonas Kai Kavya Lena Leo Luca Maya Mei Milo Nadia Noor Omar Otto Priya Quinn Rafa Rin Sana Sami Tariq Tess Uma Vera Wen Xin Yara Yusuf Zoe'.split(
    ' ',
  );
const LAST =
  'Abe Adeyemi Bauer Costa Das Duarte Eriksen Fischer Garcia Hale Ito Jensen Kaur Kim Kowalski Lee Lima Moreau Nakamura Novak Okafor Park Patel Petrov Quispe Rossi Sato Silva Singh Suzuki Tanaka Torres Ueda Varga Wang Weber Xu Yilmaz Zhang'.split(
    ' ',
  );
const REPO_A = 'tiny fast micro hyper open neo lazy async smart deep bare quick safe zero pure'.split(' ');
const REPO_B = 'llm cache router parser queue store engine kit graph shell db lint vm http orm ui sdk cli bot'.split(' ');

function pickWeighted(r: number, list: [string, number][]): string {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [k, w] of list) {
    x -= w;
    if (x <= 0) return k;
  }
  return list[list.length - 1]![0];
}

const logNormal = (rng: () => number, mu: number, sigma: number) => Math.exp(mu + sigma * gaussian(rng));

export interface SyntheticUser {
  githubId: number;
  login: string;
  name: string;
  createdAt: string;
  cTotal: number;
  c30: number;
  c90: number;
  c365: number;
  streakCurrent: number;
  streakLongest: number;
  lastActiveOn: string | null;
  starsTotal: number;
  forksTotal: number;
  followers: number;
  following: number;
  reposPublic: number;
  langWeights: Record<string, number>;
  primaryLanguage: string;
  yearly: Record<string, number>;
}

export function syntheticUser(i: number, seed: number, now = Date.now()): SyntheticUser {
  const rng = mulberry32(hash32(i) ^ seed);
  const githubId = SYNTHETIC_ID_BASE + i;
  const ageDays = Math.floor(30 + rng() ** 0.8 * 6200);
  const createdAt = new Date(now - ageDays * 86_400_000);
  const newbie = rng() < 0.06;
  const cTotal = newbie ? Math.floor(rng() * 10) : Math.min(150_000, Math.round(logNormal(rng, Math.log(350), 1.55)));
  const active = rng() < 0.58 && cTotal > 0;
  const c30 = active ? Math.min(cTotal, Math.max(1, Math.round(logNormal(rng, Math.log(18), 1.15)))) : 0;
  const quietGiant = !active && rng() < 0.4;
  const c90 = quietGiant ? 0 : Math.min(cTotal, c30 + Math.round(c30 * (1.5 + rng() * 2)) + (active ? 0 : Math.round(rng() * 20)));
  const c365 = Math.min(cTotal, c90 + Math.round(c90 * (2 + rng() * 2.5)));
  const streakCurrent = active ? Math.min(365, Math.round(-Math.log(1 - rng() * 0.999) * (c30 > 40 ? 22 : 4))) : 0;
  const lastActiveDays = active ? Math.floor(rng() * 3) : quietGiant ? 120 + Math.floor(rng() * 900) : 30 + Math.floor(rng() * 1500);
  const starsTotal = Math.min(400_000, Math.floor(logNormal(rng, Math.log(6), 2.1)));
  const followers = Math.min(250_000, Math.floor(logNormal(rng, Math.log(12 + starsTotal * 0.05), 1.3)));
  const reposPublic = Math.max(1, Math.min(900, Math.round(logNormal(rng, Math.log(18), 1.0))));
  const u = rng();
  const primary = u < VOID_SHARE ? 'Void' : u < VOID_SHARE + POLYGLOT_SHARE ? 'Polyglot' : pickWeighted(rng(), LANGS);
  const langWeights: Record<string, number> = {};
  if (primary === 'Polyglot') {
    for (let k = 0; k < 4; k++) langWeights[pickWeighted(rng(), LANGS)] = 0.2 + rng() * 0.1;
  } else if (primary !== 'Void') {
    langWeights[primary] = 0.55 + rng() * 0.4;
    const second = pickWeighted(rng(), LANGS);
    if (second !== primary) langWeights[second] = 1 - langWeights[primary]!;
  }
  const sum = Object.values(langWeights).reduce((s, v) => s + v, 0) || 1;
  for (const k of Object.keys(langWeights)) langWeights[k] = langWeights[k]! / sum;
  const yearly: Record<string, number> = {};
  const y0 = createdAt.getUTCFullYear();
  const y1 = new Date(now).getUTCFullYear();
  let remaining = cTotal - c365;
  for (let y = y0; y < y1; y++) {
    const share = y === y1 - 1 ? remaining : Math.round(remaining * (0.1 + rng() * 0.3));
    yearly[String(y)] = Math.max(0, share);
    remaining -= Math.max(0, share);
  }
  yearly[String(y1)] = (yearly[String(y1)] ?? 0) + c365 + Math.max(0, remaining);
  const adj = ADJ[Math.floor(rng() * ADJ.length)]!;
  const noun = NOUN[Math.floor(rng() * NOUN.length)]!;
  return {
    githubId,
    login: `${adj}-${noun}-${i.toString(36)}`,
    name: `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`,
    createdAt: createdAt.toISOString(),
    cTotal,
    c30,
    c90,
    c365,
    streakCurrent,
    streakLongest: Math.max(streakCurrent, Math.round(streakCurrent * (1 + rng()))),
    lastActiveOn: cTotal > 0 ? new Date(now - lastActiveDays * 86_400_000).toISOString().slice(0, 10) : null,
    starsTotal,
    forksTotal: Math.floor(starsTotal * (0.05 + rng() * 0.2)),
    followers,
    following: Math.floor(rng() * 200),
    reposPublic,
    langWeights,
    primaryLanguage: primary,
    yearly,
  };
}

/** Deterministic planets for a synthetic star (no rows stored). */
export function syntheticRepos(
  githubId: number,
  starsTotal: number,
  reposPublic: number,
  langWeights: Record<string, number>,
  now = Date.now(),
) {
  const rng = mulberry32(hash32(githubId) ^ 0x5eed);
  const langs = Object.keys(langWeights);
  const n = Math.min(8, reposPublic);
  let left = starsTotal;
  return Array.from({ length: n }, (_, k) => {
    const share = k === n - 1 ? left : Math.floor(left * (0.45 + rng() * 0.3));
    left -= share;
    const language = langs.length ? langs[Math.floor(rng() * langs.length)]! : null;
    const pushedDays = Math.floor(rng() ** 2 * 900);
    return {
      repoId: (githubId % 1_000_000) * 16 + k + 4_000_000_000,
      name: `${REPO_A[Math.floor(rng() * REPO_A.length)]}-${REPO_B[Math.floor(rng() * REPO_B.length)]}`,
      description: null,
      stars: share,
      forks: Math.floor(share * (0.05 + rng() * 0.25)),
      releases: rng() < 0.4 ? Math.floor(rng() * 40) : 0,
      pushedAt: new Date(now - pushedDays * 86_400_000).toISOString(),
      createdAt: new Date(now - (pushedDays + 30 + Math.floor(rng() * 2000)) * 86_400_000).toISOString(),
      isArchived: rng() < 0.05,
      language,
      languageColor: languageColor(language),
    };
  });
}

/** Deterministic 364-day calendar consistent with c_30 / c_90 / c_365 / streak. */
export function syntheticCalendar(githubId: number, m: { c30: number; c90: number; c365: number; streakCurrent: number }): number[] {
  const rng = mulberry32(hash32(githubId) ^ 0xca1);
  const out = new Array<number>(364).fill(0);
  const spread = (from: number, to: number, total: number) => {
    const days = to - from;
    for (let k = 0; k < total; k++) {
      const d = from + Math.floor(rng() * days);
      out[363 - d] = (out[363 - d] ?? 0) + 1;
    }
  };
  spread(0, 30, m.c30);
  spread(30, 90, Math.max(0, m.c90 - m.c30));
  spread(90, 364, Math.max(0, m.c365 - m.c90));
  for (let d = 0; d < Math.min(364, m.streakCurrent); d++) if (out[363 - d] === 0) out[363 - d] = 1;
  return out;
}

export async function seedSynthetic(db: Db, opts: { count: number; seed?: number; orgs?: number }): Promise<number> {
  const seed = opts.seed ?? 42;
  const now = Date.now();
  const CHUNK = 5000;
  const existing = (await db.query<{ n: number }>('select count(*)::int as n from github_users where synthetic'))[0]!.n;
  for (let start = existing; start < opts.count; start += CHUNK) {
    const users = Array.from({ length: Math.min(CHUNK, opts.count - start) }, (_, k) => syntheticUser(start + k, seed, now));
    await db.query(
      `insert into github_users (github_id, login, name, avatar_url, created_at_gh, synthetic, last_fetched_at, next_refresh_at, refresh_tier)
       select id, login, name, null, created, true, now(), 'infinity', 4
       from unnest($1::bigint[], $2::text[], $3::text[], $4::timestamptz[]) as t(id, login, name, created)
       on conflict do nothing`,
      [users.map((u) => u.githubId), users.map((u) => u.login), users.map((u) => u.name), users.map((u) => u.createdAt)],
    );
    await db.query(
      `insert into user_metrics (github_id, c_total, c_30, c_90, c_365, streak_current, streak_longest, last_active_on, stars_total,
         forks_total, followers, following, repos_public, lang_weights, primary_language, yearly_contrib)
       select * from unnest($1::bigint[], $2::int[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[], $8::date[], $9::int[],
         $10::int[], $11::int[], $12::int[], $13::int[], $14::jsonb[], $15::text[], $16::jsonb[])
       on conflict do nothing`,
      [
        users.map((u) => u.githubId),
        users.map((u) => u.cTotal),
        users.map((u) => u.c30),
        users.map((u) => u.c90),
        users.map((u) => u.c365),
        users.map((u) => u.streakCurrent),
        users.map((u) => u.streakLongest),
        users.map((u) => u.lastActiveOn),
        users.map((u) => u.starsTotal),
        users.map((u) => u.forksTotal),
        users.map((u) => u.followers),
        users.map((u) => u.following),
        users.map((u) => u.reposPublic),
        users.map((u) => JSON.stringify(u.langWeights)),
        users.map((u) => u.primaryLanguage),
        users.map((u) => JSON.stringify(u.yearly)),
      ],
    );
    log.info({ job: 'seed', done: start + users.length, of: opts.count }, 'synthetic stars');
  }

  // Constellations: synthetic orgs whose members skew toward one language
  const orgCount = opts.orgs ?? Math.max(10, Math.floor(opts.count / 150));
  const rng = mulberry32(seed ^ 0x0e9);
  for (let k = 0; k < orgCount; k++) {
    const id = SYNTHETIC_ID_BASE + 900_000_000 + k;
    const login = `${NOUN[Math.floor(rng() * NOUN.length)]}-${REPO_B[Math.floor(rng() * REPO_B.length)]}-labs-${k.toString(36)}`;
    await db.query('insert into orgs (github_org_id, login, name) values ($1, $2, $3) on conflict do nothing', [
      id,
      login,
      login.replace(/-/g, ' '),
    ]);
    const size = 3 + Math.floor(rng() ** 2 * 60);
    const members = Array.from({ length: size }, () => SYNTHETIC_ID_BASE + Math.floor(rng() * opts.count));
    await db.query(
      `insert into org_members (org_id, github_id) select $1, m from unnest($2::bigint[]) m
       where exists (select 1 from github_users where github_id = m) on conflict do nothing`,
      [id, members],
    );
  }
  return opts.count;
}
