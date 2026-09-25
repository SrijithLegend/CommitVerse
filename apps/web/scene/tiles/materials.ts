/** Shared far-field point material factory. Per-node uniforms are separate; shared ones are the same {value} objects. */
import { CATALOG } from '@commitverse/contracts';
import { glsl, starPointsFragment, starPointsVertex } from '@commitverse/shaders';
import { blackbodyLUT } from '@commitverse/universe-core';
import * as THREE from 'three';

export interface SharedPointUniforms {
  uLut: { value: THREE.DataTexture };
  uHidden: { value: THREE.DataTexture };
  uHiddenRows: { value: number };
  uScale: { value: number };
  uPixelRatio: { value: number };
  uNearFade: { value: number };
  uCoronaColors: { value: THREE.Color[] };
  uFocusIndex: { value: number };
  uClassMask: { value: number };
}

export function createLut(): THREE.DataTexture {
  const t = new THREE.DataTexture(blackbodyLUT(), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export const HIDDEN_WIDTH = 4096;

export function createHiddenTexture(rows = 1): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(HIDDEN_WIDTH * rows), HIDDEN_WIDTH, rows, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export function coronaPalette(): THREE.Color[] {
  const colors = CATALOG.filter((i) => i.slot === 'corona').map((i) => new THREE.Color(String(i.renderConfig.color ?? '#ffffff')).multiplyScalar(0.6));
  while (colors.length < 16) colors.push(new THREE.Color(0, 0, 0));
  return colors.slice(0, 16);
}

export function createShared(): SharedPointUniforms {
  return {
    uLut: { value: createLut() },
    uHidden: { value: createHiddenTexture() },
    uHiddenRows: { value: 0 },
    uScale: { value: 3000 },
    uPixelRatio: { value: 1 },
    uNearFade: { value: 300 },
    uCoronaColors: { value: coronaPalette() },
    uFocusIndex: { value: -1 },
    uClassMask: { value: 127 },
  };
}

const vertex = glsl(starPointsVertex);
const fragment = glsl(starPointsFragment);

export function createPointMaterial(shared: SharedPointUniforms, aabb: ArrayLike<number>, opts: { ignoreHidden?: boolean } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      ...shared,
      uHiddenRows: opts.ignoreHidden ? { value: 0 } : shared.uHiddenRows,
      uOffset: { value: new THREE.Vector3() },
      uMin: { value: new THREE.Vector3(aabb[0], aabb[1], aabb[2]) },
      uMax: { value: new THREE.Vector3(aabb[3], aabb[4], aabb[5]) },
      uFade: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
}

export interface PointArrays {
  pos: Int16Array;
  props: Uint8Array;
  cosmetic: Uint16Array;
  index: Uint32Array;
  count: number;
}

/**
 * Geometry built directly on typed arrays from the worker — no per-point JS objects, ever (§6.5). The arrays stay
 * referenced by the attributes, so GPU buffers can be rebuilt after a WebGL context loss without refetching.
 */
export function createPointGeometry(a: PointArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.pos, 3, false));
  g.setAttribute('aProps', new THREE.BufferAttribute(a.props, 4, false));
  g.setAttribute('aCosmetic', new THREE.BufferAttribute(a.cosmetic, 1, false));
  g.setAttribute('aIndex', new THREE.BufferAttribute(a.index, 1, false));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY);
  g.setDrawRange(0, a.count);
  return g;
}
