/**
 * Scene/UI state. Per-frame data never goes through React: the render loop reads with getState()/subscribe (§6.1).
 */
import type { StarBrief, StarDetail } from '@commitverse/contracts';
import type { Manifest } from '@commitverse/universe-core';
import { create } from 'zustand';
import type { QualityTier } from '@/lib/client/settings';

export type Vec3d = [number, number, number];

export interface FocusStar {
  kind: 'star';
  githubId: number;
  login: string;
  position: Vec3d;
  radius: number;
  temperature: number;
  starIndex?: number;
  planetSlot?: number | null;
}
export interface FocusGalaxy {
  kind: 'galaxy';
  galaxyId: number;
}
export type Focus = FocusStar | FocusGalaxy | null;

export type CameraMode = 'orbit' | 'flight' | 'warp' | 'cinematic' | 'galaxy' | 'supercluster' | 'replay';

export interface Hover {
  githubId: number;
  starIndex: number;
  position: Vec3d;
  screen: [number, number];
  brief?: StarBrief;
  kind: 'star' | 'planet' | 'comet' | 'ship';
  label?: string;
}

export interface LiveComet {
  id: string;
  githubId: number;
  login: string;
  type: 'push' | 'pr_merged' | 'release';
  repo: string;
  meteor: boolean;
  spawnedAt: number;
  origin: Vec3d;
}

export interface SignalBeam {
  id: string;
  from: Vec3d;
  to: Vec3d;
  style: string;
  startedAt: number;
}

export interface Supernova {
  githubId: number;
  login: string;
  at: number;
  position: Vec3d | null;
  payload: Record<string, unknown>;
}

export type SceneIntent =
  | { type: 'hero' }
  | { type: 'star'; login: string; planet?: string | null; ignite?: boolean }
  | { type: 'galaxy'; lang: string }
  | { type: 'compare'; a: string; b: string }
  | { type: 'view'; camera: { pos: Vec3d; quat: [number, number, number, number]; focus: string | null; t: number } }
  | { type: 'replay' }
  | { type: 'dim' };

export interface UniverseState {
  intent: SceneIntent;
  dim: boolean;
  presence: { sector: string | null; total: number; roster: { id: number; login: string | null }[] };
  followShip: number | null;
  manifest: Manifest | null;
  deltaUrl: string | null;
  bakeVersion: string | null;
  starCount: number;
  webgl: 'unknown' | 'ok' | 'unavailable';
  tier: QualityTier;
  fps: number;
  focus: Focus;
  focusDetail: StarDetail | null;
  history: Focus[];
  hover: Hover | null;
  mode: CameraMode;
  warp: { active: boolean; progress: number; target: string | null };
  forming: { login: string; jobId: string | null; status: string; queuePosition: number | null; error: string | null } | null;
  comets: LiveComet[];
  signals: SignalBeam[];
  supernova: Supernova | null;
  tryOn: Record<string, string | null>;
  hiddenIndices: Set<number>;
  panel: 'system' | 'planet' | null;
  overlay: 'chart' | 'help' | 'share' | 'settings' | null;
  replayYear: number | null;
  constellationOrg: string | null;
  highlight: string | null;
  set: (patch: Partial<UniverseState>) => void;
}

export const useUniverse = create<UniverseState>()((set) => ({
  intent: { type: 'hero' },
  dim: false,
  presence: { sector: null, total: 0, roster: [] },
  followShip: null,
  manifest: null,
  deltaUrl: null,
  bakeVersion: null,
  starCount: 0,
  webgl: 'unknown',
  tier: 'high',
  fps: 0,
  focus: null,
  focusDetail: null,
  history: [],
  hover: null,
  mode: 'orbit',
  warp: { active: false, progress: 0, target: null },
  forming: null,
  comets: [],
  signals: [],
  supernova: null,
  tryOn: {},
  hiddenIndices: new Set(),
  panel: null,
  overlay: null,
  replayYear: null,
  constellationOrg: null,
  highlight: null,
  set: (patch) => set(patch),
}));

/** Commands from UI → scene (warp, look at, etc.), consumed by the engine each frame. */
export type SceneCommand =
  | { type: 'warpTo'; position: Vec3d; radius: number; instant?: boolean; frame?: number }
  | { type: 'galaxyView'; galaxyId: number | null }
  | { type: 'supercluster' }
  | { type: 'cinematic' }
  | { type: 'flight'; on: boolean }
  | { type: 'focusPlanet'; slot: number | null }
  | { type: 'setPose'; pos: Vec3d; quat: [number, number, number, number]; target?: Vec3d }
  | { type: 'screenshot'; preset?: 'landscape' | 'stories'; resolve: (blob: Blob | null) => void };

const commands: SceneCommand[] = [];
export const sceneCommands = {
  push(c: SceneCommand) {
    commands.push(c);
  },
  drain(): SceneCommand[] {
    return commands.splice(0, commands.length);
  },
};
