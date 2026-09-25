'use client';
/**
 * §3.3 supernova — 6 s cinematic for anyone within view: implosion → white flash → expanding shockwave shell → fade.
 * The global toast (with "Watch") lives in the UI; online viewers earn Eyewitness.
 */
import { glsl, shellFragment, shellVertex } from '@commitverse/shaders';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Api } from '@/lib/client/api';
import { play } from '@/lib/client/audio';
import { brief } from '@/lib/client/positions';
import { subscribe } from '@/lib/client/realtime';
import { useUniverse } from '@/stores/universe';
import { useEngine } from '../context';

const SHELL_F = glsl(shellFragment);
const DURATION = 6;

export function SupernovaFx() {
  const engine = useEngine();
  const sn = useUniverse((s) => s.supernova);
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const shell = useRef<THREE.Mesh>(null);
  const shellMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: shellVertex,
        fragmentShader: SHELL_F,
        uniforms: {
          uColorA: { value: new THREE.Color(1.6, 1.3, 1.9) },
          uColorB: { value: new THREE.Color(0.6, 1.2, 2.2) },
          uTime: { value: 0 },
          uOpacity: { value: 1 },
          uShape: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const coreMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 8, 9), transparent: true }), []);

  useEffect(() => {
    const off = subscribe('cosmic:global', async (event, p) => {
      if (event !== 'supernova') return;
      const githubId = Number(p.githubId);
      const b = await brief(githubId);
      useUniverse.getState().set({ supernova: { githubId, login: String(p.login), at: Date.now(), position: b?.position ?? null, payload: p } });
      void Api.stats({ type: 'eyewitness', supernovaAt: new Date().toISOString() });
      play('supernova');
    });
    return () => {
      off();
      shellMat.dispose();
      coreMat.dispose();
    };
  }, [shellMat, coreMat]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    if (!sn?.position) {
      g.visible = false;
      return;
    }
    const t = (Date.now() - sn.at) / 1000;
    if (t > DURATION) {
      g.visible = false;
      return;
    }
    const p = engine.rig.pos;
    g.position.set(sn.position[0] - p[0]!, sn.position[1] - p[1]!, sn.position[2] - p[2]!);
    g.visible = g.position.length() < 20_000;
    // implosion (0–1 s) → flash (1–1.3 s) → shockwave (1.3–6 s)
    const implode = t < 1 ? 1 - t * 0.8 : 0.2;
    const flash = t >= 1 && t < 1.6 ? 1 - (t - 1) / 0.6 : 0;
    if (core.current) {
      core.current.scale.setScalar(t < 1 ? 4 * implode : 2 + flash * 30);
      coreMat.opacity = t < 1.6 ? 1 : Math.max(0, 1 - (t - 1.6) / 1.5);
      coreMat.color.setScalar(4 + flash * 40);
    }
    if (shell.current) {
      const s = t < 1.3 ? 0.001 : 3 + (t - 1.3) * 26;
      shell.current.scale.setScalar(s);
      shellMat.uniforms.uOpacity!.value = t < 1.3 ? 0 : Math.max(0, 1 - (t - 1.3) / (DURATION - 1.3)) * 1.4;
      shellMat.uniforms.uTime!.value = engine.time;
    }
  }, 0);

  return (
    <group ref={group} visible={false}>
      <mesh ref={core} material={coreMat} renderOrder={11}>
        <sphereGeometry args={[1, 32, 16]} />
      </mesh>
      <mesh ref={shell} material={shellMat} renderOrder={12}>
        <sphereGeometry args={[1, 64, 32]} />
      </mesh>
    </group>
  );
}
