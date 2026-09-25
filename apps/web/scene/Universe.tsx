'use client';
/**
 * The persistent 3D universe (mounted once in the root layout, so navigation between pages is a camera move, not a
 * reload). Lazy-loaded: this module and three.js live in the 3D chunk, never in the initial landing bundle.
 */
import type { StarDetail } from '@commitverse/contracts';
import type { Manifest } from '@commitverse/universe-core';
import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { Api } from '@/lib/client/api';
import { play } from '@/lib/client/audio';
import { subscribe } from '@/lib/client/realtime';
import { prefersReducedMotion, useSettings } from '@/lib/client/settings';
import { mark } from '@/lib/client/telemetry';
import { sceneCommands, useUniverse } from '@/stores/universe';
import { engineRef } from '@/lib/client/engine-ref';
import { EngineContext } from './context';
import { Engine } from './engine';
import { Constellations } from './far/Constellations';
import { Galaxies } from './far/Galaxies';
import { Labels } from './far/Labels';
import { Ships } from './multiplayer/Ships';
import { Comets } from './near/Comets';
import { CompareStage } from './near/CompareStage';
import { Neighbors } from './near/Neighbors';
import { Signals } from './near/Signals';
import { SupernovaFx } from './near/Supernova';
import { FocusedSystem } from './near/System';
import { detectTier } from './quality';
import { Replay } from './far/Replay';

function useFocusDetail() {
  const focus = useUniverse((s) => s.focus);
  useEffect(() => {
    if (focus?.kind !== 'star') {
      useUniverse.getState().set({ focusDetail: null });
      return;
    }
    let alive = true;
    const load = () =>
      Api.star(focus.login)
        .then((d: StarDetail) => {
          if (!alive) return;
          useUniverse.getState().set({ focusDetail: d });
          void Api.stats({ type: 'visit', starId: d.user.githubId });
        })
        .catch(() => {});
    void load();
    const off = subscribe('cosmic:global', (event, p) => {
      if ((event === 'equip' || event === 'beacon') && p.githubId === focus.githubId) void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [focus?.kind === 'star' ? focus.githubId : null, focus]);
}

function Root({ tilesBase }: { tilesBase: string }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const quality = useSettings((s) => s.quality);
  const bloom = useSettings((s) => s.bloom);
  const engine = useMemo(() => new Engine(gl, camera, quality === 'auto' ? 'high' : quality, tilesBase), [gl, camera, tilesBase]);
  const firstFrame = useRef(false);
  useFocusDetail();

  useEffect(() => {
    engineRef.current = engine;
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __cv?: Engine }).__cv = engine;
    return () => {
      engineRef.current = null;
      engine.dispose();
    };
  }, [engine]);

  // Quality tier: detect once (auto) or honour the forced tier; forced tiers disable adaptation.
  useEffect(() => {
    if (quality === 'auto') void detectTier().then((t) => engine.applyTier(t));
    else engine.applyTier(quality);
  }, [engine, quality]);
  useEffect(() => {
    engine.applyTier(engine.tier);
  }, [engine, bloom]);

  useEffect(() => {
    engine.post.composer.setSize(size.width, size.height);
  }, [engine, size]);

  // Universe manifest + delta
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const u = await Api.universe();
      const manifest = (await (await fetch(u.manifestUrl)).json()) as Manifest;
      if (!alive) return;
      engine.setManifest(manifest, u.deltaUrl, u.deltaEtag);
      useUniverse.getState().set({ manifest, bakeVersion: u.bakeVersion, deltaUrl: u.deltaUrl, starCount: u.starCount, webgl: 'ok' });
      mark('manifest');
    };
    void load().catch(() => setTimeout(() => void load(), 5000));
    const offs = [
      subscribe('cosmic:global', (event, p) => {
        if (event === 'bake' && p.bakeVersion !== useUniverse.getState().bakeVersion) void load();
        if (event === 'delta') engine.tiles.refreshDelta();
        if (event === 'hide' && typeof p.starIndex === 'number') engine.tiles.setHidden([p.starIndex], true);
      }),
    ];
    return () => {
      alive = false;
      for (const o of offs) o();
    };
  }, [engine]);

  // Tab hidden → stop the render loop.
  useEffect(() => {
    const onVis = () => setFrameloop(document.hidden ? 'never' : 'always');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [setFrameloop]);

  // Keyboard actions → scene commands / UI
  useEffect(() => {
    return engine.input.onKeyAction((action) => {
      const s = useUniverse.getState();
      switch (action) {
        case 'flight':
          sceneCommands.push({ type: 'flight', on: engine.rig.mode !== 'flight' });
          break;
        case 'galaxy': {
          const pos = s.focus?.kind === 'star' ? s.focus.position : ([engine.rig.target[0]!, engine.rig.target[1]!, engine.rig.target[2]!] as [number, number, number]);
          const g = engine.tiles.galaxyAt(pos) ?? s.manifest?.galaxies[0];
          if (g) sceneCommands.push({ type: 'galaxyView', galaxyId: g.id });
          break;
        }
        case 'supercluster':
          sceneCommands.push({ type: 'supercluster' });
          break;
        case 'warp':
          if (s.hover) sceneCommands.push({ type: 'warpTo', position: s.hover.position, radius: s.hover.brief?.radius ?? 3 });
          else if (s.focus?.kind === 'star') sceneCommands.push({ type: 'warpTo', position: s.focus.position, radius: s.focus.radius });
          break;
        case 'back_target': {
          const prev = s.history.at(-1);
          if (prev?.kind === 'star') {
            s.set({ focus: prev, history: s.history.slice(0, -1), panel: 'system' });
            sceneCommands.push({ type: 'warpTo', position: prev.position, radius: prev.radius });
          }
          break;
        }
        default:
          window.dispatchEvent(new CustomEvent('cv:action', { detail: action }));
      }
    });
  }, [engine]);

  engine.onFps = (fps) => {
    if (Math.abs(useUniverse.getState().fps - fps) >= 1) useUniverse.getState().set({ fps });
  };

  useFrame((_, dt) => engine.update(dt), -1);
  useFrame((_, dt) => {
    engine.render(dt);
    if (!firstFrame.current) {
      firstFrame.current = true;
      mark('first-frame');
      window.dispatchEvent(new Event('cv:first-frame'));
    }
    if (engine.rig.arrivalFlash > 0.95) play('arrive');
  }, 1);

  return (
    <EngineContext.Provider value={engine}>
      {createPortal(
        <>
          <Galaxies />
          <Labels />
          <Constellations />
          <Replay />
          <Comets />
          <Signals />
          <SupernovaFx />
        </>,
        engine.far,
      )}
      {createPortal(
        <>
          <FocusedSystemGate />
          <Neighbors />
          <CompareStage />
          <Ships />
        </>,
        engine.near,
      )}
      <IntentDriver engine={engine} />
    </EngineContext.Provider>
  );
}

