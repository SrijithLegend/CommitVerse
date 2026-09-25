'use client';
/** §3.4 / §5.3 planets: procedural surface by type, atmosphere rim, rings with planet shadow, tidally locked moons. */
import type { PlanetDto } from '@commitverse/contracts';
import {
  atmosphereFragment,
  glsl,
  litFragment,
  litVertex,
  planetFragment,
  planetVertex,
  ringFragment,
  ringVertex,
} from '@commitverse/shaders';
import { hash32, hashUnit, planetPosition } from '@commitverse/universe-core';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { sceneTime, useEngine } from '../context';

const PLANET_F = glsl(planetFragment);
const RING_F = glsl(ringFragment);
const ATMO_F = glsl(atmosphereFragment);
const TYPE_CODE = { gas_giant: 0, ocean: 1, rocky: 2 } as const;
const SKIN_CODE: Record<string, number> = { terraformed: 1, lava: 2, city: 3, diamond: 4 };

const toLinear = (hex: string) => new THREE.Color(hex).convertSRGBToLinear();

export interface PlanetProps {
  planet: PlanetDto;
  starColor: THREE.Color;
  segments: [number, number];
  skin?: string | null;
  highlight?: boolean;
  ringFlash?: number;
  timeOffset?: number;
  onPosition?: (slot: number, local: THREE.Vector3) => void;
}

