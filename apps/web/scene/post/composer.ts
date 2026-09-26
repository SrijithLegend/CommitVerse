/**
 * §5.3 post stack: layers (far → clear depth → near) → lensing (High+) → bloom (HDR, threshold 1.0) →
 * warp streaks / chromatic aberration → AgX tone mapping → vignette 0.25 + grain 0.03 → SMAA (FXAA on Low).
 */
import { lensingFragment, warpFragment } from '@commitverse/shaders';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  NoiseEffect,
  Pass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import type { QualityTier } from '@/lib/client/settings';

/** §6.3: render the far layer, clear depth, then the near layer — two cameras sharing one pose. */
export class LayeredRenderPass extends Pass {
  constructor(
    private far: THREE.Scene,
    private farCam: THREE.Camera,
    private near: THREE.Scene,
    private nearCam: THREE.Camera,
  ) {
    super('LayeredRenderPass');
    this.needsSwap = false;
  }
  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget | null) {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer);
    renderer.clear(true, true, true);
    renderer.render(this.far, this.farCam);
    renderer.clearDepth();
    renderer.render(this.near, this.nearCam);
    renderer.autoClear = autoClear;
  }
}

export class LensingEffect extends Effect {
  constructor() {
    super('LensingEffect', lensingFragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['uRs', new THREE.Uniform(0)],
        ['uAspect', new THREE.Uniform(1)],
        ['uStrength', new THREE.Uniform(0)],
        ['uPhotonRing', new THREE.Uniform(1)],
      ]),
    });
  }
  set(center: THREE.Vector2, rs: number, aspect: number, strength: number, photonRing: boolean) {
    const u = this.uniforms;
    (u.get('uCenter')!.value as THREE.Vector2).copy(center);
    u.get('uRs')!.value = rs;
    u.get('uAspect')!.value = aspect;
    u.get('uStrength')!.value = strength;
    u.get('uPhotonRing')!.value = photonRing ? 1 : 0;
  }
}

export class WarpEffect extends Effect {
  constructor() {
    super('WarpEffect', warpFragment, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['uAmount', new THREE.Uniform(0)],
        ['uAberration', new THREE.Uniform(0)],
        ['uFlash', new THREE.Uniform(0)],
        ['uStyle', new THREE.Uniform(0)],
        ['uTime', new THREE.Uniform(0)],
      ]),
    });
  }
  set(amount: number, flash: number, style: number, time: number) {
    const u = this.uniforms;
    u.get('uAmount')!.value = amount;
    u.get('uAberration')!.value = 0.006 * Math.sin(Math.min(1, amount) * Math.PI * 0.5);
    u.get('uFlash')!.value = flash;
    u.get('uStyle')!.value = style;
    u.get('uTime')!.value = time;
  }
}

export interface PostStack {
  composer: EffectComposer;
  bloom: BloomEffect;
  lensing: LensingEffect;
  warp: WarpEffect;
  lensPass: EffectPass;
  bloomPass: EffectPass;
  warpPass: EffectPass;
  setTier(tier: QualityTier, bloomOn: boolean): void;
  dispose(): void;
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  far: THREE.Scene,
  farCam: THREE.PerspectiveCamera,
  near: THREE.Scene,
  nearCam: THREE.PerspectiveCamera,
  tier: QualityTier,
): PostStack {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new LayeredRenderPass(far, farCam, near, nearCam));

  const lensing = new LensingEffect();
  const lensPass = new EffectPass(farCam, lensing);
  composer.addPass(lensPass);

  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.2, intensity: 0.9, radius: 0.75 });
  const bloomPass = new EffectPass(farCam, bloom);
  composer.addPass(bloomPass);

  const warp = new WarpEffect();
  const warpPass = new EffectPass(farCam, warp);
  composer.addPass(warpPass);

  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const vignette = new VignetteEffect({ darkness: 0.25, offset: 0.35 });
  const noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.ADD });
  noise.blendMode.opacity.value = 0.03;
  composer.addPass(new EffectPass(farCam, tone, vignette, noise));

  let aaPass: EffectPass | null = null;
  const stack: PostStack = {
    composer,
    bloom,
    lensing,
    warp,
    lensPass,
    bloomPass,
    warpPass,
    setTier(t, bloomOn) {
      bloom.resolution.scale = t === 'low' || t === 'medium' ? 0.5 : 1;
      const mip = (bloom as unknown as { mipmapBlurPass?: { levels: number } }).mipmapBlurPass;
      if (mip) mip.levels = t === 'low' ? 4 : t === 'medium' ? 5 : t === 'high' ? 6 : 7;
      bloomPass.enabled = bloomOn;
      lensPass.enabled = t === 'high' || t === 'ultra';
      if (aaPass) {
        composer.removePass(aaPass);
        aaPass.dispose();
      }
      aaPass = new EffectPass(
        farCam,
        t === 'low' ? new FXAAEffect() : new SMAAEffect({ preset: t === 'ultra' ? SMAAPreset.ULTRA : SMAAPreset.HIGH }),
      );
      composer.addPass(aaPass);
    },
    dispose() {
      composer.dispose();
    },
  };
  stack.setTier(tier, true);
  return stack;
}
