'use client';
/**
 * §5.3 near-field star: icosphere (detail 5 ≤ 60 u, 3 otherwise) with granulation/sunspots/limb darkening, corona
 * quad (4·R), prominences (A/B/O), pulsar beams (period P + lighthouse flash), protostar cocoon, red-giant convection.
 * Physical attributes come ONLY from data props; cosmetics are rendered elsewhere (cosmetics layer).
 */
import { useFrame } from '@react-three/fiber';
import {
  beamFragment,
  beamVertex,
  cocoonFragment,
  cocoonVertex,
  coronaFragment,
  coronaVertex,
  glsl,
  prominenceFragment,
  prominenceVertex,
  starSurfaceFragment,
  starSurfaceVertex,
} from '@commitverse/shaders';
import { hash32, hashUnit } from '@commitverse/universe-core';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { activityFromTemperature, temperatureTightness, useEngine } from '../context';

export interface StarBodyProps {
  githubId: number;
  radius: number;
  temperature: number;
  state: 'protostar' | 'main' | 'red_giant' | 'white_dwarf';
  pulsarPeriod: number | null;
  skin?: number;
  intensity?: number;
  opacity?: number;
  detail?: 'high' | 'low';
  pickable?: boolean;
}

const STATE_CODE = { main: 0, protostar: 1, red_giant: 2, white_dwarf: 3 } as const;
const SURFACE = { v: starSurfaceVertex, f: glsl(starSurfaceFragment) };
const CORONA = { v: coronaVertex, f: glsl(coronaFragment) };
const PROM = { v: prominenceVertex, f: glsl(prominenceFragment) };
const COCOON = { v: cocoonVertex, f: glsl(cocoonFragment) };

function arcGeometry(seed: number, i: number): THREE.TubeGeometry {
  const r = hashUnit(seed, i * 7 + 1);
  const theta = hashUnit(seed, i * 7 + 2) * Math.PI * 2;
  const phi = (hashUnit(seed, i * 7 + 3) - 0.5) * 1.8;
  const span = 0.25 + r * 0.35;
  const height = 0.25 + hashUnit(seed, i * 7 + 4) * 0.45;
  const pts: THREE.Vector3[] = [];
  const base = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - phi, theta);
  const tangent = new THREE.Vector3(0, 1, 0).cross(base).normalize();
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    const along = (t - 0.5) * span;
    const lift = Math.sin(t * Math.PI) * height;
    const p = base.clone().applyAxisAngle(tangent.clone().cross(base).normalize(), 0).add(tangent.clone().multiplyScalar(along)).normalize();
    pts.push(p.multiplyScalar(1 + lift));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.02 + r * 0.025, 6, false);
}