function FocusedSystemGate() {
  const detail = useUniverse((s) => s.focusDetail);
  return detail ? <FocusedSystem key={detail.user.githubId} detail={detail} /> : null;
}

/** Applies the current page's scene intent once the manifest is loaded (hero drift, /@login warp, galaxy view…). */
function IntentDriver({ engine }: { engine: Engine }) {
  const intent = useUniverse((s) => s.intent);
  const manifest = useUniverse((s) => s.manifest);
  const applied = useRef<{ engine: Engine | null; key: string }>({ engine: null, key: '' });
  useEffect(() => {
    if (!manifest) return;
    const key = JSON.stringify(intent);
    if (applied.current.engine === engine && applied.current.key === key) return;
    const first = applied.current.engine !== engine;
    applied.current = { engine, key };
    const s = useUniverse.getState();
    switch (intent.type) {
      case 'hero': {
        const g = manifest.galaxies[0]!;
        if (first) {
          engine.rig.pos.set([g.center[0] + g.radius * 0.55, g.center[1] + g.radius * 0.12, g.center[2] + g.radius * 0.7]);
          engine.rig.orbitAround(g.center, g.radius, { kind: 'galaxy' });
          engine.rig.autoRotateSpeed = prefersReducedMotion() ? 0 : 0.15;
          engine.rig.idle = 30;
          s.set({ mode: 'galaxy', focus: null });
        }
        break;
      }
      case 'star': {
        // F2: warp starts as soon as the position resolves; the detail request runs in parallel.
        const detail = Api.star(intent.login);
        void Api.position(intent.login)
          .then(async (p) => {
            const pos: [number, number, number] = [p.x, p.y, p.z];
            sceneCommands.push({ type: 'warpTo', position: pos, radius: 3, instant: first, frame: 70 });
            useUniverse.getState().set({
              focus: { kind: 'star', githubId: p.githubId, login: intent.login, position: pos, radius: 3, temperature: 5000 },
              panel: 'system',
            });
            const d = await detail;
            const cur = useUniverse.getState().focus;
            if (cur?.kind === 'star' && cur.githubId === p.githubId) {
              useUniverse.getState().set({ focus: { ...cur, login: d.user.login, radius: d.body.radius, temperature: d.body.temperature }, focusDetail: d });
              const frame = Math.max(6 * d.body.radius, (d.planets.at(-1)?.orbitRadius ?? 10) * 1.7);
              if (engine.rig.mode !== 'warp') engine.rig.distGoal = frame;
              else if (engine.rig.warp) engine.rig.warp.arrivalDist = frame;
            }
            if (intent.planet) {
              const pl = d.planets.find((x) => x.name.toLowerCase() === intent.planet!.toLowerCase());
              if (pl) setTimeout(() => sceneCommands.push({ type: 'focusPlanet', slot: pl.slot }), first ? 400 : 3600);
            }
            if (intent.ignite) window.dispatchEvent(new CustomEvent('cv:ignite', { detail: p.githubId }));
          })
          .catch(() => window.dispatchEvent(new CustomEvent('cv:not-mapped', { detail: intent.login })));
        break;
      }
      case 'galaxy': {
        const g = manifest.galaxies.find((x) => x.language.toLowerCase() === intent.lang.toLowerCase() || String(x.id) === intent.lang);
        if (g) {
          if (first) engine.rig.pos.set([g.center[0] + g.radius * 1.6, g.center[1] + g.radius * 1.2, g.center[2] + g.radius * 1.2]);
          sceneCommands.push({ type: 'galaxyView', galaxyId: g.id });
        }
        break;
      }
      case 'view': {
        // exact shot: pose first, then (optionally) the focused star's panel without moving the camera
        sceneCommands.push({ type: 'setPose', pos: intent.camera.pos, quat: intent.camera.quat });
        const login = intent.camera.focus;
        if (login)
          void Promise.all([Api.position(login), Api.star(login)])
            .then(([p, d]) => {
              useUniverse.getState().set({
                focus: { kind: 'star', githubId: p.githubId, login: d.user.login, position: [p.x, p.y, p.z], radius: d.body.radius, temperature: d.body.temperature },
                focusDetail: d,
                panel: 'system',
              });
              engine.rig.orbitAround([p.x, p.y, p.z], d.body.radius, { kind: 'star' });
            })
            .catch(() => {});
        break;
      }
      case 'compare':
      case 'replay':
      case 'dim':
        break;
    }
  }, [intent, manifest, engine]);
  return null;
}

