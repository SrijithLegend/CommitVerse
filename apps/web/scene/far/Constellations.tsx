'use client';
/** §3.5 overlay (toggle C): org constellations (MST lines + name at the centroid) and binary-star filaments. */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
// @ts-expect-error troika-three-text ships no types
import { Text } from 'troika-three-text';
import { api } from '@/lib/client/api';
import { useSettings } from '@/lib/client/settings';
import { type Vec3d, useUniverse } from '@/stores/universe';
import { useEngine } from '../context';

interface ConstellationDto {
  org: string;
  name: string | null;
  members: { githubId: number; login: string; position: Vec3d }[];
  edges: [number, number][];
}
interface OverlayDto {
  constellations: ConstellationDto[];
  binaries: { a: string; b: string; from: Vec3d; to: Vec3d }[];
}

export function Constellations() {
  const engine = useEngine();
  const on = useSettings((s) => s.constellations);
  const org = useUniverse((s) => s.constellationOrg);
  const focus = useUniverse((s) => s.focus);
  const [data, setData] = useState<OverlayDto | null>(null);
  const galaxyId = focus?.kind === 'galaxy' ? focus.galaxyId : focus?.kind === 'star' ? engine.tiles.galaxyAt(focus.position)?.id : undefined;

  useEffect(() => {
    if (!on && !org) {
      setData(null);
      return;
    }
    const q = org ? `org=${encodeURIComponent(org)}` : galaxyId ? `galaxy=${galaxyId}` : '';
    let alive = true;
    api<OverlayDto>(`constellations?${q}`)
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [on, org, galaxyId]);

  // One reference origin (float64) for all line vertices; the group follows it camera-relative every frame.
  const built = useMemo(() => {
    if (!data) return null;
    const ref: Vec3d = data.constellations[0]?.members[0]?.position ?? data.binaries[0]?.from ?? [0, 0, 0];
    const rel = (p: Vec3d) => [p[0] - ref[0], p[1] - ref[1], p[2] - ref[2]];
    const lines: number[] = [];
    const texts: InstanceType<typeof Text>[] = [];
    const anchors: Vec3d[] = [];
    for (const c of data.constellations) {
      for (const [a, b] of c.edges) lines.push(...rel(c.members[a]!.position), ...rel(c.members[b]!.position));
      const n = c.members.length;
      const centroid: Vec3d = [0, 0, 0];
      for (const m of c.members) for (let i = 0; i < 3; i++) centroid[i]! += m.position[i]! / n;
      const t = new Text();
      t.font = '/fonts/InterTight.ttf';
      t.text = c.name ?? c.org;
      t.fontSize = 1;
      t.color = 0x7cc4ff;
      t.anchorX = 'center';
      t.material.depthTest = false;
      t.renderOrder = 21;
      t.sync();
      texts.push(t);
      anchors.push(centroid);
    }
    const bin: number[] = [];
    for (const b of data.binaries) bin.push(...rel(b.from), ...rel(b.to));
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    const binGeo = new THREE.BufferGeometry();
    binGeo.setAttribute('position', new THREE.Float32BufferAttribute(bin, 3));
    return {
      ref,
      lines: new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(0.49, 0.77, 1.0), transparent: true, opacity: 0.45, depthWrite: false })),
      binaries: new THREE.LineSegments(binGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(2.0, 1.6, 2.4), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })),
      texts,
      anchors,
    };
  }, [data]);

  useEffect(
    () => () => {
      if (!built) return;
      built.lines.geometry.dispose();
      built.binaries.geometry.dispose();
      for (const t of built.texts) t.dispose();
    },
    [built],
  );

  const group = useMemo(() => new THREE.Group(), []);
  useEffect(() => {
    group.clear();
    if (built) group.add(built.lines, built.binaries, ...built.texts);
  }, [group, built]);

  useFrame(() => {
    if (!built) return;
    const p = engine.rig.pos;
    built.lines.position.set(built.ref[0] - p[0]!, built.ref[1] - p[1]!, built.ref[2] - p[2]!);
    built.binaries.position.copy(built.lines.position);
    const pxScale = (2 * Math.tan(THREE.MathUtils.degToRad(engine.farCam.fov) / 2)) / Math.max(1, engine.renderer.domElement.clientHeight);
    built.texts.forEach((t, i) => {
      const a = built.anchors[i]!;
      t.position.set(a[0] - p[0]!, a[1] - p[1]!, a[2] - p[2]!);
      t.quaternion.copy(engine.farCam.quaternion);
      t.scale.setScalar(t.position.length() * pxScale * 14);
    });
  });

  return <primitive object={group} />;
}