export function StarBody({ githubId, radius, temperature, state, pulsarPeriod, skin = 0, intensity = 1, opacity = 1, detail = 'high', pickable = true }: StarBodyProps) {
  const engine = useEngine();
  const meshRef = useRef<THREE.Mesh>(null);
  const beamsRef = useRef<THREE.Group>(null);
  const seed = (hash32(githubId) % 1000) / 10;
  const cls = temperature >= 7500;
  const activity = activityFromTemperature(temperature);

  const surface = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SURFACE.v,
        fragmentShader: SURFACE.f,
        uniforms: {
          uLut: engine.shared.uLut,
          uTemp: { value: temperature },
          uActivity: { value: activity },
          uTime: { value: 0 },
          uState: { value: STATE_CODE[state] },
          uSkin: { value: skin },
          uSeed: { value: seed },
          uIntensity: { value: 2.6 * intensity },
          uOpacity: { value: state === 'protostar' ? 0.4 * opacity : opacity },
        },
        transparent: state === 'protostar' || opacity < 1,
        depthWrite: state !== 'protostar',
      }),
    [engine, temperature, activity, state, skin, seed, intensity, opacity],
  );
  const corona = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CORONA.v,
        fragmentShader: CORONA.f,
        uniforms: {
          uLut: engine.shared.uLut,
          uTemp: { value: temperature },
          uTime: { value: 0 },
          uTight: { value: temperatureTightness(temperature) },
          uIntensity: { value: (state === 'white_dwarf' ? 0.5 : 1.3) * intensity * opacity },
          uBase: { value: 1 },
          uStyle: { value: 0 },
          uTint: { value: new THREE.Color(0, 0, 0) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [engine, temperature, state, intensity, opacity],
  );
  const prominence = useMemo(
    () =>
      cls
        ? new THREE.ShaderMaterial({
            vertexShader: PROM.v,
            fragmentShader: PROM.f,
            uniforms: { uLut: engine.shared.uLut, uTemp: { value: temperature }, uTime: { value: 0 }, uSeed: { value: seed } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
        : null,
    [engine, cls, temperature, seed],
  );
  const arcs = useMemo(() => (cls && detail === 'high' ? Array.from({ length: 3 + (hash32(githubId) % 4) }, (_, i) => arcGeometry(githubId, i)) : []), [cls, detail, githubId]);
  const cocoon = useMemo(
    () =>
      state === 'protostar'
        ? new THREE.ShaderMaterial({
            vertexShader: COCOON.v,
            fragmentShader: COCOON.f,
            uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uCamObj: { value: new THREE.Vector3() } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
          })
        : null,
    [state, seed],
  );
  const beamMat = useMemo(
    () =>
      pulsarPeriod
        ? new THREE.ShaderMaterial({
            vertexShader: beamVertex,
            fragmentShader: beamFragment,
            uniforms: { uColor: { value: new THREE.Color(0.7, 0.85, 1.2) }, uFlash: { value: 0 } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          })
        : null,
    [pulsarPeriod],
  );
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, detail === 'high' ? 5 : 3), [detail]);
  const quad = useMemo(() => new THREE.PlaneGeometry(4, 4), []);
  const cone = useMemo(() => {
    const g = new THREE.ConeGeometry(0.9, 26, 24, 1, true);
    g.translate(0, -13, 0);
    g.rotateX(Math.PI);
    return g;
  }, []);

  useEffect(
    () => () => {
      surface.dispose();
      corona.dispose();
      prominence?.dispose();
      cocoon?.dispose();
      beamMat?.dispose();
      geo.dispose();
      for (const a of arcs) a.dispose();
    },
    [surface, corona, prominence, cocoon, beamMat, geo, arcs],
  );

  useEffect(() => {
    const m = meshRef.current;
    if (!m || !pickable) return;
    m.userData = { kind: 'star', githubId };
    engine.pickables.add(m);
    return () => {
      engine.pickables.delete(m);
    };
  }, [engine, githubId, pickable]);

  const tilt = hashUnit(githubId, 99) * 0.6;
  useFrame(() => {
    const t = engine.time;
    surface.uniforms.uTime!.value = t;
    corona.uniforms.uTime!.value = t;
    if (prominence) prominence.uniforms.uTime!.value = t;
    if (cocoon) {
      cocoon.uniforms.uTime!.value = t;
      const m = meshRef.current;
      if (m) {
        const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
        (cocoon.uniforms.uCamObj!.value as THREE.Vector3).set(0, 0, 0).applyMatrix4(inv).divideScalar(2.2);
      }
    }
    if (beamsRef.current && pulsarPeriod && beamMat) {
      const angle = ((t % pulsarPeriod) / pulsarPeriod) * Math.PI * 2;
      beamsRef.current.rotation.set(tilt, angle, 0.4);
      // lighthouse flash when a beam crosses the view vector
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(beamsRef.current.getWorldQuaternion(new THREE.Quaternion()));
      const toCam = beamsRef.current.getWorldPosition(new THREE.Vector3()).negate().normalize();
      beamMat.uniforms.uFlash!.value = Math.max(0, Math.abs(axis.dot(toCam)) - 0.97) * 30;
    }
  }, 0);

  return (
    <group scale={radius}>
      <mesh ref={meshRef} geometry={geo} material={surface} renderOrder={2} />
      <mesh geometry={quad} material={corona} renderOrder={3} />
      {prominence && arcs.map((a, i) => <mesh key={i} geometry={a} material={prominence} renderOrder={3} />)}
      {cocoon && <mesh scale={2.2} geometry={geo} material={cocoon} renderOrder={4} />}
      {beamMat && (
        <group ref={beamsRef}>
          <mesh geometry={cone} material={beamMat} renderOrder={5} />
          <mesh geometry={cone} material={beamMat} rotation={[Math.PI, 0, 0]} renderOrder={5} />
        </group>
      )}
    </group>
  );
}
