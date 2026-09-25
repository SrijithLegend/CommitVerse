/** F6 — cosmetics catalogue. Synced into `items` at boot. render_config is consumed by apps/web/scene/cosmetics only. */
import type { z } from 'zod';
import type { Rarity, Slot } from './index';

export interface CatalogItem {
  id: string;
  slot: z.infer<typeof Slot>;
  name: string;
  description: string;
  rarity: z.infer<typeof Rarity>;
  track: 'earnable' | 'premium' | 'exclusive';
  priceStardust: number | null;
  priceMinor: Record<string, number> | null;
  availableFrom?: string;
  availableUntil?: string;
  maxSupply?: number;
  renderConfig: Record<string, string | number | boolean>;
}

const earn = (stardust: number) => ({ track: 'earnable' as const, priceStardust: stardust, priceMinor: null });
const prem = (usdCents: number) => ({
  track: 'premium' as const,
  priceStardust: null,
  priceMinor: { USD: usdCents, INR: Math.round((usdCents * 83) / 100) * 100, EUR: Math.round(usdCents * 0.92) },
});
const excl = { track: 'exclusive' as const, priceStardust: null, priceMinor: null };

export const CATALOG: CatalogItem[] = [
  // Corona
  {
    id: 'corona.solar_flare',
    slot: 'corona',
    name: 'Solar Flare',
    description: 'Licking plasma tongues around your photosphere.',
    rarity: 'common',
    ...earn(100),
    renderConfig: { style: 'flare', color: '#ffb347', intensity: 1 },
  },
  {
    id: 'corona.crown_of_prominences',
    slot: 'corona',
    name: 'Crown of Prominences',
    description: 'A regal ring of looping prominences.',
    rarity: 'rare',
    ...earn(400),
    renderConfig: { style: 'crown', color: '#ff7a3d', intensity: 1.2 },
  },
  {
    id: 'corona.halo_ring',
    slot: 'corona',
    name: 'Halo Ring',
    description: 'A crisp 22° halo, like ice crystals in a cold sky.',
    rarity: 'epic',
    ...prem(499),
    renderConfig: { style: 'halo', color: '#bfe3ff', intensity: 1.1 },
  },
  {
    id: 'corona.eclipse_diamond',
    slot: 'corona',
    name: 'Eclipse Diamond',
    description: 'Totality, frozen at the diamond-ring moment.',
    rarity: 'legendary',
    ...prem(999),
    renderConfig: { style: 'diamond', color: '#ffffff', intensity: 1.6 },
  },
  {
    id: 'corona.meteor_crown_2026',
    slot: 'corona',
    name: 'Meteor Crown ’26',
    description: 'Hacktoberfest 2026 limited drop.',
    rarity: 'epic',
    ...earn(600),
    availableFrom: '2026-10-01T00:00:00Z',
    availableUntil: '2026-11-01T00:00:00Z',
    renderConfig: { style: 'crown', color: '#9d7bff', intensity: 1.3 },
  },
  {
    id: 'corona.recruiter_1',
    slot: 'corona',
    name: 'Recruiter I',
    description: 'One verified referral.',
    rarity: 'rare',
    ...excl,
    renderConfig: { style: 'halo', color: '#7cc4ff', intensity: 0.9 },
  },
  {
    id: 'corona.recruiter_5',
    slot: 'corona',
    name: 'Recruiter II',
    description: 'Five verified referrals.',
    rarity: 'epic',
    ...excl,
    renderConfig: { style: 'crown', color: '#7cc4ff', intensity: 1.1 },
  },
  {
    id: 'corona.recruiter_25',
    slot: 'corona',
    name: 'Recruiter III',
    description: 'Twenty-five verified referrals.',
    rarity: 'legendary',
    ...excl,
    renderConfig: { style: 'diamond', color: '#7cc4ff', intensity: 1.4 },
  },
  {
    id: 'corona.recruiter_100',
    slot: 'corona',
    name: 'Recruiter IV',
    description: 'One hundred verified referrals.',
    rarity: 'mythic',
    ...excl,
    renderConfig: { style: 'flare', color: '#7cc4ff', intensity: 2 },
  },
  // Nebula aura
  {
    id: 'aura.orion_veil',
    slot: 'aura',
    name: 'Orion Veil',
    description: 'A soft rose-and-teal emission veil.',
    rarity: 'rare',
    ...earn(350),
    renderConfig: { colorA: '#ff6f91', colorB: '#3fd0c9', shape: 'veil' },
  },
  {
    id: 'aura.aurora_borealis',
    slot: 'aura',
    name: 'Aurora Borealis',
    description: 'Green curtains rippling around your system.',
    rarity: 'epic',
    ...earn(900),
    renderConfig: { colorA: '#4dffb0', colorB: '#6a5cff', shape: 'curtain' },
  },
  {
    id: 'aura.crab_filaments',
    slot: 'aura',
    name: 'Crab Filaments',
    description: 'Tangled supernova-remnant filaments.',
    rarity: 'epic',
    ...prem(599),
    renderConfig: { colorA: '#ff8a3d', colorB: '#5b8cff', shape: 'filaments' },
  },
  {
    id: 'aura.pillars',
    slot: 'aura',
    name: 'Pillars',
    description: 'Towering columns of star-forming dust.',
    rarity: 'legendary',
    ...prem(1299),
    renderConfig: { colorA: '#c9a36b', colorB: '#3b6f8f', shape: 'pillars' },
  },
  // Star rings
  {
    id: 'star_rings.saturnine',
    slot: 'star_rings',
    name: 'Saturnine',
    description: 'A classic banded ring around your star.',
    rarity: 'common',
    ...earn(150),
    renderConfig: { count: 1, tilt: 0.45, color: '#e6d3a3', style: 'band' },
  },
  {
    id: 'star_rings.double_helix',
    slot: 'star_rings',
    name: 'Double Helix',
    description: 'Two counter-tilted rings, twisting.',
    rarity: 'epic',
    ...prem(499),
    renderConfig: { count: 2, tilt: 0.8, color: '#9fe6ff', style: 'helix' },
  },
  {
    id: 'star_rings.accretion_loop',
    slot: 'star_rings',
    name: 'Accretion Loop',
    description: 'A hot, spiralling accretion band.',
    rarity: 'legendary',
    ...prem(899),
    renderConfig: { count: 1, tilt: 0.2, color: '#ffae5c', style: 'accretion' },
  },
  // Star skins (modulate the surface pattern, never the blackbody colour)
  {
    id: 'star_skin.crystalline',
    slot: 'star_skin',
    name: 'Crystalline',
    description: 'Faceted Voronoi crystal granulation.',
    rarity: 'rare',
    ...earn(500),
    renderConfig: { pattern: 2 },
  },
  {
    id: 'star_skin.neon_grid',
    slot: 'star_skin',
    name: 'Neon Grid',
    description: 'A latitude/longitude grid glowing through the plasma.',
    rarity: 'epic',
    ...prem(699),
    renderConfig: { pattern: 3 },
  },
  {
    id: 'star_skin.obsidian',
    slot: 'star_skin',
    name: 'Obsidian',
    description: 'Dark glassy crust with glowing fissures.',
    rarity: 'legendary',
    ...prem(999),
    renderConfig: { pattern: 4 },
  },
  {
    id: 'star_skin.glitch',
    slot: 'star_skin',
    name: 'Glitch',
    description: 'Scanline-torn photosphere.',
    rarity: 'mythic',
    ...prem(1999),
    maxSupply: 500,
    renderConfig: { pattern: 5 },
  },
  // Planet skins
  {
    id: 'planet_skin.terraformed',
    slot: 'planet_skin',
    name: 'Terraformed',
    description: 'Green continents, blue seas.',
    rarity: 'rare',
    ...earn(300),
    renderConfig: { pattern: 'terraformed' },
  },
  {
    id: 'planet_skin.lava_world',
    slot: 'planet_skin',
    name: 'Lava World',
    description: 'Cracked crust over a molten mantle.',
    rarity: 'rare',
    ...earn(350),
    renderConfig: { pattern: 'lava' },
  },
  {
    id: 'planet_skin.cyber_city',
    slot: 'planet_skin',
    name: 'Cyber City Lights',
    description: 'A night side ablaze with city lights.',
    rarity: 'epic',
    ...prem(499),
    renderConfig: { pattern: 'city' },
  },
  {
    id: 'planet_skin.diamond',
    slot: 'planet_skin',
    name: 'Diamond',
    description: 'A refracting crystalline planet.',
    rarity: 'legendary',
    ...prem(899),
    renderConfig: { pattern: 'diamond' },
  },
  // Ships
  {
    id: 'ship.hauler',
    slot: 'ship',
    name: 'Hauler',
    description: 'Slow, boxy, dependable.',
    rarity: 'common',
    ...earn(200),
    renderConfig: { hull: 'hauler', color: '#c9ced9' },
  },
  {
    id: 'ship.interceptor',
    slot: 'ship',
    name: 'Interceptor',
    description: 'Swept wings, twin engines.',
    rarity: 'rare',
    ...earn(400),
    renderConfig: { hull: 'interceptor', color: '#e8ecf6' },
  },
  {
    id: 'ship.relic',
    slot: 'ship',
    name: 'Relic',
    description: 'An ancient derelict, somehow still flying.',
    rarity: 'mythic',
    ...prem(1499),
    renderConfig: { hull: 'relic', color: '#b08d57' },
  },
  // Engine trails
  {
    id: 'trail.ion_blue',
    slot: 'trail',
    name: 'Ion Blue',
    description: 'A clean ion-drive plume.',
    rarity: 'common',
    ...earn(100),
    renderConfig: { style: 'ion', color: '#6cc7ff' },
  },
  {
    id: 'trail.commit_glyphs',
    slot: 'trail',
    name: 'Commit Glyphs',
    description: 'A wake of + and − particles.',
    rarity: 'rare',
    ...earn(450),
    renderConfig: { style: 'glyphs', color: '#7ee787' },
  },
  {
    id: 'trail.rainbow_spectrum',
    slot: 'trail',
    name: 'Rainbow Spectrum',
    description: 'The whole visible spectrum, trailing behind you.',
    rarity: 'epic',
    ...prem(399),
    renderConfig: { style: 'rainbow', color: '#ffffff' },
  },
  // Warp effects (local only)
  {
    id: 'warp.tunnel',
    slot: 'warp',
    name: 'Tunnel',
    description: 'A ribbed hyperspace tunnel.',
    rarity: 'rare',
    ...earn(300),
    renderConfig: { style: 1 },
  },
  {
    id: 'warp.glitch_jump',
    slot: 'warp',
    name: 'Glitch Jump',
    description: 'Reality tears, then snaps back.',
    rarity: 'epic',
    ...prem(299),
    renderConfig: { style: 2 },
  },
  // Banner
  {
    id: 'banner.beacon',
    slot: 'banner',
    name: 'Beacon Banner',
    description: 'Custom text (≤ 24 chars) on an orbiting satellite. Pre-moderated.',
    rarity: 'rare',
    ...earn(250),
    renderConfig: { color: '#7cc4ff' },
  },
  // Signal styles
  {
    id: 'signal_style.laser',
    slot: 'signal_style',
    name: 'Laser',
    description: 'A tight coherent beam.',
    rarity: 'common',
    ...earn(80),
    renderConfig: { style: 'laser', color: '#ff5f7e' },
  },
  {
    id: 'signal_style.photon_torpedo',
    slot: 'signal_style',
    name: 'Photon Torpedo',
    description: 'A pulsing packet of light.',
    rarity: 'rare',
    ...earn(300),
    renderConfig: { style: 'torpedo', color: '#ffd166' },
  },
  {
    id: 'signal_style.paper_plane',
    slot: 'signal_style',
    name: 'Paper Plane',
    description: 'Folded, thrown, delivered.',
    rarity: 'epic',
    ...prem(199),
    renderConfig: { style: 'plane', color: '#ffffff' },
  },
];

export const CATALOG_BY_ID = new Map(CATALOG.map((i) => [i.id, i]));
