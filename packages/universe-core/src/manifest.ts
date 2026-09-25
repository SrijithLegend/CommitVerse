/** §6.4 — /u/{bakeVersion}/manifest.json shape (shared by bake, API and client). */
import type { GalaxyForm, GalaxyTier, Quat, Vec3 } from './galaxy';

export interface ManifestNode {
  key: string;
  count: number;
  /** [cx, cy, cz, halfSize] galaxy-local cube (LOD bounding volume). */
  cube: [number, number, number, number];
}

export interface ManifestGalaxy {
  id: number;
  language: string;
  tier: GalaxyTier;
  form: GalaxyForm;
  arms: number;
  radius: number;
  coreRadius: number;
  thickness: number;
  pitch: number;
  tilt: Quat;
  center: Vec3;
  population: number;
  color: string;
  members: string[];
  nodes: ManifestNode[];
  /** 1,000-bucket descending impact quantiles for provisional placement. */
  quantiles: number[];
}

export interface Manifest {
  format: 1;
  bakeVersion: string;
  createdAt: string;
  paramsHash: string;
  counts: { stars: number; galaxies: number };
  impactP999: number;
  cTotalP80: number;
  hypergiantImpact: number;
  /** Ascending 1,000-point quantile table of c_30 among active users. */
  c30Quantiles: number[];
  galaxies: ManifestGalaxy[];
}

export const tilePath = (bakeVersion: string, galaxyId: number, nodeKey: string, kind: 'bin' | 'ids.bin' | 'hist.bin' = 'bin') =>
  kind === 'hist.bin' ? `u/${bakeVersion}/h/${galaxyId}/${nodeKey}.hist.bin` : `u/${bakeVersion}/g/${galaxyId}/${nodeKey}.${kind}`;
