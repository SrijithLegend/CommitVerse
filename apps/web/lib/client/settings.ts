/** Per-viewer settings persisted in localStorage (F18): graphics, toggles, motion, audio, key bindings, hints. */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';
export type QualitySetting = 'auto' | QualityTier;

export const DEFAULT_KEYS = {
  flight: 'KeyF',
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  up: 'Space',
  down: 'ControlLeft',
  rollLeft: 'KeyQ',
  rollRight: 'KeyE',
  boost: 'ShiftLeft',
  search: 'Slash',
  chart: 'KeyM',
  constellations: 'KeyC',
  share: 'KeyP',
  home: 'KeyH',
  back_target: 'Backspace',
  help: 'Shift+Slash',
  galaxy: 'KeyG',
  supercluster: 'KeyU',
  warp: 'Enter',
} as const;
export type KeyAction = keyof typeof DEFAULT_KEYS;

export interface Settings {
  quality: QualitySetting;
  bloom: boolean;
  dust: boolean;
  constellations: boolean;
  labels: boolean;
  ships: boolean;
  ghostShips: boolean;
  cometDensity: number; // 0..1
  fps: boolean;
  reducedMotion: 'system' | 'on' | 'off';
  listMode: boolean;
  audio: { master: number; ambience: number; ui: number; enabled: boolean };
  keys: Record<KeyAction, string>;
  hintsDismissed: string[];
  coachDone: boolean;
  set: (patch: Partial<Omit<Settings, 'set' | 'setKey' | 'dismissHint'>>) => void;
  setKey: (action: KeyAction, code: string) => void;
  dismissHint: (id: string) => void;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      quality: 'auto',
      bloom: true,
      dust: true,
      constellations: false,
      labels: true,
      ships: true,
      ghostShips: false,
      cometDensity: 1,
      fps: false,
      reducedMotion: 'system',
      listMode: false,
      audio: { master: 0.6, ambience: 0.5, ui: 0.6, enabled: false },
      keys: { ...DEFAULT_KEYS },
      hintsDismissed: [],
      coachDone: false,
      set: (patch) => set(patch),
      setKey: (action, code) => set((s) => ({ keys: { ...s.keys, [action]: code } })),
      dismissHint: (id) => set((s) => ({ hintsDismissed: [...new Set([...s.hintsDismissed, id])] })),
    }),
    { name: 'cv-settings', version: 1 },
  ),
);

export function prefersReducedMotion(): boolean {
  const s = useSettings.getState().reducedMotion;
  if (s !== 'system') return s === 'on';
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
