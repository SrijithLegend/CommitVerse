'use client';
/**
 * F10 live comets: push (blue ion tail), pr_merged (green-gold), release (white-violet + ring flash on the planet).
 * GPU particle tails, analytic in the vertex shader. ≤ 40 simultaneous per client (the rest are summarised in the feed).
 * During a meteor shower merged PRs become meteors streaking across the whole sky.
 */
import { cometFragment, cometVertex } from '@commitverse/shaders';
import { hashUnit } from '@commitverse/universe-core';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Api } from '@/lib/client/api';
import { brief } from '@/lib/client/positions';
import { subscribe } from '@/lib/client/realtime';
import { useSettings } from '@/lib/client/settings';
import { type LiveComet, useUniverse } from '@/stores/universe';
import { useEngine } from '../context';

const MAX = 40;
const PARTICLES = 600;
const COLORS = {
  push: { ion: new THREE.Color(0.35, 0.6, 1.6), dust: new THREE.Color(1.0, 0.85, 0.7) },
  pr_merged: { ion: new THREE.Color(0.5, 1.5, 0.6), dust: new THREE.Color(1.5, 1.2, 0.4) },
  release: { ion: new THREE.Color(1.4, 1.3, 1.8), dust: new THREE.Color(1.2, 0.9, 1.6) },
} as const;

function cometGeometry(): THREE.BufferGeometry {
  const n = 1 + PARTICLES * 2;
  const seeds = new Float32Array(n * 2);
  seeds.set([0, 0], 0);
  for (let i = 0; i < PARTICLES; i++) {
    seeds.set([Math.random(), 1], (1 + i) * 2);
    seeds.set([Math.random(), 2], (1 + PARTICLES + i) * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY);
  return g;
}

function Comet({ comet, geometry }: { comet: LiveComet; geometry: THREE.BufferGeometry }) {
  const engine = useEngine();
  const head = useRef<THREE.Mesh>(null);
  const dir = useMemo(() => {
    const a = hashUnit(comet.id, 1) * Math.PI * 2;
    const e = (hashUnit(comet.id, 2) - 0.5) * 0.8;
    return new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).normalize();
  }, [comet.id]);
  const curve = useMemo(() => new THREE.Vector3(0, 1, 0).cross(dir).normalize(), [dir]);
  const mat = useMemo(() => {
    const c = COLORS[comet.meteor ? 'pr_merged' : comet.type];
    return new THREE.ShaderMaterial({
      vertexShader: cometVertex,
      fragmentShader: cometFragment,
      uniforms: {
        uOrigin: { value: new THREE.Vector3() },
        uDir: { value: dir },
        uCurve: { value: curve },
        uAge: { value: 0 },
        uDuration: { value: comet.meteor ? 1.6 : 6 },
        uPixelRatio: engine.shared.uPixelRatio,
        uIonColor: { value: c.ion },
        uDustColor: { value: c.dust },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, [comet, dir, curve, engine]);
  useEffect(() => {
    const h = head.current;
    if (h) {
      h.userData = { kind: 'comet', id: comet.id, spawnedAt: comet.spawnedAt, login: comet.login };
      engine.pickables.add(h);
    }
    return () => {
      if (h) engine.pickables.delete(h);
      mat.dispose();
    };
  }, [engine, mat, comet]);
  useFrame(() => {
    const age = (Date.now() - comet.spawnedAt) / 1000;
    const p = engine.rig.pos;
    const o = comet.origin;
    (mat.uniforms.uOrigin!.value as THREE.Vector3).set(o[0] - p[0]!, o[1] - p[1]!, o[2] - p[2]!);
    mat.uniforms.uAge!.value = age;
    if (head.current) {
      const travel = Math.min(1, age / mat.uniforms.uDuration!.value);
      const ease = 1 - (1 - travel) ** 1.6;
      head.current.position.copy(mat.uniforms.uOrigin!.value as THREE.Vector3).addScaledVector(dir, 300 * ease);
    }
  }, 0);
  return (
    <>
      <points geometry={geometry} material={mat} frustumCulled={false} renderOrder={8} />
      <mesh ref={head} visible={false}>
        <sphereGeometry args={[6, 8, 6]} />
      </mesh>
    </>
  );
}

export function Comets() {
  const comets = useUniverse((s) => s.comets);
  const geometry = useMemo(cometGeometry, []);
  const density = useSettings((s) => s.cometDensity);
  useEffect(() => {
    const off = subscribe('cosmic:global', async (event, p) => {
      if (event !== 'comet') return;
      if (Math.random() > density) return;
      const githubId = Number(p.githubId);
      const b = await brief(githubId);
      if (!b) return;
      const comet: LiveComet = {
        id: `${githubId}-${Date.now()}`,
        githubId,
        login: String(p.login),
        type: (p.type as LiveComet['type']) ?? 'push',
        repo: String(p.repo ?? ''),
        meteor: !!p.meteor,
        spawnedAt: Date.now(),
        origin: b.position,
      };
      const s = useUniverse.getState();
      s.set({ comets: [...s.comets.filter((c) => Date.now() - c.spawnedAt < 7000), comet].slice(-MAX) });
      if (comet.type === 'release') window.dispatchEvent(new CustomEvent('cv:release', { detail: { githubId, repo: comet.repo } }));
    });
    const prune = setInterval(() => {
      const s = useUniverse.getState();
      const alive = s.comets.filter((c) => Date.now() - c.spawnedAt < 7000);
      if (alive.length !== s.comets.length) s.set({ comets: alive });
    }, 1000);
    const onClick = (e: Event) => {
      const d = (e as CustomEvent<{ spawnedAt: number; login: string }>).detail;
      void Api.stats({ type: 'comet_chase', spawnedAt: new Date(d.spawnedAt).toISOString(), clickedAt: new Date().toISOString() });
    };
    window.addEventListener('cv:comet-click', onClick);
    return () => {
      off();
      clearInterval(prune);
      window.removeEventListener('cv:comet-click', onClick);
    };
  }, [density]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <>
      {comets.map((c) => (
        <Comet key={c.id} comet={c} geometry={geometry} />
      ))}
    </>
  );
}
