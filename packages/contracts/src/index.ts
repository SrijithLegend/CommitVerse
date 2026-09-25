/** §10 — Zod schemas shared by the API handlers and clients. */
import { z } from 'zod';

export * from './env';

export const LOGIN_RE = /^[a-zA-Z0-9-]{1,39}$/;
export const Login = z.string().regex(LOGIN_RE, 'Invalid GitHub login');

export const SpectralClass = z.enum(['M', 'K', 'G', 'F', 'A', 'B', 'O']);
export const StellarState = z.enum(['protostar', 'main', 'red_giant', 'white_dwarf']);
export const FlagName = z.enum(['claimed', 'pulsar', 'hypergiant', 'online', 'binary', 'beacon']);
export const Slot = z.enum(['corona', 'aura', 'star_rings', 'star_skin', 'planet_skin', 'ship', 'trail', 'warp', 'banner', 'signal_style']);
export type Slot = z.infer<typeof Slot>;
export const Rarity = z.enum(['common', 'rare', 'epic', 'legendary', 'mythic']);

/** RFC 9457 problem details. */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: z.string(),
});
export type Problem = z.infer<typeof Problem>;

// ─── Stars ────────────────────────────────────────────────────────────────

export const SearchResult = z.object({
  githubId: z.number(),
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  galaxy: z.string().nullable(),
  spectralClass: SpectralClass.nullable(),
  kind: z.enum(['user', 'org']).default('user'),
});
export type SearchResult = z.infer<typeof SearchResult>;
export const SearchResponse = z.object({ results: z.array(SearchResult) });

