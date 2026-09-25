/**
 * §5.5 sound — 100 % procedural Web Audio (no asset files). Off until the first user gesture (autoplay rules) and
 * until the viewer enables it. Ambient drone (2 detuned oscillators + filtered noise + slow LFO) whose key shifts by
 * galaxy; a proximity hum whose pitch maps to the nearest star's temperature; glassy UI clicks; warp whoosh + thump;
 * supernova swell + crack.
 */
import { useSettings } from './settings';

let ctx: AudioContext | null = null;
let master: GainNode;
let ambienceBus: GainNode;
let uiBus: GainNode;
let drone: { a: OscillatorNode; b: OscillatorNode; filter: BiquadFilterNode } | null = null;
let hum: { osc: OscillatorNode; gain: GainNode } | null = null;
let noiseBuffer: AudioBuffer | null = null;

function applyVolumes() {
  if (!ctx) return;
  const a = useSettings.getState().audio;
  const on = a.enabled ? 1 : 0;
  master.gain.setTargetAtTime(a.master * on, ctx.currentTime, 0.2);
  ambienceBus.gain.setTargetAtTime(a.ambience, ctx.currentTime, 0.2);
  uiBus.gain.setTargetAtTime(a.ui, ctx.currentTime, 0.05);
}

function noise(): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const len = ctx!.sampleRate * 2;
  noiseBuffer = ctx!.createBuffer(1, len, ctx!.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

export function initAudio() {
  if (ctx || typeof window === 'undefined') return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  ambienceBus = ctx.createGain();
  ambienceBus.connect(master);
  uiBus = ctx.createGain();
  uiBus.connect(master);

  // Drone
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  filter.Q.value = 0.7;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.05;
  filter.connect(droneGain).connect(ambienceBus);
  const a = ctx.createOscillator();
  const b = ctx.createOscillator();
  a.type = 'sawtooth';
  b.type = 'sawtooth';
  a.frequency.value = 55;
  b.frequency.value = 55 * 1.003;
  a.connect(filter);
  b.connect(filter);
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.05;
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain).connect(filter.frequency);
  const n = ctx.createBufferSource();
  n.buffer = noise();
  n.loop = true;
  const nf = ctx.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = 700;
  nf.Q.value = 0.4;
  const ng = ctx.createGain();
  ng.gain.value = 0.012;
  n.connect(nf).connect(ng).connect(ambienceBus);
  a.start();
  b.start();
  lfo.start();
  n.start();
  drone = { a, b, filter };

  // Proximity hum
  const hosc = ctx.createOscillator();
  hosc.type = 'sine';
  const hgain = ctx.createGain();
  hgain.gain.value = 0;
  hosc.connect(hgain).connect(ambienceBus);
  hosc.start();
  hum = { osc: hosc, gain: hgain };

  applyVolumes();
  useSettings.subscribe(applyVolumes);
}

/** Call from a user gesture handler. */
export function unlockAudio() {
  initAudio();
  void ctx?.resume();
}

const KEYS = [55, 58.27, 61.74, 65.41, 49, 51.91, 46.25, 43.65];
export function setAmbienceKey(galaxy: string | null) {
  if (!ctx || !drone) return;
  let h = 0;
  for (const c of galaxy ?? '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const f = KEYS[h % KEYS.length]!;
  drone.a.frequency.setTargetAtTime(f, ctx.currentTime, 1.5);
  drone.b.frequency.setTargetAtTime(f * 1.003, ctx.currentTime, 1.5);
}

/** Proximity hum: pitch maps to temperature (cool = low, hot = high); strength 0..1 by distance. */
export function setProximity(temperature: number | null, strength: number) {
  if (!ctx || !hum) return;
  const t = temperature ? Math.log(temperature / 2400) / Math.log(40000 / 2400) : 0;
  hum.osc.frequency.setTargetAtTime(90 + t * 520, ctx.currentTime, 0.3);
  hum.gain.gain.setTargetAtTime(temperature ? Math.max(0, Math.min(1, strength)) * 0.06 : 0, ctx.currentTime, 0.3);
}

export function play(name: 'click' | 'warp' | 'arrive' | 'supernova' | 'signal') {
  if (!ctx || !useSettings.getState().audio.enabled) return;
  const t = ctx.currentTime;
  const out = uiBus;
  const env = (g: GainNode, attack: number, peak: number, decay: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  if (name === 'click' || name === 'signal') {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(name === 'click' ? 2400 : 1200, t);
    o.frequency.exponentialRampToValueAtTime(name === 'click' ? 1600 : 2400, t + 0.06);
    env(g, 0.004, 0.08, 0.07);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.09);
  } else if (name === 'warp') {
    const src = ctx.createBufferSource();
    src.buffer = noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(4000, t + 1.4);
    const g = ctx.createGain();
    env(g, 0.6, 0.25, 1.2);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + 2);
  } else if (name === 'arrive') {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    env(g, 0.005, 0.5, 0.4);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.5);
  } else if (name === 'supernova') {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(40, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 2.5);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(120, t);
    f.frequency.exponentialRampToValueAtTime(2500, t + 2.6);
    env(g, 2.4, 0.35, 2.5);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + 5.2);
    const src = ctx.createBufferSource();
    src.buffer = noise();
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, t + 2.5);
    cg.gain.exponentialRampToValueAtTime(0.5, t + 2.52);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    src.connect(cg).connect(out);
    src.start(t + 2.5);
    src.stop(t + 3.5);
  }
}
