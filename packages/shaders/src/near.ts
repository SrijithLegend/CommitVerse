/** Near layer: the star itself (§5.3 near-field star), corona, prominences, pulsar beams, protostar cocoon, remnant, auras. */

export const starSurfaceVertex = /* glsl */ `
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  vObjN = normalize(position);
  vViewN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

/**
 * Granulation (4-octave 4D simplex fBm), sunspots (count ∝ 1 − activity), limb darkening I(μ) = 1 − 0.6·(1 − μ^0.5).
 * Emissive only. Skins modulate the surface pattern but never the blackbody colour (Principle 1).
 * uState: 0 main · 1 protostar · 2 red giant · 3 white dwarf. uSkin: 0/1 plasma · 2 crystalline · 3 neon grid · 4 obsidian · 5 glitch.
 */
export const starSurfaceFragment = /* glsl */ `
#include <cv_common>
#include <cv_noise>
#include <cv_blackbody>
uniform float uTemp;
uniform float uActivity;
uniform float uTime;
uniform float uState;
uniform float uSkin;
uniform float uSeed;
uniform float uIntensity;
uniform float uOpacity;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;

void main() {
  vec3 n = normalize(vObjN);
  vec3 V = normalize(-vViewPos);
  float mu = clamp(dot(normalize(vViewN), V), 0.0, 1.0);
  float limb = 1.0 - 0.6 * (1.0 - sqrt(mu));
  float t = uTime;
  float pattern;
  if (uState > 1.5 && uState < 2.5) {
    // red giant: big, slow, boiling convection cells
    vec2 w = worley3(n * 3.2 + vec3(0.0, t * 0.015, t * 0.01) + uSeed);
    pattern = 0.55 + 0.6 * smoothstep(0.0, 0.9, w.y - w.x) + 0.25 * fbm4(vec4(n * 5.0, t * 0.03), 3);
  } else {
    float gran = fbm4(vec4(n * (uState > 2.5 ? 22.0 : 13.0) + uSeed, t * 0.06), 4);
    pattern = 0.82 + 0.38 * gran;
  }
  // sunspots: inactive (cool) stars look spotty
  float spotField = fbm3(n * 2.4 + uSeed * 3.1 + vec3(t * 0.004), 3);
  float spotThresh = mix(0.18, 0.62, clamp(uActivity, 0.0, 1.0));
  float spot = smoothstep(spotThresh, spotThresh + 0.08, spotField);
  float umbra = smoothstep(spotThresh + 0.06, spotThresh + 0.16, spotField);
  pattern *= 1.0 - spot * 0.45 - umbra * 0.4;

  // skins: modulate intensity only
  if (uSkin > 1.5 && uSkin < 2.5) {
    vec2 w = worley3(n * 6.0 + uSeed);
    pattern *= 0.75 + 0.5 * smoothstep(0.02, 0.12, w.y - w.x);
  } else if (uSkin > 2.5 && uSkin < 3.5) {
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(n.z, n.x);
    float g = max(smoothstep(0.97, 1.0, abs(cos(lat * 12.0))), smoothstep(0.97, 1.0, abs(cos(lon * 12.0 + t * 0.2))));
    pattern = pattern * 0.7 + g * 1.4;
  } else if (uSkin > 3.5 && uSkin < 4.5) {
    float cracks = 1.0 - smoothstep(0.0, 0.06, abs(fbm3(n * 4.0 + uSeed, 5)));
    pattern = 0.22 + cracks * 2.2 * (0.7 + 0.3 * sin(t * 1.5 + n.x * 8.0));
  } else if (uSkin > 4.5) {
    float row = floor((n.y * 0.5 + 0.5) * 60.0);
    float jitter = step(0.92, cv_hash11(row + floor(t * 6.0))) * 0.5;
    pattern *= 0.8 + 0.4 * step(0.5, fract((n.x + jitter) * 20.0)) + 0.2 * sin(row * 3.0 + t * 20.0) * step(0.9, cv_hash11(row * 1.7 + floor(t * 3.0)));
  }

  vec3 base = blackbodyK(uTemp);
  float sharp = uState > 2.5 ? 1.35 : 1.0;
  vec3 col = base * pattern * pow(limb, sharp) * uIntensity;
  gl_FragColor = vec4(col, uOpacity);
}
`;

/** Camera-facing corona quad (4·R): radial falloff × angular noise flames. Hot = tighter/brighter/bluer. */
export const coronaVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  mv.xy += position.xy * scale;
  gl_Position = projectionMatrix * mv;
}
`;