export const Position = z.object({
  githubId: z.number(),
  galaxyId: z.number(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  provisional: z.boolean(),
  bakeVersion: z.string(),
});
export type Position = z.infer<typeof Position>;

export const PlanetDto = z.object({
  repoId: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  stars: z.number(),
  forks: z.number(),
  releases: z.number(),
  language: z.string().nullable(),
  languageColor: z.string(),
  pushedAt: z.string().nullable(),
  isArchived: z.boolean(),
  type: z.enum(['gas_giant', 'ocean', 'rocky']),
  moons: z.number(),
  ringBands: z.number(),
  slot: z.number(),
  orbitRadius: z.number(),
  radius: z.number(),
  period: z.number(),
  inclination: z.number(),
  phase: z.number(),
  axialTilt: z.number(),
  spinPeriod: z.number(),
  aurora: z.boolean(),
  greatSpot: z.boolean(),
});
export type PlanetDto = z.infer<typeof PlanetDto>;

export const WhyLine = z.object({ axis: z.string(), raw: z.string(), formula: z.string(), value: z.string() });

export const StarDetail = z.object({
  user: z.object({
    githubId: z.number(),
    login: z.string(),
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    bio: z.string().nullable(),
    createdAt: z.string(),
  }),
  metrics: z.object({
    cTotal: z.number(),
    c30: z.number(),
    c90: z.number(),
    c365: z.number(),
    streakCurrent: z.number(),
    streakLongest: z.number(),
    starsTotal: z.number(),
    forksTotal: z.number(),
    followers: z.number(),
    following: z.number(),
    reposPublic: z.number(),
    starsApprox: z.boolean(),
    lastActiveOn: z.string().nullable(),
    langWeights: z.record(z.string(), z.number()),
    calendar52w: z.array(z.number()),
  }),
  body: z.object({
    galaxy: z.object({ id: z.number(), language: z.string() }),
    position: z.tuple([z.number(), z.number(), z.number()]),
    provisional: z.boolean(),
    radius: z.number(),
    baseRadius: z.number(),
    temperature: z.number(),
    spectralClass: SpectralClass,
    subclass: z.string(),
    luminosity: z.number(),
    impact: z.number(),
    state: StellarState,
    flags: z.array(FlagName),
    pulsarPeriod: z.number().nullable(),
    rankGalaxy: z.number().nullable(),
    rankGlobal: z.number().nullable(),
    pctGalaxy: z.number().nullable(),
    beltCount: z.number(),
    oortDensity: z.number(),
  }),
  planets: z.array(PlanetDto),
  cosmetics: z.record(z.string(), z.string().nullable()),
  achievements: z.array(z.object({ id: z.string(), name: z.string(), tier: z.string(), rarity: z.number(), unlockedAt: z.string() })),
  orgs: z.array(z.object({ login: z.string(), name: z.string().nullable(), avatarUrl: z.string().nullable() })),
  social: z.object({
    signalsReceived: z.number(),
    binaryWith: z.string().nullable(),
    claimed: z.boolean(),
    giftPods: z.number(),
    remnantUntil: z.string().nullable(),
    beaconActive: z.boolean(),
  }),
  why: z.array(WhyLine),
  rankHistory: z.array(z.object({ bakeVersion: z.string(), rankGalaxy: z.number().nullable(), pctGalaxy: z.number().nullable() })),
  bakeVersion: z.string(),
  fetchedAt: z.string().nullable(),
});
export type StarDetail = z.infer<typeof StarDetail>;

export const StarBrief = z.object({
  githubId: z.number(),
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  spectralClass: SpectralClass,
  state: StellarState,
  radius: z.number(),
  temperature: z.number(),
  luminosity: z.number(),
  galaxy: z.string(),
});
export type StarBrief = z.infer<typeof StarBrief>;
export const BriefQuery = z.object({
  ids: z
    .string()
    .transform((s) => s.split(',').filter(Boolean).map(Number))
    .pipe(z.array(z.number().int().positive()).min(1).max(50)),
});

export const JobStatus = z.enum(['queued', 'fetching', 'placing', 'born', 'failed']);
export type JobStatus = z.infer<typeof JobStatus>;
export const JobDto = z.object({
  id: z.string(),
  status: JobStatus,
  login: z.string(),
  queuePosition: z.number().nullable(),
  error: z.string().nullable(),
  githubId: z.number().nullable(),
});
export type JobDto = z.infer<typeof JobDto>;
export const MaterializeResponse = z.object({ jobId: z.string().nullable(), status: z.enum(['queued', 'mapped']), login: z.string() });

// ─── Universe ─────────────────────────────────────────────────────────────

export const UniverseCurrent = z.object({ bakeVersion: z.string(), manifestUrl: z.string(), deltaUrl: z.string() });

export const LeaderboardMetric = z.enum(['impact', 'c_total', 'c_30', 'streak', 'stars', 'rising', 'signals']);
export type LeaderboardMetric = z.infer<typeof LeaderboardMetric>;
export const LeaderboardQuery = z.object({
  metric: LeaderboardMetric.default('impact'),
  cursor: z.coerce.number().int().min(0).default(0),
  me: z.string().optional(),
});
export const LeaderboardRow = z.object({
  rank: z.number(),
  githubId: z.number(),
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  value: z.number(),
  temperature: z.number(),
  spectralClass: SpectralClass,
  galaxy: z.string(),
});
export type LeaderboardRow = z.infer<typeof LeaderboardRow>;
export const LeaderboardResponse = z.object({ rows: z.array(LeaderboardRow), nextCursor: z.number().nullable(), total: z.number() });

export const FeedEvent = z.object({
  id: z.number(),
  type: z.string(),
  actor: z.object({ githubId: z.number(), login: z.string(), avatarUrl: z.string().nullable() }).nullable(),
  target: z.object({ githubId: z.number(), login: z.string() }).nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type FeedEvent = z.infer<typeof FeedEvent>;
export const FeedResponse = z.object({ events: z.array(FeedEvent), nextCursor: z.number().nullable() });

// ─── Me ──────────────────────────────────────────────────────────────────

export const Settings = z
  .object({
    hideFromFeed: z.boolean().default(false),
    hideFromLeaderboards: z.boolean().default(false),
    disableSignals: z.boolean().default(false),
    hideBeacon: z.boolean().default(false),
    emailDigest: z.boolean().default(false),
    weeklyCodingStat: z.boolean().default(false),
  })
  .partial();
export type Settings = z.infer<typeof Settings>;

export const PatchMe = z
  .object({
    bioOverride: z.string().max(160).nullable(),
    pinnedOverride: z.array(z.number().int().positive()).max(8).nullable(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    settings: Settings,
  })
  .partial()
  .strict();

export const EquipBody = z.object({ slot: Slot, inventoryId: z.string().uuid().nullable() });
export const RedeemBody = z.object({ itemId: z.string().min(1).max(64) });
export const CheckoutBody = z.object({ itemId: z.string().min(1).max(64), giftTo: Login.optional(), anonymous: z.boolean().optional() });
export const SignalBody = z.object({ to: Login, message: z.string().max(60).optional() });
export const BindingBody = z.object({ with: Login });
export const BindingPatch = z.object({ action: z.enum(['accept', 'decline', 'dissolve']) });
export const ReportBody = z.object({
  targetType: z.enum(['banner', 'bio', 'signal', 'user']),
  targetId: z.string().min(1).max(64),
  reason: z.string().min(3).max(500),
});
export const ViewBody = z.object({
  camera: z.object({
    pos: z.tuple([z.number(), z.number(), z.number()]),
    quat: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    focus: z.string().max(64).nullable(),
    tier: z.string().max(16).optional(),
    t: z.number(),
  }),
});
export const HeartbeatBody = z.object({ language: z.string().max(64).nullable().optional() });

export const ShopItem = z.object({
  id: z.string(),
  slot: Slot,
  name: z.string(),
  description: z.string(),
  rarity: Rarity,
  track: z.enum(['earnable', 'premium', 'exclusive']),
  priceStardust: z.number().nullable(),
  priceMinor: z.record(z.string(), z.number()).nullable(),
  availableFrom: z.string().nullable(),
  availableUntil: z.string().nullable(),
  renderConfig: z.record(z.string(), z.unknown()),
  ownedPct: z.number(),
});
export type ShopItem = z.infer<typeof ShopItem>;
export * from './items';
