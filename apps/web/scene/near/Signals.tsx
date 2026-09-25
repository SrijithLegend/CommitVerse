'use client';
/**
 * F8 signals: a beam in the sender's Signal Style travels sender → recipient over 1.5 s. If only the recipient is in
 * view, a directional arrival flare plays instead.
 */
import { CATALOG_BY_ID } from '@commitverse/contracts';
import { signalFragment, signalVertex } from '@commitverse/shaders';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { play } from '@/lib/client/audio';
import { brief } from '@/lib/client/positions';
import { subscribe } from '@/lib/client/realtime';
import { type SignalBeam, useUniverse } from '@/stores/universe';
import { useEngine } from '../context';

const STYLE_CODE: Record<string, number> = { laser: 0, torpedo: 1, plane: 2 };
const DURATION = 1500;

function ribbon(): THREE.BufferGeometry {
  const N = 96;
  const t = new Float32Array((N + 1) * 2);
  const side = new Float32Array((N + 1) * 2);
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    t.set([i / N, i / N], i * 2);
    side.set([-1, 1], i * 2);
    if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 2 * 3), 3));
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY);
  return g;
}

function Beam({ beam, geometry }: { beam: SignalBeam; geometry: THREE.BufferGeometry }) {
  const engine = useEngine();
  const flare = useRef<THREE.Sprite>(null);
  const cfg = CATALOG_BY_ID.get(beam.style)?.renderConfig;
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: signalVertex,
        fragmentShader: signalFragment,
        uniforms: {
          uFrom: { value: new THREE.Vector3() },
          uTo: { value: new THREE.Vector3() },
          uBow: { value: new THREE.Vector3() },
          uWidth: { value: 0.6 },
          uColor: { value: new THREE.Color(String(cfg?.color ?? '#7cc4ff')).multiplyScalar(2.5) },
          uProgress: { value: 0 },
          uStyle: { value: STYLE_CODE[String(cfg?.style ?? 'laser')] ?? 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [cfg],
  );
  const flareMat = useMemo(() => new THREE.SpriteMaterial({ color: new THREE.Color(2, 2.2, 2.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  useEffect(() => () => {
    mat.dispose();
    flareMat.dispose();
  }, [mat, flareMat]);
  useFrame(() => {
    const p = engine.rig.pos;
    const u = mat.uniforms;
    const from = u.uFrom!.value as THREE.Vector3;
    const to = u.uTo!.value as THREE.Vector3;
    from.set(beam.from[0] - p[0]!, beam.from[1] - p[1]!, beam.from[2] - p[2]!);
    to.set(beam.to[0] - p[0]!, beam.to[1] - p[1]!, beam.to[2] - p[2]!);
    const len = from.distanceTo(to);
    (u.uBow!.value as THREE.Vector3).set(0, len * 0.12, 0);
    const prog = (Date.now() - beam.startedAt) / DURATION;
    u.uProgress!.value = Math.min(1.35, prog);
    if (flare.current) {
      flare.current.position.copy(to);
      const f = Math.max(0, 1 - Math.abs(prog - 1) * 3);
      flare.current.scale.setScalar(Math.max(0.001, f * Math.max(8, to.length() * 0.03)));
      flareMat.opacity = f;
    }
  }, 0);
  return (
    <>
      <mesh geometry={geometry} material={mat} frustumCulled={false} renderOrder={9} />
      <sprite ref={flare} material={flareMat} />
    </>
  );
}

export function Signals() {
  const signals = useUniverse((s) => s.signals);
  const geometry = useMemo(ribbon, []);
  useEffect(() => {
    const off = subscribe('cosmic:global', async (event, p) => {
      if (event !== 'signal') return;
      const [a, b] = await Promise.all([brief(Number(p.from)), brief(Number(p.to))]);
      if (!a || !b) return;
      const beam: SignalBeam = { id: `${p.from}-${p.to}-${Date.now()}`, from: a.position, to: b.position, style: String(p.style ?? 'signal_style.laser'), startedAt: Date.now() };
      const s = useUniverse.getState();
      s.set({ signals: [...s.signals.filter((x) => Date.now() - x.startedAt < DURATION * 1.6), beam].slice(-20) });
      play('signal');
    });
    const prune = setInterval(() => {
      const s = useUniverse.getState();
      const alive = s.signals.filter((x) => Date.now() - x.startedAt < DURATION * 1.6);
      if (alive.length !== s.signals.length) s.set({ signals: alive });
    }, 800);
    return () => {
      off();
      clearInterval(prune);
    };
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <>
      {signals.map((b) => (
        <Beam key={b.id} beam={b} geometry={geometry} />
      ))}
    </>
  );
}
