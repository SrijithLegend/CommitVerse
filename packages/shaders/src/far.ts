/** Far layer: star points (the most important shader in the app), dust lanes, HII regions, impostors, skybox. */

/** §5.3 far-field stars. Positions are int16 node-local, dequantized here; uOffset = node origin − camera (floating origin). */
export const starPointsVertex = /* glsl */ `
#include <cv_common>
#include <cv_blackbody>
attribute vec4 aProps;      // R_q, T_q, L_q, flags (raw bytes)
attribute float aCosmetic;  // corona colour index, 0 = none
attribute float aIndex;     // dense star index (hidden bitmask)
uniform vec3 uOffset;
uniform vec3 uMin;
uniform vec3 uMax;
uniform float uScale;
uniform float uPixelRatio;
uniform float uNearFade;
uniform float uFade;
uniform float uHiddenRows;
uniform sampler2D uHidden;
uniform vec3 uCoronaColors[16];
uniform float uFocusIndex;
uniform float uClassMask;   // bitmask of visible classes (chart filters); 127 = all
varying vec3 vColor;
varying vec3 vTint;
varying float vSpike;
varying float vCanvas;

bool isHidden(float idx) {
  if (uHiddenRows < 0.5) return false;
  int i = int(idx + 0.5);
  int byteIndex = i / 8;
  int bit = i - byteIndex * 8;
  ivec2 tc = ivec2(byteIndex - (byteIndex / 4096) * 4096, byteIndex / 4096);
  if (float(tc.y) >= uHiddenRows) return false;
  int v = int(texelFetch(uHidden, tc, 0).r * 255.0 + 0.5);
  return ((v >> bit) & 1) == 1;
}

float classOf(float tq) {
  // log-spaced LUT index → class 0..6 (M K G F A B O) using the band temperatures
  float T = 2400.0 * exp(tq / 255.0 * log(40000.0 / 2400.0));
  return T < 3700.0 ? 0.0 : T < 5200.0 ? 1.0 : T < 6000.0 ? 2.0 : T < 7500.0 ? 3.0 : T < 10000.0 ? 4.0 : T < 30000.0 ? 5.0 : 6.0;
}

void main() {
  vec3 local = uMin + (position + 32768.0) / 65535.0 * (uMax - uMin);
  vec3 p = local + uOffset;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  float dist = max(length(p), 1e-3);
  float L = aProps.z / 255.0 * 1.25;
  float Leff = mix(0.35, 1.0, clamp(L, 0.0, 1.0)) + max(0.0, L - 1.0);
  float flags = aProps.w;
  float hyper = mod(floor(flags / 4.0), 2.0);
  float state = floor(flags / 32.0);
  float size = clamp(uScale * Leff / dist, 1.5, 48.0);
  // Near-field takes over inside uNearFade; cross-fade over the last 20 %.
  float near = smoothstep(uNearFade * 0.8, uNearFade, dist);
  if (abs(aIndex - uFocusIndex) < 0.5) near = 0.0;
  float cls = classOf(aProps.y);
  float visible = mod(floor(uClassMask / exp2(cls)), 2.0);
  if (isHidden(aIndex)) visible = 0.0;
  vSpike = (L > 0.85 || hyper > 0.5) ? 1.0 : 0.0;
  vCanvas = vSpike > 0.5 ? 5.0 : 3.0;
  gl_PointSize = size * uPixelRatio * vCanvas * near * uFade * visible;
  vec3 c = blackbodyQ(aProps.y);
  if (state == 1.0) c = mix(c, vec3(1.0, 0.37, 0.70), 0.45);
  // energy conservation: big sprites (close stars) spread their light instead of blooming into a disc
  vColor = c * Leff * 1.6 * mix(1.0, 0.35, smoothstep(10.0, 48.0, size));
  int ci = int(aCosmetic + 0.5);
  vTint = vec3(0.0);
  for (int k = 0; k < 16; k++) if (k == ci - 1) vTint = uCoronaColors[k];
}
`;

export const starPointsFragment = /* glsl */ `
varying vec3 vColor;
varying vec3 vTint;
varying float vSpike;
varying float vCanvas;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r = length(uv) * vCanvas;
  float core = exp(-r * r * 24.0);
  float halo = exp(-r * r * 3.0) * 0.15;
  float spikes = 0.0;
  if (vSpike > 0.5) {
    for (int i = 0; i < 3; i++) {
      float a = float(i) * 1.0471976;
      vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * uv;
      spikes += pow(max(0.0, 1.0 - abs(q.x) * 18.0), 6.0) * exp(-abs(q.y) * 5.0);
    }
  }
  float a = core + halo + spikes * 0.6;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a + vTint * halo * 3.0, 1.0);
}
`;

/**
 * Dust lanes (darkening, premultiplied "multiply-like" blend) and HII / young-cluster sprites (emissive).
 * Positions are galaxy-local floats generated from the galaxy's spiral parameters; uOffset = centre − camera.
 */
export const dustVertex = /* glsl */ `
attribute vec4 aData;   // size, kind (0 dust, 1 HII, 2 blue cluster), seed, opacity
uniform vec3 uOffset;
uniform mat3 uTilt;
uniform float uPixelRatio;
uniform float uFade;
varying float vKind;
varying float vOpacity;
varying float vSeed;
void main() {
  vec3 p = uTilt * position + uOffset;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  float dist = max(length(p), 1.0);
  gl_PointSize = clamp(aData.x * 900.0 / dist, 0.0, 256.0) * uPixelRatio;
  vKind = aData.y;
  vOpacity = aData.w * uFade;
  vSeed = aData.z;
}
`;

