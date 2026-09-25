/**
 * Post-processing effect fragments for the `postprocessing` library (mainImage/mainUv signatures).
 * Stack order (§5.3): layers → lensing (High+) → bloom → warp streaks / chromatic aberration → tone mapping → vignette + grain → AA.
 */

/** Screen-space gravitational lensing around a black hole: UV offset ∝ rs²/r (clamped) + a thin photon ring. */
export const lensingFragment = /* glsl */ `
uniform vec2 uCenter;      // BH position in UV
uniform float uRs;         // Schwarzschild radius in UV-height units
uniform float uAspect;
uniform float uStrength;   // 0 when the BH isn't on screen
uniform float uPhotonRing;
void mainUv(inout vec2 uv) {
  if (uStrength <= 0.0) return;
  vec2 d = uv - uCenter;
  d.x *= uAspect;
  float r = max(length(d), 1e-4);
  float off = min(uRs * uRs / r, 0.25) * uStrength;
  vec2 dir = d / r;
  dir.x /= uAspect;
  uv -= dir * off;
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  if (uStrength > 0.0) {
    vec2 d = uv - uCenter;
    d.x *= uAspect;
    float r = length(d);
    c *= smoothstep(uRs * 0.95, uRs * 1.05, r);
    c += vec3(1.0, 0.85, 0.7) * exp(-pow((r - uRs * 1.5) / (uRs * 0.04 + 1e-4), 2.0)) * uPhotonRing * uStrength * 2.0;
  }
  outputColor = vec4(c, inputColor.a);
}
`;

/**
 * Warp: radial streaks from screen-space velocity (no extra geometry) + chromatic aberration ramp (0 → 0.006 → 0)
 * + a short white bloom flash on arrival. uStyle: 0 classic streaks · 1 tunnel · 2 glitch jump.
 */
export const warpFragment = /* glsl */ `
uniform float uAmount;     // 0..1 warp intensity
uniform float uAberration; // 0..0.006
uniform float uFlash;      // arrival flash 0..1
uniform float uStyle;
uniform float uTime;
float cv_h(float n) { return fract(sin(n) * 43758.5453); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 c = uv - 0.5;
  vec3 col = inputColor.rgb;
  if (uAberration > 0.0) {
    vec2 o = c * uAberration * 4.0;
    col.r = texture2D(inputBuffer, uv + o).r;
    col.b = texture2D(inputBuffer, uv - o).b;
  }
  if (uAmount > 0.0) {
    vec3 acc = vec3(0.0);
    float len = uAmount * 0.18;
    for (int i = 1; i <= 12; i++) {
      float t = float(i) / 12.0;
      acc += texture2D(inputBuffer, uv - c * len * t).rgb * (1.0 - t);
    }
    col = mix(col, col * 0.4 + acc * 0.22, uAmount);
    if (uStyle > 0.5 && uStyle < 1.5) {
      float ang = atan(c.y, c.x);
      float rings = 0.5 + 0.5 * sin(1.0 / max(length(c), 0.02) * 6.0 - uTime * 30.0);
      col += vec3(0.35, 0.6, 1.0) * rings * uAmount * 0.25 * smoothstep(0.05, 0.5, length(c)) * (0.6 + 0.4 * sin(ang * 12.0));
    } else if (uStyle > 1.5) {
      float band = floor(uv.y * 40.0);
      float shift = (cv_h(band + floor(uTime * 20.0)) - 0.5) * 0.08 * uAmount * step(0.7, cv_h(band * 3.1 + floor(uTime * 12.0)));
      col = mix(col, texture2D(inputBuffer, uv + vec2(shift, 0.0)).rgb, step(0.001, abs(shift)));
    }
  }
  col += vec3(1.0) * uFlash * 1.5;
  outputColor = vec4(col, inputColor.a);
}
`;
