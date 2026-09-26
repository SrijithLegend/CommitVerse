'use client';
/** T2 neighbourhood (§6.2): the nearest N stars (by tier) upgraded to the near-field star shader within 300 u. */
import { useFrame } from '@react-three/fiber';
import { useRef, useState } from 'react';
import * as THREE from 'three';
import { useUniverse } from '@/stores/universe';
import { useCameraRelative, useEngine } from '../context';
import type { NearStar } from '../engine';
import { StarBody } from './StarBody';

function Neighbor({ star }: { star: NearStar }) {
  const engine = useEngine();
  const ref = useRef<THREE.Group>(null);
  useCameraRelative(ref, () => star.position);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const p = engine.rig.pos;
    const d = Math.hypot(star.position[0] - p[0]!, star.position[1] - p[1]!, star.position[2] - p[2]!);
    // cross-fade with the far-field point over the last 20 % of the 300 u threshold
    g.scale.setScalar(1 - THREE.MathUtils.smoothstep(d, 240, 300));
    g.visible = d < 300;
  }, 0);
  return (
    <group ref={ref}>
      <StarBody
        githubId={star.githubId}
        radius={star.radius}
        temperature={star.temperature}
        state={star.state}
        pulsarPeriod={star.flags & 2 ? 1.2 : null}
        detail="low"
      />
    </group>
  );
}

export function Neighbors() {
  const engine = useEngine();
  const [stars, setStars] = useState<NearStar[]>([]);
  const key = useRef('');
  const focus = useUniverse((s) => s.focus);
  useFrame(() => {
    const focusIdx = focus?.kind === 'star' ? focus.starIndex : undefined;
    const focusId = focus?.kind === 'star' ? focus.githubId : undefined;
    const list = engine.nearStars.filter((s) => s.starIndex !== focusIdx && s.githubId !== focusId);
    const k = list.map((s) => s.starIndex).join(',');
    if (k !== key.current) {
      key.current = k;
      setStars(list);
    }
  }, 0);
  return (
    <>
      {stars.map((s) => (
        <Neighbor key={s.starIndex} star={s} />
      ))}
    </>
  );
}
