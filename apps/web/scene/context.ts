import { useFrame } from '@react-three/fiber';
import { BANDS } from '@commitverse/universe-core';
import { createContext, useContext, useEffect } from 'react';
import type * as THREE from 'three';
import type { Vec3d } from '@/stores/universe';
import type { Engine } from './engine';

export const EngineContext = createContext<Engine | null>(null);

export function useEngine(): Engine {
  const e = useContext(EngineContext);
  if (!e) throw new Error('useEngine outside <Universe>');
  return e;
}

/** Keeps `obj` at its float64 world position relative to the camera (floating origin), every frame + offscreen renders. */
export function useCameraRelative(ref: React.RefObject<THREE.Object3D | null>, world: () => Vec3d | null) {
  const engine = useEngine();
  const apply = () => {
    const o = ref.current;
    const w = world();
    if (!o || !w) return;
    const p = engine.rig.pos;
    o.position.set(w[0] - p[0]!, w[1] - p[1]!, w[2] - p[2]!);
    o.updateMatrixWorld();
  };
  useFrame(apply, 0);
  useEffect(() => {
    engine.preRender.add(apply);
    return () => {
      engine.preRender.delete(apply);
    };
  });
}

/** Shared scene clock: closed-form orbits use wall-clock seconds so every viewer sees the same sky (§6.9). */
export const sceneTime = (): number => Date.now() / 1000;

/** Inverse of the temperature band mapping: activity percentile a from T (for sunspot density). */
export function activityFromTemperature(T: number): number {
  if (T <= 2400) return 0;
  for (const [lo, hi, tlo, thi] of BANDS) {
    if (T >= tlo && T < thi) return lo + (hi - lo) * (Math.log(T / tlo) / Math.log(thi / tlo));
  }
  return 1;
}

export const temperatureTightness = (T: number): number => Math.min(1, Math.max(0, Math.log(T / 2400) / Math.log(40000 / 2400)));

export { engineRef } from '@/lib/client/engine-ref';