export function Planet({ planet, starColor, segments, skin, ringFlash = 0, timeOffset = 0, onPosition }: PlanetProps) {
  const engine = useEngine();
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  const seed = (hash32(planet.repoId) % 997) / 7;
  const hue = useMemo(() => toLinear(planet.languageColor || '#8b93a7'), [planet.languageColor]);
  const surface = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: planetVertex,
        fragmentShader: PLANET_F,
        uniforms: {
          uType: { value: TYPE_CODE[planet.type] },
          uSkin: { value: skin ? (SKIN_CODE[skin] ?? 0) : 0 },
          uHue: { value: hue },
          uStarColor: { value: starColor },
          uStarViewPos: { value: new THREE.Vector3() },
          uSeed: { value: seed },
          uTime: { value: 0 },
          uSpot: { value: planet.greatSpot ? 1 : 0 },
          uArchived: { value: planet.isArchived ? 1 : 0 },
          uAurora: { value: planet.aurora ? 1 : 0 },
        },
      }),
    [planet.type, planet.greatSpot, planet.isArchived, planet.aurora, skin, hue, starColor, seed],
  );
  const atmo = useMemo(
    () =>
      planet.type === 'rocky' && !planet.aurora
        ? null
        : new THREE.ShaderMaterial({
            vertexShader: planetVertex,
            fragmentShader: ATMO_F,
            uniforms: { uHue: { value: hue }, uStarColor: { value: starColor }, uStarViewPos: surface.uniforms.uStarViewPos! },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
          }),
    [planet.type, planet.aurora, hue, starColor, surface],
  );
  const ringMat = useMemo(
    () =>
      planet.ringBands > 0
        ? new THREE.ShaderMaterial({
            vertexShader: ringVertex,
            fragmentShader: RING_F,
            uniforms: {
              uInner: { value: 1.4 },
              uOuter: { value: 1.4 + 0.35 * planet.ringBands },
              uBands: { value: planet.ringBands },
              uSeed: { value: seed },
              uPlanetR: { value: 1 },
              uStarLocal: { value: new THREE.Vector3() },
              uStarColor: { value: starColor },
              uHue: { value: hue },
              uFlash: { value: 0 },
            },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        : null,
    [planet.ringBands, seed, starColor, hue],
  );
  const moonMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: litVertex,
        fragmentShader: litFragment,
        uniforms: { uColor: { value: new THREE.Color(0.55, 0.53, 0.5) }, uStarColor: { value: starColor }, uStarViewPos: surface.uniforms.uStarViewPos!, uEmissive: { value: 0 } },
      }),
    [starColor, surface],
  );
  const geo = useMemo(() => new THREE.SphereGeometry(1, segments[0], segments[1]), [segments]);
  const moonGeo = useMemo(() => new THREE.SphereGeometry(1, 12, 8), []);
  const ringGeo = useMemo(() => (planet.ringBands > 0 ? new THREE.RingGeometry(1.4, 1.4 + 0.35 * planet.ringBands, 96, 1) : null), [planet.ringBands]);
  const orbitLine = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const [x, y, z] = planetPosition({ ...planet, phase: (i / 128) * Math.PI * 2, isArchived: true }, 0);
      pts.push(new THREE.Vector3(x, y, z));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color: new THREE.Color(0.45, 0.55, 0.75), transparent: true, opacity: 0.14, depthWrite: false });
    return new THREE.Line(g, m);
  }, [planet]);

  useEffect(() => {
    const b = body.current;
    if (b) {
      b.userData = { kind: 'planet', slot: planet.slot, repoId: planet.repoId, name: planet.name };
      engine.pickables.add(b);
    }
    return () => {
      if (b) engine.pickables.delete(b);
      surface.dispose();
      atmo?.dispose();
      ringMat?.dispose();
      moonMat.dispose();
      geo.dispose();
      moonGeo.dispose();
      ringGeo?.dispose();
      orbitLine.geometry.dispose();
      (orbitLine.material as THREE.Material).dispose();
    };
  }, [engine, planet, surface, atmo, ringMat, moonMat, geo, moonGeo, ringGeo, orbitLine]);

  const moons = useMemo(
    () =>
      Array.from({ length: planet.moons }, (_, i) => ({
        dist: 2.1 + i * 0.75 + hashUnit(planet.repoId, 40 + i) * 0.4,
        size: 0.1 + hashUnit(planet.repoId, 50 + i) * 0.12,
        period: 6 + i * 4 + hashUnit(planet.repoId, 60 + i) * 5,
        phase: hashUnit(planet.repoId, 70 + i) * Math.PI * 2,
        incl: (hashUnit(planet.repoId, 80 + i) - 0.5) * 0.5,
      })),
    [planet.moons, planet.repoId],
  );
  const moonRefs = useRef<(THREE.Mesh | null)[]>([]);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = sceneTime() + timeOffset;
    const [x, y, z] = planetPosition(planet, t);
    g.position.set(x, y, z);
    onPosition?.(planet.slot, g.position);
    if (body.current && !planet.isArchived) body.current.rotation.y = (t / planet.spinPeriod) * Math.PI * 2;
    // star (system origin) in view space for lighting
    g.parent?.getWorldPosition(tmp);
    tmp.applyMatrix4(engine.nearCam.matrixWorldInverse);
    (surface.uniforms.uStarViewPos!.value as THREE.Vector3).copy(tmp);
    surface.uniforms.uTime!.value = engine.time;
    if (ringMat) {
      // star position in the ring's local frame (planet-centred, scaled by planet radius, tilted)
      const local = new THREE.Vector3(-x, -y, -z).divideScalar(planet.radius);
      const qTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, planet.axialTilt));
      const qRing = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
      local.applyQuaternion(qTilt.multiply(qRing).invert());
      (ringMat.uniforms.uStarLocal!.value as THREE.Vector3).copy(local);
      ringMat.uniforms.uFlash!.value = ringFlash;
    }
    moons.forEach((m, i) => {
      const mesh = moonRefs.current[i];
      if (!mesh) return;
      const a = m.phase + (t / m.period) * Math.PI * 2;
      mesh.position.set(Math.cos(a) * m.dist, Math.sin(a) * m.dist * m.incl, Math.sin(a) * m.dist);
      mesh.rotation.y = -a; // tidally locked
    });
  }, 0);

  return (
    <>
      <primitive object={orbitLine} />
      <group ref={group}>
        <group scale={planet.radius} rotation={[0, 0, planet.axialTilt]}>
          <mesh ref={body} geometry={geo} material={surface} />
          {atmo && <mesh geometry={geo} material={atmo} scale={planet.type === 'gas_giant' ? 1.08 : 1.05} />}
          {ringMat && ringGeo && <mesh geometry={ringGeo} material={ringMat} rotation={[Math.PI / 2, 0, 0]} renderOrder={6} />}
          {moons.map((m, i) => (
            <mesh
              key={i}
              ref={(el) => {
                moonRefs.current[i] = el;
              }}
              geometry={moonGeo}
              material={moonMat}
              scale={m.size}
            />
          ))}
        </group>
      </group>
    </>
  );
}
