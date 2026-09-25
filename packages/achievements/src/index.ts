/** F11 — achievements catalogue + rule engine. Rules are pure functions of the context. */

export type Tier = 'bronze' | 'silver' | 'gold' | 'cosmic';

export interface AchievementContext {
  claimed: boolean;
  claimedAt: string | null;
  launchDate: string;
  accountAgeDays: number;
  cTotal: number;
  spectralClass: 'M' | 'K' | 'G' | 'F' | 'A' | 'B' | 'O';
  state: 'protostar' | 'main' | 'red_giant' | 'white_dwarf';
  previousState: 'protostar' | 'main' | 'red_giant' | 'white_dwarf' | null;
  globalImpactRank: number | null;
  pctGalaxy: number | null; // 0 = best
  pctGalaxyDelta30: number | null; // positive = moved inward (percentile points, 0–100 scale)
  streakCurrent: number;
  streakLongest: number;
  supernovas: number;
  repos: { stars: number; forks: number; releases: number; createdAt: string | null }[];
  planets: number;
  reposPublic: number;
  langWeights: Record<string, number>;
  binary: boolean;
  maxOrgClaimedMembers: number;
  signalsSent: number;
  signalsReceived: number;
  giftsSent: number;
  systemsVisited: number;
  majorGalaxiesVisited: number;
  majorGalaxiesTotal: number;
  warps: number;
  eyewitness: boolean;
  cometChased: boolean;
  verifiedReferrals: number;
  beaconHours: number;
  premiumPurchases: number;
  now: string;
}

export interface Achievement {
  id: string;
  name: string;
  tier: Tier;
  description: string;
  stardust: number;
  hidden?: boolean;
  rule: (c: AchievementContext) => boolean;
}

export const TIER_STARDUST: Record<Tier, number> = { bronze: 10, silver: 50, gold: 150, cosmic: 500 };

const DAY = 86_400_000;
const a = (id: string, name: string, tier: Tier, description: string, rule: Achievement['rule'], hidden = false): Achievement => ({
  id,
  name,
  tier,
  description,
  stardust: TIER_STARDUST[tier],
  rule,
  hidden,
});
const streakMax = (c: AchievementContext) => Math.max(c.streakCurrent, c.streakLongest);
const hot = new Set(['B', 'O']);

