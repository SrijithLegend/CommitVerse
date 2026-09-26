'use client';
/**
 * T3 system view (§6.2): the focused star with its planets, moons, rings, asteroid belt, Oort cloud, binary companion,
 * gift pods, supernova remnant, beacon ring — plus the cosmetics layer, which can never touch physical attributes.
 */
import { CATALOG_BY_ID, type StarDetail } from '@commitverse/contracts';
import { glsl, litFragment, litVertex, shellFragment, shellVertex } from '@commitverse/shaders';
import { beltRange, hash32, kelvinToRGB, mulberry32, OORT_RADIUS, saturate } from '@commitverse/universe-core';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Api } from '@/lib/client/api';
import { useUniverse } from '@/stores/universe';
import { sceneTime, useCameraRelative, useEngine } from '../context';
import { Cosmetics } from '../cosmetics/Cosmetics';
import { TIERS } from '../quality';
import { Planet } from './Planet';
import { StarBody } from './StarBody';

const SHELL_F = glsl(shellFragment);
const LIT_F = glsl(litFragment);

export function starColorLinear(T: number): THREE.Color {
  const [r, g, b] = saturate(kelvinToRGB(T));
  return new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear().multiplyScalar(1.4);
}

function Belt({
  inner,
  outer,
  count,
  seed,
  starColor,
}: {
  inner: number;
  outer: number;
  count: number;
  seed: number;
  starColor: THREE.Color;
}) {
  const engine = useEngine();
  const ref = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: litVertex,
        fragmentShader: LIT_F,
        uniforms: {
          uColor: { value: new THREE.Color(0.42, 0.39, 0.36) },
          uStarColor: { value: starColor },
          uStarViewPos: { value: new THREE.Vector3() },
          uEmissive: { value: 0 },
        },
      }),
    [starColor],
  );
  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const p = g.attributes.position as THREE.BufferAttribute;
    const r = mulberry32(seed);
    for (let i = 0; i < p.count; i++)
      p.setXYZ(i, p.getX(i) * (0.7 + r() * 0.6), p.getY(i) * (0.7 + r() * 0.6), p.getZ(i) * (0.7 + r() * 0.6));
    g.computeVertexNormals();
    return g;
  }, [seed]);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const r = mulberry32(seed ^ 0xbe17);
    const o = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const d = inner + (outer - inner) * r();
      o.position.set(Math.cos(a) * d, (r() - 0.5) * 0.6, Math.sin(a) * d);
      o.rotation.set(r() * 6, r() * 6, r() * 6);
      o.scale.setScalar(0.03 + r() ** 3 * 0.14);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, [count, inner, outer, seed]);
  useEffect(
    () => () => {
      mat.dispose();
      geo.dispose();
    },
    [mat, geo],
  );
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (group.current) {
      group.current.rotation.y = (sceneTime() / (20 * ((inner + outer) / 2 / Math.max(1, inner)) ** 1.5 * 6)) % (Math.PI * 2);
      group.current.parent?.getWorldPosition(tmp);
      (mat.uniforms.uStarViewPos!.value as THREE.Vector3).copy(tmp.applyMatrix4(engine.nearCam.matrixWorldInverse));
    }
  }, 0);
  return (
    <group ref={group}>
      <instancedMesh ref={ref} args={[geo, mat, count]} frustumCulled={false} />
    </group>
  );
}

