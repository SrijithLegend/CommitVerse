/** Read-only handle for DOM overlays (reticle, share cards) — type-only import keeps three.js out of the HUD bundle. */
import type { Engine } from '@/scene/engine';

export const engineRef: { current: Engine | null } = { current: null };
