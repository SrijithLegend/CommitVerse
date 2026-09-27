'use client';
import { diskFragment, diskVertex, dustFragment, dustVertex, glsl, impostorFragment, impostorVertex } from '@commitverse/shaders';
/**
 * §5.3 galaxies: impostors rendered once from above into a render target (1024², Ultra 2048²), cross-faded with the
 * real points by distance; dust lanes (darkening) along arm inner edges; HII regions and blue young clusters along
 * leading edges; a supermassive black hole with an accretion disk at every core; bulge glow.
 */
import type { ManifestGalaxy } from '@commitverse/universe-core';
import { gaussian, hash32, mulberry32 } from '@commitverse/universe-core';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useSettings } from '@/lib/client/settings';
import { useUniverse } from '@/stores/universe';
import { useCameraRelative, useEngine } from '../context';
import { TIERS } from '../quality';
import { createPointMaterial } from '../tiles/materials';

const DUST_F = glsl(dustFragment);
const DISK_F = glsl(diskFragment);

const tiltQuat = (g: ManifestGalaxy) => new THREE.Quaternion(g.tilt[0], g.tilt[1], g.tilt[2], g.tilt[3]);

/** Procedural dust/HII/young-cluster sprites following the galaxy's own spiral parameters (seeded, galaxy-local). */
function buildDust(g: ManifestGalaxy, count: number): THREE.BufferGeometry {
  const rng = mulberry32(hash32(g.language) ^ 0xd057);
  const pos = new Float32Array(count * 3);
  const data = new Float32Array(count * 4);
  const core = g.coreRadius;
  for (let i = 0; i < count; i++) {
    const kindRoll = rng();
    const kind = kindRoll < 0.72 ? 0 : kindRoll < 0.9 ? 1 : 2;
    const r = core + (g.radius - core) * rng() ** 0.8;
    const arm = Math.floor(rng() * Math.max(1, g.arms));
    const spiral = Math.log(r / core) / Math.tan(g.pitch);
    const edge = kind === 0 ? -0.12 : 0.1; // dust on inner edges, HII/young clusters on leading edges
    const theta = (arm / Math.max(1, g.arms)) * Math.PI * 2 + spiral + edge + gaussian(rng) * 0.1;
    const y = gaussian(rng) * g.thickness * 0.4;
    pos.set([r * Math.cos(theta), y, r * Math.sin(theta)], i * 3);
    const size = kind === 0 ? 30 + rng() * 60 : kind === 1 ? 8 + rng() * 14 : 10 + rng() * 18;
    data.set([size * (g.radius / 6000) ** 0.5, kind, rng(), kind === 0 ? 0.35 + rng() * 0.5 : 0.4 + rng() * 0.6], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aData', new THREE.BufferAttribute(data, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY);
  return geo;
}

function dustMaterials(tilt: THREE.Matrix3) {
  const common = {
    vertexShader: dustVertex,
    fragmentShader: DUST_F,
    transparent: true,
    depthWrite: false,
  };
  const uniforms = () => ({
    uOffset: { value: new THREE.Vector3() },
    uTilt: { value: tilt },
    uPixelRatio: { value: 1 },
    uFade: { value: 1 },
  });
  const dark = new THREE.ShaderMaterial({
    ...common,
    uniforms: uniforms(),
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const glow = new THREE.ShaderMaterial({ ...common, uniforms: uniforms(), blending: THREE.AdditiveBlending });
  return { dark, glow };
}

function BlackHole({ g }: { g: ManifestGalaxy }) {
  const engine = useEngine();
  const ref = useRef<THREE.Group>(null);
  const rs = g.coreRadius * 0.012;
  const disk = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: diskVertex,
        fragmentShader: DISK_F,
        uniforms: { uInner: { value: rs * 3 }, uOuter: { value: rs * 16 }, uTime: { value: 0 }, uIntensity: { value: 1.6 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [rs],
  );
  const bulge = useMemo(
    () =>
      new THREE.SpriteMaterial({
        color: new THREE.Color(2.2, 1.8, 1.2),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        map: bulgeTexture(),
      }),
    [],
  );
  useCameraRelative(ref, () => g.center);
  useEffect(() => {
    const entry = { position: g.center, rs };
    engine.blackHoles.push(entry);
    return () => {
      engine.blackHoles = engine.blackHoles.filter((b) => b !== entry);
      disk.dispose();
      bulge.dispose();
    };
  }, [engine, g, rs, disk, bulge]);
  useFrame(() => {
    disk.uniforms.uTime!.value = engine.time;
    // The bulge is a camera-facing billboard (half-size 1.6 core radii): once the camera is inside it, it would wash the
    // whole view in a flat glow and drown star colours. Fade it out there; the bulge's stars carry the brightness.
    const p = engine.rig.pos;
    const dc = Math.hypot(p[0]! - g.center[0], p[1]! - g.center[1], p[2]! - g.center[2]) / g.coreRadius;
    bulge.opacity = THREE.MathUtils.smoothstep(dc, 1.6, 4);
  }, 0);
  const q = tiltQuat(g);
  return (
    <group ref={ref} quaternion={q}>
      <sprite material={bulge} scale={g.coreRadius * 3.2} />
      <mesh material={disk} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[rs * 3, rs * 16, 128, 4]} />
      </mesh>
      <mesh renderOrder={10}>
        <sphereGeometry args={[rs, 32, 16]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
    </group>
  );
}

let bulgeTex: THREE.Texture | null = null;
function bulgeTexture(): THREE.Texture {
  if (bulgeTex) return bulgeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,245,220,1)');
  grad.addColorStop(0.15, 'rgba(255,225,170,0.55)');
  grad.addColorStop(0.5, 'rgba(255,200,140,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  bulgeTex = new THREE.CanvasTexture(c);
  bulgeTex.colorSpace = THREE.SRGBColorSpace;
  return bulgeTex;
}

function Galaxy({ g, dustCount, impostorSize }: { g: ManifestGalaxy; dustCount: number; impostorSize: number }) {
  const engine = useEngine();
  const gl = useThree((s) => s.gl);
  const showDust = useSettings((s) => s.dust);
  const imp = useRef<THREE.Mesh>(null);
  const dustRef = useRef<THREE.Group>(null);
  const q = useMemo(() => tiltQuat(g), [g]);
  const qImp = useMemo(() => q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)), [q]);
  const tiltM3 = useMemo(() => new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)), [q]);
  const dustGeo = useMemo(() => (g.form === 'spiral' && dustCount > 0 ? buildDust(g, dustCount) : null), [g, dustCount]);
  const mats = useMemo(() => dustMaterials(tiltM3), [tiltM3]);
  const [rt, setRt] = useState<THREE.WebGLRenderTarget | null>(null);
  const impMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: impostorVertex,
        fragmentShader: impostorFragment,
        uniforms: {
          uMap: { value: null },
          uHasMap: { value: 0 },
          uBulge: { value: new THREE.Color(1.0, 0.85, 0.6) },
          uFade: { value: 0 },
          uArms: { value: g.arms },
          uPitch: { value: g.pitch },
          uColor: { value: new THREE.Color(g.color).convertSRGBToLinear() },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [g],
  );

  // Render the impostor once, when the galaxy's root tile arrives.
  useEffect(() => {
    const prev = engine.tiles.onRootLoaded;
    const handler = (galaxyId: number, pts: THREE.Points) => {
      prev?.(galaxyId, pts);
      if (galaxyId !== g.id) return;
      const target = new THREE.WebGLRenderTarget(impostorSize, impostorSize, { type: THREE.HalfFloatType });
      const cam = new THREE.OrthographicCamera(-g.radius * 1.1, g.radius * 1.1, g.radius * 1.1, -g.radius * 1.1, 1, g.radius * 6);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      cam.up.copy(forward.negate());
      cam.position.set(0, 0, 0);
      cam.lookAt(up.clone().negate());
      cam.updateMatrixWorld();
      const eye = up.clone().multiplyScalar(g.radius * 3);
      const scene = new THREE.Scene();
      const mat = createPointMaterial(engine.shared, [
        (pts.material as THREE.ShaderMaterial).uniforms.uMin!.value.x,
        (pts.material as THREE.ShaderMaterial).uniforms.uMin!.value.y,
        (pts.material as THREE.ShaderMaterial).uniforms.uMin!.value.z,
        (pts.material as THREE.ShaderMaterial).uniforms.uMax!.value.x,
        (pts.material as THREE.ShaderMaterial).uniforms.uMax!.value.y,
        (pts.material as THREE.ShaderMaterial).uniforms.uMax!.value.z,
      ]);
      (mat.uniforms.uOffset!.value as THREE.Vector3).copy(eye).negate();
      mat.uniforms.uFade!.value = 1;
      const nearFade = engine.shared.uNearFade.value;
      const scale = engine.shared.uScale.value;
      engine.shared.uNearFade.value = 0;
      engine.shared.uScale.value = scale * 6;
      const clone = new THREE.Points(pts.geometry, mat);
      clone.frustumCulled = false;
      scene.add(clone);
      if (dustGeo) {
        const d = dustMaterials(tiltM3);
        for (const m of [d.dark, d.glow]) (m.uniforms.uOffset!.value as THREE.Vector3).copy(eye).negate();
        scene.add(new THREE.Points(dustGeo, d.glow), new THREE.Points(dustGeo, d.dark));
      }
      const prevTarget = gl.getRenderTarget();
      gl.setRenderTarget(target);
      gl.setClearColor(0x000000, 1);
      gl.clear();
      gl.render(scene, cam);
      gl.setRenderTarget(prevTarget);
      engine.shared.uNearFade.value = nearFade;
      engine.shared.uScale.value = scale;
      mat.dispose();
      setRt(target);
    };
    engine.tiles.onRootLoaded = handler;
    return () => {
      engine.tiles.onRootLoaded = prev;
    };
  }, [engine, g, gl, impostorSize, q, dustGeo, tiltM3]);

  useEffect(() => {
    impMat.uniforms.uMap!.value = rt?.texture ?? null;
    impMat.uniforms.uHasMap!.value = rt ? 1 : 0;
  }, [rt, impMat]);
  useEffect(
    () => () => {
      rt?.dispose();
      impMat.dispose();
      dustGeo?.dispose();
      mats.dark.dispose();
      mats.glow.dispose();
    },
    [rt, impMat, dustGeo, mats],
  );

  useCameraRelative(imp, () => g.center);
  useFrame(() => {
    const p = engine.rig.pos;
    const d = Math.hypot(p[0]! - g.center[0], p[1]! - g.center[1], p[2]! - g.center[2]) / g.radius;
    impMat.uniforms.uFade!.value = THREE.MathUtils.smoothstep(d, 1.7, 2.8) * 0.9;
    const pointsFade = engine.tiles.galaxyFade.get(g.id) ?? 1;
    const dr = engine.shared.uPixelRatio.value;
    for (const m of [mats.dark, mats.glow]) {
      (m.uniforms.uOffset!.value as THREE.Vector3).set(g.center[0] - p[0]!, g.center[1] - p[1]!, g.center[2] - p[2]!);
      m.uniforms.uFade!.value = pointsFade * (showDust ? 1 : 0);
      m.uniforms.uPixelRatio!.value = dr;
    }
    if (dustRef.current) dustRef.current.visible = showDust && pointsFade > 0.01;
  }, 0);

  return (
    <>
      <mesh ref={imp} material={impMat} quaternion={qImp} renderOrder={0}>
        <planeGeometry args={[g.radius * 2.2, g.radius * 2.2]} />
      </mesh>
      {dustGeo && (
        <group ref={dustRef}>
          <points geometry={dustGeo} material={mats.glow} frustumCulled={false} renderOrder={2} />
          <points geometry={dustGeo} material={mats.dark} frustumCulled={false} renderOrder={3} />
        </group>
      )}
      <BlackHole g={g} />
    </>
  );
}

export function Galaxies() {
  const manifest = useUniverse((s) => s.manifest);
  const tier = useUniverse((s) => s.tier);
  if (!manifest) return null;
  const cfg = TIERS[tier];
  const total = manifest.galaxies.reduce((s, g) => s + (g.form === 'spiral' ? g.population : 0), 0) || 1;
  return (
    <>
      {manifest.galaxies.map((g) => (
        <Galaxy
          key={g.id}
          g={g}
          dustCount={g.form === 'spiral' ? Math.max(400, Math.round((cfg.dust * g.population) / total)) : 0}
          impostorSize={tier === 'ultra' ? 2048 : 1024}
        />
      ))}
    </>
  );
}
