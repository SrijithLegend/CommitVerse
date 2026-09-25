'use client';
/**
 * §5.4 in-canvas SDF labels (troika-three-text): screen-space sized, faded by distance and priority
 * (hypergiants > claimed > online > others), ≤ 60 visible, collision-culled on a screen grid. Galaxy names in
 * wide-tracked caps at galaxy/supercluster scale.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
// @ts-expect-error troika-three-text ships no types
import { Text } from 'troika-three-text';
import { cachedBrief, brief } from '@/lib/client/positions';
import { useSettings } from '@/lib/client/settings';
import { type Vec3d, useUniverse } from '@/stores/universe';
import { useEngine } from '../context';

const MAX = 60;
const FONT = '/fonts/InterTight.ttf';
const MONO = '/fonts/JetBrainsMono.ttf';

interface Slot {
  text: InstanceType<typeof Text>;
  world: Vec3d | null;
  id: number;
  alpha: number;
  target: number;
}

export function Labels() {
  const engine = useEngine();
  const show = useSettings((s) => s.labels);
  const manifest = useUniverse((s) => s.manifest);
  const group = useMemo(() => new THREE.Group(), []);
  const slots = useRef<Slot[]>([]);
  const galaxyTexts = useRef<{ text: InstanceType<typeof Text>; world: Vec3d; radius: number }[]>([]);
  const busy = useRef(false);
  const last = useRef(0);

  useEffect(() => {
    for (let i = 0; i < MAX; i++) {
      const t = new Text();
      t.font = FONT;
      t.fontSize = 1;
      t.color = 0xe8ecf6;
      t.anchorX = 'left';
      t.anchorY = 'middle';
      t.outlineWidth = 0.08;
      t.outlineColor = 0x03040a;
      t.outlineOpacity = 0.6;
      t.material.depthTest = false;
      t.material.transparent = true;
      t.renderOrder = 20;
      t.visible = false;
      group.add(t);
      slots.current.push({ text: t, world: null, id: 0, alpha: 0, target: 0 });
    }
    return () => {
      for (const s of slots.current) s.text.dispose();
      slots.current = [];
    };
  }, [group]);

  useEffect(() => {
    for (const g of galaxyTexts.current) {
      group.remove(g.text);
      g.text.dispose();
    }
    galaxyTexts.current = [];
    if (!manifest) return;
    for (const g of manifest.galaxies) {
      const t = new Text();
      t.font = MONO;
      t.text = g.language.toUpperCase().split('').join(' ');
      t.fontSize = 1;
      t.letterSpacing = 0.12;
      t.color = 0x9aa4bd;
      t.anchorX = 'center';
      t.anchorY = 'middle';
      t.material.depthTest = false;
      t.material.transparent = true;
      t.renderOrder = 19;
      t.sync();
      group.add(t);
      galaxyTexts.current.push({ text: t, world: [g.center[0], g.center[1] + g.radius * 0.12, g.center[2]], radius: g.radius });
    }
  }, [manifest, group]);

  useFrame(() => {
    const now = performance.now();
    const cam = engine.rig.pos;
    const q = engine.farCam.quaternion;
    group.visible = show;
    if (!show) return;
    const pxScale = (2 * Math.tan(THREE.MathUtils.degToRad(engine.farCam.fov) / 2)) / Math.max(1, engine.renderer.domElement.clientHeight);

    // refresh candidates twice a second
    if (!busy.current && now - last.current > 500) {
      busy.current = true;
      last.current = now;
      const el = engine.renderer.domElement;
      const vp = new THREE.Matrix4().multiplyMatrices(engine.farCam.projectionMatrix, engine.farCam.matrixWorldInverse);
      void engine.tiles
        .labels(cam, vp, el.clientWidth, el.clientHeight, 180)
        .then(async (cands) => {
          const grid = new Set<string>();
          const chosen: typeof cands = [];
          for (const c of cands) {
            const k = `${Math.floor(c.x / 150)}:${Math.floor(c.y / 22)}`;
            if (grid.has(k)) continue;
            grid.add(k);
            chosen.push(c);
            if (chosen.length >= MAX) break;
          }
          await Promise.all(chosen.map((c) => brief(c.h.githubId)));
          const keep = new Map(chosen.map((c) => [c.h.githubId, c]));
          // retire slots no longer wanted
          for (const s of slots.current) if (s.id && !keep.has(s.id)) s.target = 0;
          for (const c of chosen) {
            let s = slots.current.find((x) => x.id === c.h.githubId);
            if (!s) s = slots.current.find((x) => x.alpha <= 0.01 && x.target === 0);
            if (!s) continue;
            const b = cachedBrief(c.h.githubId);
            if (!b) continue;
            if (s.id !== c.h.githubId) {
              s.id = c.h.githubId;
              s.text.text = `@${b.login}  ${b.spectralClass}`;
              s.text.color = c.prio === 4 ? 0xfff2d8 : c.prio === 3 ? 0xe8ecf6 : 0x9aa4bd;
              s.text.sync();
            }
            s.world = c.h.position;
            s.target = c.prio >= 3 ? 1 : 0.7;
          }
        })
        .finally(() => {
          busy.current = false;
        });
    }

    for (const s of slots.current) {
      s.alpha += (s.target - s.alpha) * 0.12;
      if (!s.world || s.alpha < 0.01) {
        s.text.visible = false;
        if (s.target === 0) s.id = 0;
        continue;
      }
      const x = s.world[0] - cam[0]!;
      const y = s.world[1] - cam[1]!;
      const z = s.world[2] - cam[2]!;
      const dist = Math.hypot(x, y, z);
      s.text.visible = true;
      s.text.position.set(x, y, z);
      s.text.quaternion.copy(q);
      const k = dist * pxScale * 12; // ~12 px tall
      s.text.scale.setScalar(k);
      s.text.position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(q), k * 0.9);
      s.text.fillOpacity = s.alpha;
      s.text.outlineOpacity = s.alpha * 0.6;
    }

    for (const g of galaxyTexts.current) {
      const x = g.world[0] - cam[0]!;
      const y = g.world[1] - cam[1]!;
      const z = g.world[2] - cam[2]!;
      const dist = Math.hypot(x, y, z);
      const vis = THREE.MathUtils.smoothstep(dist / g.radius, 1.2, 2.2);
      g.text.visible = vis > 0.01;
      g.text.position.set(x, y, z);
      g.text.quaternion.copy(q);
      g.text.scale.setScalar(dist * pxScale * 13);
      g.text.fillOpacity = vis * 0.9;
    }
  });

  return <primitive object={group} />;
}