export const coronaFragment = /* glsl */ `
#include <cv_common>
#include <cv_noise>
#include <cv_blackbody>
uniform float uTemp;
uniform float uTime;
uniform float uTight;     // 0 (cool, soft) .. 1 (hot, tight)
uniform float uIntensity;
uniform float uBase;      // 1 = physical corona, 0 = cosmetic overlay only
uniform float uStyle;     // 0 natural · 1 flare · 2 crown · 3 halo · 4 diamond (cosmetic coronas)
uniform vec3 uTint;
varying vec2 vUv;
void main() {
  float r = length(vUv) * 2.0;          // 1.0 = photosphere edge (quad is 4R, star radius R)
  if (r < 0.98) discard;
  float ang = atan(vUv.y, vUv.x);
  float k = mix(2.2, 5.0, uTight);
  float fall = pow(max(0.0, 1.0 / r), k) ;
  float flames = fbm3(vec3(cos(ang) * 2.0, sin(ang) * 2.0, uTime * 0.12 + r * mix(1.2, 2.4, uTight)), 4) * 0.5 + 0.5;
  float streamers = pow(max(0.0, fbm3(vec3(cos(ang) * 5.0, sin(ang) * 5.0, uTime * 0.05), 3)), 2.0);
  float a = fall * (0.55 + 0.9 * flames + 1.2 * streamers * (1.0 - uTight));
  vec3 base = mix(blackbodyK(uTemp), vec3(0.75, 0.85, 1.0), uTight * 0.25);
  vec3 col = base * a * uBase;
  if (uStyle > 0.5) {
    float ring = 0.0;
    if (uStyle < 1.5) ring = pow(flames, 3.0) * exp(-abs(r - 1.25) * 4.0) * 2.5;                      // flare
    else if (uStyle < 2.5) ring = step(0.6, fract(ang * 6.0 / CV_TAU + 0.5)) * exp(-abs(r - 1.35) * 9.0) * 3.0;  // crown
    else if (uStyle < 3.5) ring = exp(-pow((r - 1.7) * 14.0, 2.0)) * 2.0;                               // halo (22°-style)
    else ring = exp(-pow((r - 1.05) * 22.0, 2.0)) * 2.0 + exp(-length(vUv * 2.0 - vec2(0.72, 0.72)) * 18.0) * 10.0; // diamond ring
    col += uTint * ring;
  }
  gl_FragColor = vec4(col * uIntensity * smoothstep(2.0, 1.4, r), 1.0);
}
`;

/** Prominence ribbons (classes A/B/O): plasma flowing along an arc (uv.x = along the arc). */
export const prominenceVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export const prominenceFragment = /* glsl */ `
#include <cv_common>
#include <cv_noise>
#include <cv_blackbody>
uniform float uTemp;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
void main() {
  float flow = fbm3(vec3(vUv.x * 8.0 - uTime * 0.6, vUv.y * 3.0, uSeed), 4) * 0.5 + 0.5;
  float edge = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
  float ends = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
  vec3 c = mix(blackbodyK(uTemp), vec3(1.0, 0.55, 0.35), 0.35) * (0.5 + flow * 1.6) * edge * ends * 1.8;
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Pulsar beams: long additive cones; brightness peaks where the beam faces the camera (lighthouse flash). */
export const beamVertex = /* glsl */ `
varying float vAlong;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  vAlong = uv.y;
  vViewN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uFlash;
