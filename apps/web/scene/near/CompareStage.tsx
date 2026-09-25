'use client';
/**
 * F12 Binary View stage: both systems on a staging point far above the supercluster, orbiting a shared barycenter;
 * the heavier star (by c_total) moves less. Purely presentational — real positions are untouched.
 */
import type { StarDetail } from '@commitverse/contracts';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { Api } from '@/lib/client/api';
import { sceneCommands, useUniverse, type Vec3d } from '@/stores/universe';
import { sceneTime, useCameraRelative } from '../context';
import { TIERS } from '../quality';
import { Planet } from './Planet';
import { StarBody } from './StarBody';
import { starColorLinear } from './System';

export const STAGE: Vec3d = [0, 3_000_000, 0];

function Member({ d, offset }: { d: StarDetail; offset: () => [number, number, number] }) {
  const g = useRef<THREE.Group>(null);
  const tier = useUniverse((s) => s.tier);
  const color = useMemo(() => starColorLinear(d.body.temperature), [d.body.temperature]);
  useFrame(() => {
    const [x, y, z] = offset();
    g.current?.position.set(x, y, z);
  }, 0);
  return (
    <group ref={g}>
      <StarBody githubId={d.user.githubId} radius={d.body.radius} temperature={d.body.temperature} state={d.body.state} pulsarPeriod={d.body.pulsarPeriod} />
      {d.planets.map((p) => (
        <Planet key={p.repoId} planet={p} starColor={color} segments={TIERS[tier].planetSegments} />
      ))}
    </group>
  );
}

export function CompareStage() {
  const intent = useUniverse((s) => s.intent);
  const [pair, setPair] = useState<[StarDetail, StarDetail] | null>(null);
  const root = useRef<THREE.Group>(null);
  useCameraRelative(root, () => (pair ? STAGE : null));

  useEffect(() => {
    if (intent.type !== 'compare') {
      setPair(null);
      return;
    }
    let alive = true;
    void Promise.all([Api.star(intent.a), Api.star(intent.b)]).then(([a, b]) => {
      if (!alive) return;
      setPair([a, b]);
      useUniverse.getState().set({ focus: null, panel: null });
      const ext = (d: StarDetail) => Math.max(d.body.radius * 3, d.planets.at(-1)?.orbitRadius ?? 8);
      sceneCommands.push({ type: 'warpTo', position: STAGE, radius: 1, frame: (ext(a) + ext(b)) * 2.4 });
    });
    return () => {
      alive = false;
    };
  }, [intent]);

  if (!pair) return null;
  const [a, b] = pair;
  const ext = (d: StarDetail) => Math.max(d.body.radius * 3, d.planets.at(-1)?.orbitRadius ?? 8);
  const sep = ext(a) + ext(b) + 12;
  const m1 = a.metrics.cTotal + 1;
  const m2 = b.metrics.cTotal + 1;
  const angle = () => sceneTime() * 0.04;
  return (
    <group ref={root}>
      <Member d={a} offset={() => [-Math.cos(angle()) * sep * (m2 / (m1 + m2)), 0, -Math.sin(angle()) * sep * (m2 / (m1 + m2))]} />
      <Member d={b} offset={() => [Math.cos(angle()) * sep * (m1 / (m1 + m2)), 0, Math.sin(angle()) * sep * (m1 / (m1 + m2))]} />
    </group>
  );
}