export const dustFragment = /* glsl */ `
varying float vKind;
varying float vOpacity;
varying float vSeed;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(uv, uv);
  if (r2 > 1.0) discard;
  float soft = exp(-r2 * 3.5) * (0.8 + 0.2 * sin(vSeed * 40.0 + uv.x * 3.0));
  if (vKind < 0.5) {
    // premultiplied darkening: dst = dst * (1 - a)
    gl_FragColor = vec4(0.0, 0.0, 0.0, soft * vOpacity * 0.55);
  } else if (vKind < 1.5) {
    gl_FragColor = vec4(vec3(1.0, 0.435, 0.569) * soft * vOpacity * 1.4, 0.0);
  } else {
    gl_FragColor = vec4(vec3(0.55, 0.7, 1.0) * soft * vOpacity * 1.2, 0.0);
  }
}
`;

/** Galaxy impostor quad: the galaxy rendered once from above into a texture, plus an analytic bulge glow. */
export const impostorVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const impostorFragment = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uBulge;
uniform float uFade;
uniform float uHasMap;
uniform float uArms;
uniform float uPitch;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  vec3 c;
  if (uHasMap > 0.5) {
    c = texture2D(uMap, vUv).rgb;
  } else {
    // analytic placeholder until the root tile is rendered: log-spiral arms
    float th = atan(p.y, p.x);
    float spiral = uArms > 0.5 ? pow(0.5 + 0.5 * cos(uArms * (th - log(max(r, 0.02)) / tan(uPitch))), 3.0) : 0.6;
    c = uColor * spiral * exp(-r * 3.0) * 0.8;
  }
  float bulge = exp(-r * r * 60.0) * 2.5 + exp(-r * r * 12.0) * 0.4;
  gl_FragColor = vec4((c + uBulge * bulge) * uFade * smoothstep(1.0, 0.85, r), 1.0);
}
`;

/** Procedural deep background, rendered once into a cubemap (never animated, zero per-frame cost). */
export const skyboxVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const skyboxFragment = /* glsl */ `
#include <cv_common>
#include <cv_noise>
uniform float uSeed;
uniform float uDensity;
varying vec3 vDir;

vec3 starLayer(vec3 d, float scale, float threshold, float bright) {
  vec3 p = d * scale;
  vec3 id = floor(p);
  vec3 f = fract(p) - 0.5;
  vec3 h = cv_hash33(id + uSeed);
  if (h.x < threshold) return vec3(0.0);
  vec3 off = (h - 0.5) * 0.6;
  float r = length(f - off);
  float s = exp(-r * r * 900.0) * bright * (0.4 + 0.6 * h.y);
  float t = h.z;
  vec3 col = t < 0.3 ? vec3(1.0, 0.8, 0.65) : t < 0.8 ? vec3(1.0, 0.97, 0.92) : vec3(0.75, 0.85, 1.0);
  return col * s;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 c = vec3(0.027, 0.039, 0.078) * 0.35; // --space-1, very dim
  // low-contrast nebula wash (≤ 3 % blue/violet)
  float neb = fbm3(d * 2.2 + uSeed, 5) * 0.5 + 0.5;
  float neb2 = fbm3(d * 5.0 - uSeed, 4) * 0.5 + 0.5;
  c += vec3(0.045, 0.03, 0.085) * pow(neb, 3.0) * 0.6 + vec3(0.02, 0.035, 0.07) * pow(neb2, 4.0) * 0.4;
  // a subtle Milky-Way-like band
  vec3 bandN = normalize(vec3(0.25, 1.0, 0.35));
  float band = exp(-pow(dot(d, bandN) * 5.5, 2.0));
  float bandNoise = fbm3(d * 9.0, 5) * 0.5 + 0.5;
  c += vec3(0.07, 0.065, 0.08) * band * bandNoise * 0.55;
  c -= vec3(0.02) * band * smoothstep(0.55, 0.8, fbm3(d * 14.0 + 3.0, 4) * 0.5 + 0.5);
  // thousands of faint background stars (three layers)
  c += starLayer(d, 180.0 * uDensity, 0.72, 0.9);
  c += starLayer(d, 420.0 * uDensity, 0.86, 0.55);
  c += starLayer(d, 90.0, 0.93, 1.6) * (1.0 + band);
  // a handful of distant galaxy smudges
  vec3 g = starLayer(d, 12.0, 0.9, 0.0);
  vec3 gp = d * 12.0;
  vec3 gid = floor(gp);
  vec3 gh = cv_hash33(gid + uSeed + 7.0);
  if (gh.x > 0.94) {
    vec3 gf = fract(gp) - 0.5 - (gh - 0.5) * 0.4;
    float e = exp(-dot(gf.xy * vec2(1.0, 3.0), gf.xy * vec2(1.0, 3.0)) * 400.0);
    c += vec3(0.9, 0.85, 1.0) * e * 0.12;
  }
  gl_FragColor = vec4(max(c, 0.0) + g * 0.0, 1.0);
}
`;
