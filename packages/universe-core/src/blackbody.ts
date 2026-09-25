/** Appendix A — blackbody colour + the 256-entry LUT (log-spaced 2,400…40,000 K). */
import { dequantizeTemperature } from './metrics';

export function kelvinToRGB(kelvin: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592;
    g = 288.1221695283 * (t - 60) ** -0.0755148492;
    b = 255;
  }
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return [c(r), c(g), c(b)];
}

/** Documented artistic adjustment: saturation × 1.25 so classes are distinguishable on screen. */
export function saturate([r, g, b]: [number, number, number], k = 1.25): [number, number, number] {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, l + (v - l) * k)));
  return [c(r), c(g), c(b)];
}

export const srgbToLinear = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** RGBA8 sRGB LUT (256 × 1). The shader samples it as an sRGB texture → linear. */
export function blackbodyLUT(): Uint8Array {
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = saturate(kelvinToRGB(dequantizeTemperature(i)));
    out.set([r, g, b, 255], i * 4);
  }
  return out;
}

export const kelvinToHex = (T: number): string =>
  `#${saturate(kelvinToRGB(T))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