varying float vAlong;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  float facing = abs(dot(normalize(vViewN), normalize(-vViewPos)));
  float a = pow(1.0 - vAlong, 1.6) * (0.25 + 0.75 * pow(facing, 2.0));
  gl_FragColor = vec4(uColor * a * (1.0 + uFlash * 6.0), 1.0);
}
`;

/** Protostar cocoon: 16-step ray-marched noise volume inside a sphere, magenta-pink #ff5fb3 → violet #7a3cff. */
export const cocoonVertex = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vCamObj;
uniform vec3 uCamObj;
void main() {
  vObjPos = position;
  vCamObj = uCamObj;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const cocoonFragment = /* glsl */ `
#include <cv_common>
#include <cv_noise>
uniform float uTime;
uniform float uSeed;
varying vec3 vObjPos;
varying vec3 vCamObj;
vec2 sphereHit(vec3 ro, vec3 rd) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
void main() {
  vec3 ro = vCamObj;
  vec3 rd = normalize(vObjPos - vCamObj);
  vec2 t = sphereHit(ro, rd);
  if (t.y < 0.0) discard;
  float t0 = max(t.x, 0.0);
  float dt = (t.y - t0) / 16.0;
  vec3 acc = vec3(0.0);
  float trans = 1.0;
  for (int i = 0; i < 16; i++) {
    vec3 p = ro + rd * (t0 + dt * (float(i) + 0.5));
    float r = length(p);
    float d = fbm3(p * 2.6 + vec3(uSeed, uTime * 0.05, 0.0), 4) * 0.5 + 0.5;
    d = max(0.0, d - 0.35) * smoothstep(1.0, 0.55, r) * 2.4;
    vec3 col = mix(vec3(1.0, 0.373, 0.702), vec3(0.478, 0.235, 1.0), smoothstep(0.2, 0.95, r));
    float a = 1.0 - exp(-d * dt * 3.0);
    acc += trans * a * col * (1.2 + 1.5 * exp(-r * 4.0));
    trans *= 1.0 - a;
  }
  gl_FragColor = vec4(acc, 1.0 - trans);
}
`;

/** Supernova remnant / nebula aura shells: fresnel + noise filaments on a sphere, additive. */
export const shellVertex = /* glsl */ `
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  vObjN = normalize(position);
  vViewN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const shellFragment = /* glsl */ `
#include <cv_common>
#include <cv_noise>
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uTime;
uniform float uOpacity;
uniform float uShape;   // 0 remnant · 1 veil · 2 curtain · 3 filaments · 4 pillars
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vViewN), normalize(-vViewPos))), 2.0);
  vec3 n = vObjN;
  float f;
  if (uShape < 0.5) f = abs(fbm3(n * 4.0 + uTime * 0.03, 5));
  else if (uShape < 1.5) f = fbm3(n * 2.0 + vec3(0.0, uTime * 0.02, 0.0), 4) * 0.5 + 0.5;
  else if (uShape < 2.5) f = pow(0.5 + 0.5 * sin(n.x * 9.0 + fbm3(n * 3.0 + uTime * 0.05, 3) * 4.0), 6.0) * smoothstep(-0.2, 0.6, n.y);
  else if (uShape < 3.5) f = 1.0 - smoothstep(0.0, 0.12, abs(fbm3(n * 3.5 + uTime * 0.01, 5)));
  else f = smoothstep(0.35, 0.9, fbm3(vec3(n.x * 6.0, n.y * 1.5, n.z * 6.0) + uTime * 0.01, 5) * 0.5 + 0.5) * smoothstep(0.4, -0.6, n.y);
  vec3 c = mix(uColorA, uColorB, clamp(fbm3(n * 1.5 + 7.0, 3) * 0.5 + 0.5, 0.0, 1.0));
  gl_FragColor = vec4(c * f * (0.35 + fres) * uOpacity, 1.0);
}
`;