function Oort({ density, seed }: { density: number; seed: number }) {
  const pts = useMemo(() => {
    const r = mulberry32(seed ^ 0x0027);
    const pos = new Float32Array(density * 3);
    for (let i = 0; i < density; i++) {
      const z = 2 * r() - 1;
      const phi = r() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      const d = OORT_RADIUS + (r() - 0.5) * 6;
      pos.set([s * Math.cos(phi) * d, z * d * 0.8, s * Math.sin(phi) * d], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color: new THREE.Color(0.55, 0.65, 0.9),
      size: 0.18,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    return new THREE.Points(g, m);
  }, [density, seed]);
  useEffect(
    () => () => {
      pts.geometry.dispose();
      (pts.material as THREE.Material).dispose();
    },
    [pts],
  );
  return <primitive object={pts} />;
}

function Remnant({ until, radius }: { until: string; radius: number }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: shellVertex,
        fragmentShader: SHELL_F,
        uniforms: {
          uColorA: { value: new THREE.Color(0.9, 0.5, 1.0) },
          uColorB: { value: new THREE.Color(0.3, 0.7, 1.0) },
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
  const mesh = useRef<THREE.Mesh>(null);
  const engine = useEngine();
  useFrame(() => {
    const left = (Date.parse(until) - Date.now()) / (7 * 86_400_000);
    const age = 1 - Math.max(0, Math.min(1, left));
    if (mesh.current) mesh.current.scale.setScalar(radius * 3 + age * 34);
    mat.uniforms.uOpacity!.value = 0.9 * (1 - age) + 0.1;
    mat.uniforms.uTime!.value = engine.time;
  }, 0);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh ref={mesh} material={mat}>
      <sphereGeometry args={[1, 64, 32]} />
    </mesh>
  );
}

function BeaconRing({ radius }: { radius: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.3, 1.6, 1.8),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useFrame(() => {
    const t = sceneTime() % 1; // 1 Hz
    if (ref.current) ref.current.scale.setScalar(radius * (1.6 + t * 2.4));
    mat.opacity = 0.8 * (1 - t);
  }, 0);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh ref={ref} material={mat} rotation={[Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.96, 1, 96]} />
    </mesh>
  );
}

function GiftPods({ count, radius }: { count: number; radius: number }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.2, 2.4) }), []);
  const ribbon = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.2, 0.8) }), []);
  useFrame(() => {
    const t = sceneTime();
    refs.current.forEach((m, i) => {
      if (!m) return;
      const a = t * 0.4 + (i / Math.max(1, count)) * Math.PI * 2;
      const d = radius * 2.2 + 1.2;
      m.position.set(Math.cos(a) * d, Math.sin(t * 0.8 + i) * 0.4, Math.sin(a) * d);
      m.rotation.set(t * 0.7, t * 0.9, 0);
    });
  }, 0);
  useEffect(
    () => () => {
      mat.dispose();
      ribbon.dispose();
    },
    [mat, ribbon],
  );
  return (
    <>
      {Array.from({ length: Math.min(count, 12) }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          scale={0.35}
          userData={{ kind: 'gift' }}
        >
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={mat} attach="material" />
          <mesh scale={[1.02, 0.22, 1.02]} material={ribbon}>
            <boxGeometry args={[1, 1, 1]} />
          </mesh>
          <mesh scale={[0.22, 1.02, 1.02]} material={ribbon}>
            <boxGeometry args={[1, 1, 1]} />
          </mesh>
        </mesh>
      ))}
    </>
  );
}

