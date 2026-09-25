/** §8.3 — the StarFetch GraphQL query (one per user; yearly contributions via aliases) + parser. */
import { type CalendarDay, calendarMetrics, languageColor, languageWeights, primaryLanguage } from '@commitverse/universe-core';

export const PROBE_QUERY = `query StarProbe($login: String!) {
  rateLimit { cost remaining resetAt limit }
  repositoryOwner(login: $login) { __typename login ... on User { databaseId createdAt } ... on Organization { databaseId name avatarUrl } }
}`;

export interface ProbeResult {
  rateLimit?: unknown;
  repositoryOwner: {
    __typename: 'User' | 'Organization';
    login: string;
    databaseId?: number;
    createdAt?: string;
    name?: string;
    avatarUrl?: string;
  } | null;
}

/** Years from createdAt.year .. now.year → aliases y2019 … y2026. The last year runs to `now`. */
export function yearRanges(createdAt: string, now = new Date()): { alias: string; from: string; to: string }[] {
  const start = new Date(createdAt).getUTCFullYear();
  const end = now.getUTCFullYear();
  const out: { alias: string; from: string; to: string }[] = [];
  for (let y = Math.max(2008, start); y <= end; y++) {
    out.push({
      alias: `y${y}`,
      from: `${y}-01-01T00:00:00Z`,
      to: y === end ? now.toISOString().replace(/\.\d{3}Z$/, 'Z') : `${y}-12-31T23:59:59Z`,
    });
  }
  return out;
}

export function buildStarFetchQuery(createdAt: string, now = new Date()): string {
  const years = yearRanges(createdAt, now)
    .map(
      (r) => `    ${r.alias}: contributionsCollection(from: "${r.from}", to: "${r.to}") {
      contributionCalendar { totalContributions }
      restrictedContributionsCount
    }`,
    )
    .join('\n');
  return `query StarFetch($login: String!) {
  rateLimit { cost remaining resetAt limit }
  user(login: $login) {
    databaseId login name avatarUrl bio createdAt
    followers { totalCount }
    following { totalCount }
    organizations(first: 20) { nodes { databaseId login name avatarUrl } }
    pinnedItems(first: 6, types: REPOSITORY) { nodes { ... on Repository { databaseId } } }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC,
                 orderBy: { field: STARGAZERS, direction: DESC }) {
      totalCount
      nodes {
        databaseId name description stargazerCount forkCount isArchived pushedAt createdAt
        primaryLanguage { name color }
        releases { totalCount }
        languages(first: 5, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
      }
    }
${years}
    last365: contributionsCollection {
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
  }
}`;
}

// ─── Raw response types ──────────────────────────────────────────────────

interface RawRepo {
  databaseId: number;
  name: string;
  description: string | null;
  stargazerCount: number;
  forkCount: number;
  isArchived: boolean;
  pushedAt: string | null;
  createdAt: string | null;
  primaryLanguage: { name: string; color: string | null } | null;
  releases: { totalCount: number };
  languages: { edges: { size: number; node: { name: string; color: string | null } }[] };
}

export interface RawStarFetch {
  user:
    | ({
        databaseId: number;
        login: string;
        name: string | null;
        avatarUrl: string | null;
        bio: string | null;
        createdAt: string;
        followers: { totalCount: number };
        following: { totalCount: number };
        organizations: { nodes: { databaseId: number; login: string; name: string | null; avatarUrl: string | null }[] };
        pinnedItems: { nodes: ({ databaseId?: number } | null)[] };
        repositories: { totalCount: number; nodes: RawRepo[] };
        last365: {
          contributionCalendar: {
            totalContributions: number;
            weeks: { contributionDays: { date: string; contributionCount: number }[] }[];
          };
        };
      } & Record<string, unknown>)
    | null;
}

// ─── Normalized ──────────────────────────────────────────────────────────

export interface FetchedRepo {
  repoId: number;
  name: string;
  description: string | null;
  stars: number;
  forks: number;
  releases: number;
  pushedAt: string | null;
  createdAt: string | null;
  isArchived: boolean;
  language: string | null;
  languageColor: string;
  languages: { name: string; size: number }[];
}