export const ACHIEVEMENTS: Achievement[] = [
  a('first_light', 'First Light', 'bronze', 'Claim your star', (c) => c.claimed),
  a('main_sequence', 'Main Sequence', 'bronze', '100 all-time contributions', (c) => c.cTotal >= 100),
  a('stellar_mass', 'Stellar Mass', 'silver', '1,000 all-time contributions', (c) => c.cTotal >= 1_000),
  a('giant', 'Giant', 'gold', '10,000 all-time contributions', (c) => c.cTotal >= 10_000),
  a('hypergiant', 'Hypergiant', 'cosmic', 'Global top 100 by impact', (c) => c.globalImpactRank !== null && c.globalImpactRank <= 100),
  a('blue_shift', 'Blue Shift', 'silver', 'Reach class B or O', (c) => hot.has(c.spectralClass)),
  a('o_type', 'O-Type', 'gold', 'Reach class O', (c) => c.spectralClass === 'O'),
  a('pulsar_7', 'Pulsar I', 'bronze', 'A 7-day contribution streak', (c) => streakMax(c) >= 7),
  a('pulsar_30', 'Pulsar II', 'silver', 'A 30-day contribution streak', (c) => streakMax(c) >= 30),
  a('pulsar_100', 'Pulsar III', 'gold', 'A 100-day contribution streak', (c) => streakMax(c) >= 100),
  a('pulsar_365', 'Pulsar IV', 'cosmic', 'A 365-day contribution streak', (c) => streakMax(c) >= 365),
  a('supernova', 'Supernova', 'gold', 'Trigger any supernova milestone', (c) => c.supernovas > 0),
  a('gas_giant', 'Gas Giant', 'silver', 'Own a repo with ≥ 1k ★', (c) => c.repos.some((r) => r.stars >= 1_000)),
  a('hot_jupiter', 'Hot Jupiter', 'gold', 'A repo created < 365 days ago reaches 1k ★', (c) =>
    c.repos.some((r) => r.stars >= 1_000 && !!r.createdAt && Date.parse(c.now) - Date.parse(r.createdAt) < 365 * DAY),
  ),
  a('jovian_king', 'Jovian King', 'cosmic', 'A repo with ≥ 10k ★', (c) => c.repos.some((r) => r.stars >= 10_000)),
  a('ringmaster', 'Ringmaster', 'silver', '5 repos with releases', (c) => c.repos.filter((r) => r.releases > 0).length >= 5),
  a('moon_maker', 'Moon Maker', 'silver', 'A repo with ≥ 100 forks', (c) => c.repos.some((r) => r.forks >= 100)),
  a('full_orbit', 'Full Orbit', 'bronze', '8 planets', (c) => c.planets >= 8),
  a('asteroid_miner', 'Asteroid Miner', 'silver', '≥ 50 public repos', (c) => c.reposPublic >= 50),
  a(
    'polyglot',
    'Polyglot',
    'silver',
    '≥ 5 languages each ≥ 10% of weighted bytes',
    (c) => Object.values(c.langWeights).filter((w) => w >= 0.1).length >= 5,
  ),
  a('galactic_core', 'Galactic Core', 'gold', 'Top 1% of your galaxy', (c) => c.pctGalaxy !== null && c.pctGalaxy < 0.01),
  a('rising_star', 'Rising Star', 'silver', 'Moved inward ≥ 10 percentile points in 30 days', (c) => (c.pctGalaxyDelta30 ?? 0) >= 10),
  a('binary', 'Binary', 'bronze', 'Form a binary system', (c) => c.binary),
  a('constellation', 'Constellation', 'bronze', 'Member of an org with ≥ 10 claimed members', (c) => c.maxOrgClaimedMembers >= 10),
  a('signal_sent_10', 'Transmitter I', 'bronze', 'Send 10 signals', (c) => c.signalsSent >= 10),
  a('signal_sent_100', 'Transmitter II', 'silver', 'Send 100 signals', (c) => c.signalsSent >= 100),
  a('beloved_10', 'Beloved I', 'bronze', 'Receive 10 signals', (c) => c.signalsReceived >= 10),
  a('beloved_100', 'Beloved II', 'silver', 'Receive 100 signals', (c) => c.signalsReceived >= 100),
  a('beloved_1000', 'Beloved III', 'gold', 'Receive 1,000 signals', (c) => c.signalsReceived >= 1_000),
  a('generous', 'Generous', 'silver', 'Gift 3 items', (c) => c.giftsSent >= 3),
  a('voyager', 'Voyager', 'bronze', 'Visit 100 distinct systems', (c) => c.systemsVisited >= 100),
  a(
    'cartographer',
    'Cartographer',
    'silver',
    'Visit every major galaxy',
    (c) => c.majorGalaxiesTotal > 0 && c.majorGalaxiesVisited >= c.majorGalaxiesTotal,
  ),
  a('hyperspace', 'Hyperspace', 'silver', '500 warps', (c) => c.warps >= 500),
  a('eyewitness', 'Eyewitness', 'bronze', 'Online when a supernova fires', (c) => c.eyewitness),
  a('comet_chaser', 'Comet Chaser', 'silver', 'Click a live comet within 5 s of spawn', (c) => c.cometChased),
  a('recruiter_1', 'Recruiter I', 'bronze', '1 verified referral', (c) => c.verifiedReferrals >= 1),
  a('recruiter_5', 'Recruiter II', 'silver', '5 verified referrals', (c) => c.verifiedReferrals >= 5),
  a('recruiter_25', 'Recruiter III', 'gold', '25 verified referrals', (c) => c.verifiedReferrals >= 25),
  a('recruiter_100', 'Recruiter IV', 'cosmic', '100 verified referrals', (c) => c.verifiedReferrals >= 100),
  a('early_universe', 'Early Universe', 'gold', 'Claimed within 30 days of launch', (c) => {
    if (!c.claimedAt) return false;
    const d = Date.parse(c.claimedAt) - Date.parse(c.launchDate);
    return d < 30 * DAY;
  }),
  a('beacon', 'Beacon', 'bronze', 'Install the VS Code extension and code 10 h', (c) => c.beaconHours >= 10),
  a('patron', 'Patron', 'bronze', 'Any premium purchase', (c) => c.premiumPurchases > 0),
  a('old_light', 'Old Light', 'silver', 'GitHub account ≥ 10 years old', (c) => c.accountAgeDays >= 3652),
  a(
    'dormant_revival',
    'Reignition',
    'gold',
    'Go from White Dwarf/Red Giant back to Main Sequence',
    (c) => (c.previousState === 'white_dwarf' || c.previousState === 'red_giant') && c.state === 'main',
  ),
];

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((x) => [x.id, x]));

/** Achievements that only claimed users can earn (social / economy / claim-time). */
export const CLAIMED_ONLY = new Set([
  'first_light',
  'binary',
  'signal_sent_10',
  'signal_sent_100',
  'generous',
  'voyager',
  'cartographer',
  'hyperspace',
  'eyewitness',
  'comet_chaser',
  'recruiter_1',
  'recruiter_5',
  'recruiter_25',
  'recruiter_100',
  'early_universe',
  'beacon',
  'patron',
]);

/** Returns ids newly earned (not in `already`). `early_universe` is never re-evaluated after the window. */
export function evaluate(ctx: AchievementContext, already: Set<string>): Achievement[] {
  return ACHIEVEMENTS.filter((x) => !already.has(x.id) && (ctx.claimed || !CLAIMED_ONLY.has(x.id)) && x.rule(ctx));
}

export function emptyContext(overrides: Partial<AchievementContext> = {}): AchievementContext {
  return {
    claimed: false,
    claimedAt: null,
    launchDate: '2026-10-01',
    accountAgeDays: 0,
    cTotal: 0,
    spectralClass: 'M',
    state: 'main',
    previousState: null,
    globalImpactRank: null,
    pctGalaxy: null,
    pctGalaxyDelta30: null,
    streakCurrent: 0,
    streakLongest: 0,
    supernovas: 0,
    repos: [],
    planets: 0,
    reposPublic: 0,
    langWeights: {},
    binary: false,
    maxOrgClaimedMembers: 0,
    signalsSent: 0,
    signalsReceived: 0,
    giftsSent: 0,
    systemsVisited: 0,
    majorGalaxiesVisited: 0,
    majorGalaxiesTotal: 12,
    warps: 0,
    eyewitness: false,
    cometChased: false,
    verifiedReferrals: 0,
    beaconHours: 0,
    premiumPurchases: 0,
    now: new Date().toISOString(),
    ...overrides,
  };
}