export default function Universe({ tilesBase }: { tilesBase: string }) {
  const listMode = useSettings((s) => s.listMode);
  const webgl = useUniverse((s) => s.webgl);
  const dim = useUniverse((s) => s.dim);
  useEffect(() => {
    const c = document.createElement('canvas');
    const ok = !!c.getContext('webgl2');
    if (!ok) useUniverse.getState().set({ webgl: 'unavailable' });
    // R3F measures its container once; when mounted lazily that first measurement can be missed — nudge it.
    const ids = [requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))), window.setTimeout(() => window.dispatchEvent(new Event('resize')), 300)];
    return () => {
      cancelAnimationFrame(ids[0]!);
      clearTimeout(ids[1]);
    };
  }, []);
  if (listMode || webgl === 'unavailable') return null;
  return (
    <div
      className="fixed inset-0 transition-opacity duration-500"
      style={{ opacity: dim ? 0.35 : 1 }}
      aria-hidden="true"
      data-testid="universe-canvas"
    >
      <Canvas
        flat
        dpr={1}
        gl={{ antialias: false, alpha: false, stencil: false, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }}
        camera={{ fov: 60, near: 10, far: 5e6, position: [0, 0, 0] }}
        frameloop="always"
        onCreated={({ gl }) => {
          gl.setClearColor(0x03040a, 1);
        }}
      >
        <Root tilesBase={tilesBase} />
      </Canvas>
    </div>
  );
}