export interface FetchedUser {
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string;
  followers: number;
  following: number;
  orgs: { githubId: number; login: string; name: string | null; avatarUrl: string | null }[];
  pinnedRepoIds: number[];
  repos: FetchedRepo[];
  reposTotal: number;
  yearly: Record<string, number>;
  calendar: CalendarDay[];
}

export function parseStarFetch(raw: RawStarFetch): FetchedUser | null {
  const u = raw.user;
  if (!u) return null;
  const yearly: Record<string, number> = {};
  for (const [k, v] of Object.entries(u)) {
    const m = /^y(\d{4})$/.exec(k);
    if (m && v && typeof v === 'object') {
      // c_total semantics: contributionCalendar.totalContributions already includes private (restricted)
      // contributions when — and only when — the user enabled "show private contributions". We therefore
      // never add restrictedContributionsCount on top (it would double count). See §8.3.
      yearly[m[1]!] = (v as { contributionCalendar: { totalContributions: number } }).contributionCalendar.totalContributions;
    }
  }
  const calendar: CalendarDay[] = u.last365.contributionCalendar.weeks.flatMap((w) =>
    w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })),
  );
  return {
    githubId: u.databaseId,
    login: u.login,
    name: u.name,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    createdAt: u.createdAt,
    followers: u.followers.totalCount,
    following: u.following.totalCount,
    orgs: u.organizations.nodes
      .filter(Boolean)
      .map((o) => ({ githubId: o.databaseId, login: o.login, name: o.name, avatarUrl: o.avatarUrl })),
    pinnedRepoIds: u.pinnedItems.nodes.map((n) => n?.databaseId).filter((x): x is number => typeof x === 'number'),
    repos: u.repositories.nodes.map((r) => ({
      repoId: r.databaseId,
      name: r.name,
      description: r.description,
      stars: r.stargazerCount,
      forks: r.forkCount,
      releases: r.releases.totalCount,
      pushedAt: r.pushedAt,
      createdAt: r.createdAt,
      isArchived: r.isArchived,
      language: r.primaryLanguage?.name ?? null,
      languageColor: r.primaryLanguage?.color ?? languageColor(r.primaryLanguage?.name),
      languages: r.languages.edges.map((e) => ({ name: e.node.name, size: e.size })),
    })),
    reposTotal: u.repositories.totalCount,
    yearly,
    calendar,
  };
}

export interface ComputedMetrics {
  cTotal: number;
  c30: number;
  c90: number;
  c365: number;
  streakCurrent: number;
  streakLongest: number;
  lastActiveOn: string | null;
  starsTotal: number;
  starsApprox: boolean;
  forksTotal: number;
  followers: number;
  following: number;
  reposPublic: number;
  langWeights: Record<string, number>;
  primaryLanguage: string;
  yearly: Record<string, number>;
  calendar52w: number[];
}

export function computeMetrics(f: FetchedUser, now = new Date()): ComputedMetrics {
  const cal = calendarMetrics(f.calendar, now.toISOString().slice(0, 10));
  const weights = languageWeights(f.repos, now.getTime());
  return {
    cTotal: Object.values(f.yearly).reduce((s, v) => s + v, 0),
    c30: cal.c30,
    c90: cal.c90,
    c365: cal.c365,
    streakCurrent: cal.streakCurrent,
    streakLongest: cal.streakLongest,
    lastActiveOn: cal.lastActiveOn,
    starsTotal: f.repos.reduce((s, r) => s + r.stars, 0),
    starsApprox: f.reposTotal > f.repos.length,
    forksTotal: f.repos.reduce((s, r) => s + r.forks, 0),
    followers: f.followers,
    following: f.following,
    reposPublic: f.reposTotal,
    langWeights: weights,
    primaryLanguage: primaryLanguage(weights),
    yearly: f.yearly,
    calendar52w: cal.calendar52w,
  };
}
