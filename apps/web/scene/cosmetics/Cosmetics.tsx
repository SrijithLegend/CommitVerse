'use client';
/**
 * F6 cosmetics layer. HARD RULE (Principle 1): this layer receives the physical attributes read-only and renders
 * separate meshes; nothing here can change radius, temperature, luminosity, state, position or rank.
 * The Playwright cosmetic-integrity test reads the star's physical uniforms with and without every item equipped.
 */
import { CATALOG_BY_ID } from '@commitverse/contracts';
import { coronaFragment, coronaVertex, glsl, shellFragment, shellVertex } from '@commitverse/shaders';
import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useUniverse } from '@/stores/universe';
import { sceneTime, temperatureTightness, useEngine } from '../context';

const CORONA_F = glsl(coronaFragment);
const SHELL_F = glsl(shellFragment);
const CORONA_STYLE: Record<string, number> = { flare: 1, crown: 2, halo: 3, diamond: 4 };
const AURA_SHAPE: Record<string, number> = { veil: 1, curtain: 2, filaments: 3, pillars: 4 };

const cfg = (id: string | null | undefined) => (id ? CATALOG_BY_ID.get(id)?.renderConfig : undefined);
const color = (hex: unknown, fallback = '#ffffff') => new THREE.Color(String(hex ?? fallback)).convertSRGBToLinear();

function CoronaCosmetic({ id, radius, temperature }: { id: string; radius: number; temperature: number }) {
  const engine = useEngine();
  const c = cfg(id);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: coronaVertex,
        fragmentShader: CORONA_F,
        uniforms: {
          uLut: engine.shared.uLut,
          uTemp: { value: temperature },
          uTime: { value: 0 },
          uTight: { value: temperatureTightness(temperature) },
          uIntensity: { value: Number(c?.intensity ?? 1) },
          uBase: { value: 0 },
          uStyle: { value: CORONA_STYLE[String(c?.style)] ?? 1 },
          uTint: { value: color(c?.color).multiplyScalar(1.6) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [engine, temperature, c],
  );
  useFrame(() => {
    mat.uniforms.uTime!.value = engine.time;
  }, 0);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh scale={radius * 1.25} material={mat} renderOrder={7} userData={{ cosmetic: 'corona' }}>
      <planeGeometry args={[4, 4]} />
    </mesh>
  );
}

function AuraCosmetic({ id }: { id: string }) {
  const engine = useEngine();
  const c = cfg(id);
  const mats = useMemo(
    () =>
      [0, 1].map(
        (k) =>
          new THREE.ShaderMaterial({
            vertexShader: shellVertex,
            fragmentShader: SHELL_F,
            uniforms: {
              uColorA: { value: color(c?.colorA).multiplyScalar(0.8) },
              uColorB: { value: color(c?.colorB).multiplyScalar(0.8) },
              uTime: { value: k * 10 },
              uOpacity: { value: 0.55 - k * 0.2 },
              uShape: { value: AURA_SHAPE[String(c?.shape)] ?? 1 },
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          }),
      ),
    [c],
  );
  useFrame(() => {
    for (const [k, m] of mats.entries()) m.uniforms.uTime!.value = engine.time + k * 10;
  }, 0);
  useEffect(
    () => () => {
      for (const m of mats) m.dispose();
    },
    [mats],
  );
  return (
    <group userData={{ cosmetic: 'aura' }}>
      <mesh scale={22} material={mats[0]}>
        <sphereGeometry args={[1, 64, 32]} />
      </mesh>
      <mesh scale={28} material={mats[1]} rotation={[0.4, 1.2, 0]}>
        <sphereGeometry args={[1, 48, 24]} />
      </mesh>
    </group>
  );
}

function StarRingsCosmetic({ id, radius }: { id: string; radius: number }) {
  const c = cfg(id);
  const count = Number(c?.count ?? 1);
  const tilt = Number(c?.tilt ?? 0.4);
  const style = String(c?.style ?? 'band');
  const group = useRef<THREE.Group>(null);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: color(c?.color).multiplyScalar(style === 'accretion' ? 2.4 : 1.4),
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [c, style],
  );
  useFrame(() => {
    if (group.current) group.current.rotation.y = sceneTime() * (style === 'helix' ? 0.5 : 0.12);
  }, 0);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <group ref={group} userData={{ cosmetic: 'star_rings' }}>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} material={mat} rotation={[Math.PI / 2 + (i % 2 ? -tilt : tilt), i * 0.6, 0]} scale={radius * (1.9 + i * 0.35)}>
          <ringGeometry args={[style === 'band' ? 0.82 : 0.94, 1, 128]} />
        </mesh>
      ))}
    </group>
  );
}

function BannerSatellite({ text, radius, colorHex }: { text: string; radius: number; colorHex: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const a = sceneTime() * 0.25;
    const d = radius * 3 + 5;
    ref.current.position.set(Math.cos(a) * d, radius * 0.8, Math.sin(a) * d);
    ref.current.rotation.y = -a + Math.PI / 2;
  }, 0);
  return (
    <group ref={ref} userData={{ cosmetic: 'banner' }}>
      <mesh>
        <boxGeometry args={[0.5, 0.3, 0.3]} />
        <meshBasicMaterial color={new THREE.Color(0.8, 0.85, 0.95)} />
      </mesh>
      <Text
        font="/fonts/InterTight.ttf"
        position={[0, 0.7, 0]}
        fontSize={0.8}
        color={colorHex}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#03040a"
      >
        {text}
      </Text>
    </group>
  );
}

export function Cosmetics({
  cosmetics,
  radius,
  temperature,
  githubId,
}: {
  cosmetics: Record<string, string | null>;
  radius: number;
  temperature: number;
  githubId: number;
}) {
  const detail = useUniverse((s) => (s.focusDetail?.user.githubId === githubId ? s.focusDetail : null));
  const banner = detail?.social.bannerText;
  return (
    <group name="cosmetics">
      {cosmetics.corona && <CoronaCosmetic id={cosmetics.corona} radius={radius} temperature={temperature} />}
      {cosmetics.aura && <AuraCosmetic id={cosmetics.aura} />}
      {cosmetics.star_rings && <StarRingsCosmetic id={cosmetics.star_rings} radius={radius} />}
      {cosmetics.banner && banner && (
        <BannerSatellite text={banner} radius={radius} colorHex={String(cfg(cosmetics.banner)?.color ?? '#7cc4ff')} />
      )}
    </group>
  );
}