/** Binary system: both stars orbit a shared barycenter; the heavier (by radius here, a c_total proxy) moves less. */
function Companion({ login, primary }: { login: string; primary: StarDetail }) {
  const [partner, setPartner] = useState<StarDetail | null>(null);
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    let alive = true;
    Api.star(login)
      .then((d) => alive && setPartner(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [login]);
  const sep = (primary.body.radius + (partner?.body.radius ?? 2)) * 5 + 6;
  const m1 = primary.metrics.cTotal + 1;
  const m2 = (partner?.metrics.cTotal ?? 1) + 1;
  useFrame(() => {
    if (!ref.current) return;
    const a = sceneTime() * 0.08;
    const r2 = sep * (m1 / (m1 + m2));
    ref.current.position.set(Math.cos(a) * r2, 0, Math.sin(a) * r2);
  }, 0);
  if (!partner) return null;
  return (
    <group ref={ref}>
      <StarBody
        githubId={partner.user.githubId}
        radius={partner.body.radius}
        temperature={partner.body.temperature}
        state={partner.body.state}
        pulsarPeriod={partner.body.pulsarPeriod}
        detail="low"
        pickable={false}
      />
    </group>
  );
}

export function FocusedSystem({ detail }: { detail: StarDetail }) {
  const engine = useEngine();
  const root = useRef<THREE.Group>(null);
  const primary = useRef<THREE.Group>(null);
  const tier = useUniverse((s) => s.tier);
  const tryOn = useUniverse((s) => s.tryOn);
  const [ringFlash, setRingFlash] = useState<Record<number, number>>({});
  const planetLocal = useRef(new Map<number, THREE.Vector3>());
  const pos = detail.body.position;
  const starColor = useMemo(() => starColorLinear(detail.body.temperature), [detail.body.temperature]);
  useCameraRelative(root, () => pos);

  const cosmetics = { ...detail.cosmetics, ...tryOn };
  const skin = Number(CATALOG_BY_ID.get(cosmetics.star_skin ?? '')?.renderConfig.pattern ?? 0);
  const planetSkin = (CATALOG_BY_ID.get(cosmetics.planet_skin ?? '')?.renderConfig.pattern as string | undefined) ?? null;
  const orbits = detail.planets.map((p) => p.orbitRadius);
  const [bIn, bOut] = beltRange(orbits.length ? orbits : [detail.body.radius * 3]);
  const seed = hash32(detail.user.githubId);
  const segments = TIERS[tier].planetSegments;

  // Binary barycenter offset for the primary
  const binaryWith = detail.social.binaryWith;
  useFrame(() => {
    if (!primary.current) return;
    if (!binaryWith) {
      primary.current.position.set(0, 0, 0);
      return;
    }
    const a = sceneTime() * 0.08;
    const sep = detail.body.radius * 5 + 16;
    const r1 = sep * 0.35;
    primary.current.position.set(-Math.cos(a) * r1, 0, -Math.sin(a) * r1);
  }, 0);

  // Release comets flash the planet's rings (F10)
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ githubId: number; repo: string }>).detail;
      if (d.githubId !== detail.user.githubId) return;
      const p = detail.planets.find((x) => d.repo.endsWith(`/${x.name}`));
      if (!p) return;
      setRingFlash((f) => ({ ...f, [p.slot]: 1 }));
      setTimeout(() => setRingFlash((f) => ({ ...f, [p.slot]: 0 })), 900);
    };
    window.addEventListener('cv:release', on);
    return () => window.removeEventListener('cv:release', on);
  }, [detail]);

  // Planet focus: the orbit target follows the moving planet.
  const planetFocus = useRef<number | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const slot = (e as CustomEvent<number | null>).detail;
      planetFocus.current = slot;
      const p = detail.planets.find((x) => x.slot === slot);
      const s = useUniverse.getState();
      if (s.focus?.kind === 'star') s.set({ focus: { ...s.focus, planetSlot: slot } });
      if (p) {
        const l = planetLocal.current.get(p.slot) ?? new THREE.Vector3();
        engine.rig.orbitAround([pos[0] + l.x, pos[1] + l.y, pos[2] + l.z], p.radius, { kind: 'star', dist: Math.max(p.radius * 6, 1.2) });
        engine.rig.minDist = p.radius * 1.5;
        engine.rig.maxDist = 60;
      } else {
        engine.rig.orbitAround(pos, detail.body.radius, { kind: 'star' });
      }
    };
    window.addEventListener('cv:focus-planet', on);
    return () => window.removeEventListener('cv:focus-planet', on);
  }, [detail, engine, pos]);
  useFrame(() => {
    const slot = planetFocus.current;
    if (slot === null || engine.rig.mode !== 'orbit') return;
    const l = planetLocal.current.get(slot);
    if (l) engine.rig.target.set([pos[0] + l.x, pos[1] + l.y, pos[2] + l.z]);
  }, -0.5);

  return (
    <group ref={root}>
      <group ref={primary}>
        <StarBody
          githubId={detail.user.githubId}
          radius={detail.body.radius}
          temperature={detail.body.temperature}
          state={detail.body.state}
          pulsarPeriod={detail.body.pulsarPeriod}
          skin={skin}
        />
        {detail.body.flags.includes('beacon') && <BeaconRing radius={detail.body.radius} />}
        <Cosmetics
          cosmetics={cosmetics}
          radius={detail.body.radius}
          temperature={detail.body.temperature}
          githubId={detail.user.githubId}
        />
        {detail.planets.map((p) => (
          <Planet
            key={p.repoId}
            planet={p}
            starColor={starColor}
            segments={segments}
            skin={p.slot === 0 ? planetSkin : null}
            ringFlash={ringFlash[p.slot] ?? 0}
            onPosition={(slot, v) => {
              const cur = planetLocal.current.get(slot) ?? new THREE.Vector3();
              cur.copy(v);
              if (primary.current) cur.add(primary.current.position);
              planetLocal.current.set(slot, cur);
            }}
          />
        ))}
        {detail.body.beltCount > 0 && <Belt inner={bIn} outer={bOut} count={detail.body.beltCount} seed={seed} starColor={starColor} />}
        {detail.social.giftPods > 0 && <GiftPods count={detail.social.giftPods} radius={detail.body.radius} />}
      </group>
      {binaryWith && <Companion login={binaryWith} primary={detail} />}
      {detail.body.oortDensity > 0 && <Oort density={detail.body.oortDensity} seed={seed} />}
      {detail.social.remnantUntil && Date.parse(detail.social.remnantUntil) > Date.now() && (
        <Remnant until={detail.social.remnantUntil} radius={detail.body.radius} />
      )}
    </group>
  );
}
