/**
 * §5.3 planets — fully procedural, no texture downloads. Lit by a single point light at the host star with the
 * star's blackbody colour, so planets are tinted by their sun.
 * uType: 0 gas giant · 1 ocean/ice · 2 rocky. uSkin: 0 none · 1 terraformed · 2 lava · 3 city lights · 4 diamond.
 */

export const planetVertex = /* glsl */ `
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

export const planetFragment = /* glsl */ `
#include <cv_common>
#include <cv_noise>
uniform float uType;
uniform float uSkin;
uniform vec3 uHue;          // linguist colour (linear)
uniform vec3 uStarColor;    // host star blackbody (linear)
uniform vec3 uStarViewPos;  // star position in view space
uniform float uSeed;
uniform float uTime;
uniform float uSpot;        // great spot if ≥ 10k ★
uniform float uArchived;    // frozen
uniform float uAurora;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;

vec3 gasGiant(vec3 n) {
  float lat = n.y;
  float warp = fbm3(n * 3.0 + uSeed, 4);
  float bands = sin(lat * (10.0 + mod(uSeed, 7.0)) + warp * 2.2);
  float fine = fbm3(vec3(n.x * 2.0, lat * 18.0, n.z * 2.0) + uSeed, 3);
  vec3 a = uHue;
  vec3 b = mix(uHue, vec3(0.95, 0.9, 0.8), 0.55);
  vec3 c = mix(a, b, 0.5 + 0.5 * bands) * (0.85 + 0.25 * fine);
  if (uSpot > 0.5) {
    vec3 sc = normalize(vec3(0.6, -0.35, 0.72));
    float d = length(vec2((n.x - sc.x) * 1.0, (n.y - sc.y) * 2.2));
    float swirl = fbm3(vec3(atan(n.y - sc.y, n.x - sc.x) * 2.0, d * 12.0, uSeed), 3);
    float spot = smoothstep(0.22, 0.08, d + swirl * 0.03);
    c = mix(c, vec3(0.75, 0.32, 0.2) * (0.8 + 0.4 * swirl), spot);
  }
  return c;
}

vec3 oceanWorld(vec3 n, out float spec) {
  vec3 q = n * 1.6 + uSeed;
  q += vec3(fbm3(q * 1.3, 3), fbm3(q * 1.3 + 5.2, 3), fbm3(q * 1.3 + 9.1, 3)) * 0.6; // domain warp
  float h = fbm3(q * 1.7, 5);
  float land = smoothstep(0.02, 0.08, h);
  vec3 ocean = mix(vec3(0.02, 0.06, 0.16), uHue * 0.35 + vec3(0.0, 0.05, 0.12), 0.5);
  vec3 ground = mix(uHue * 0.7 + vec3(0.1, 0.12, 0.05), vec3(0.45, 0.4, 0.3), smoothstep(0.1, 0.4, h));
  float ice = smoothstep(0.72, 0.84, abs(n.y) + fbm3(n * 6.0, 3) * 0.08);
  spec = (1.0 - land) * (1.0 - ice);
  return mix(mix(ocean, ground, land), vec3(0.92, 0.95, 1.0), ice);
}

vec3 rocky(vec3 n) {
  float r = ridged3(n * 2.5 + uSeed, 6);
  vec2 cr = worley3(n * 5.0 + uSeed * 1.7);
  float crater = smoothstep(0.08, 0.02, cr.x) * 0.5 - smoothstep(0.14, 0.1, cr.x) * smoothstep(0.02, 0.1, cr.x) * 0.35;
  vec3 base = mix(vec3(0.28, 0.26, 0.24), uHue * 0.6 + vec3(0.15), 0.35);
  return base * (0.55 + r * 0.7) * (1.0 - crater);
}

void main() {
  vec3 n = normalize(vObjN);
  vec3 N = normalize(vViewN);
  vec3 V = normalize(-vViewPos);
  vec3 Ldir = normalize(uStarViewPos - vViewPos);
  float ndl = dot(N, Ldir);
  float diff = max(ndl, 0.0);
  float spec = 0.0;
  vec3 albedo;
  if (uType < 0.5) albedo = gasGiant(n);
  else if (uType < 1.5) albedo = oceanWorld(n, spec);
  else albedo = rocky(n);

  if (uSkin > 0.5 && uSkin < 1.5) { float s = 0.0; albedo = mix(oceanWorld(n, s), vec3(0.2, 0.45, 0.18), 0.35); spec = s; }
  if (uSkin > 1.5 && uSkin < 2.5) {
    float cracks = 1.0 - smoothstep(0.0, 0.05, abs(fbm3(n * 5.0 + uSeed, 5)));
    albedo = vec3(0.09, 0.07, 0.06) + vec3(1.0, 0.35, 0.05) * cracks * 1.5;
  }
  if (uSkin > 3.5) albedo = mix(vec3(0.85, 0.92, 1.0), uHue, 0.2) * (0.8 + 0.4 * worley3(n * 7.0).x);

  if (uArchived > 0.5) {
    albedo = mix(vec3(cv_luma(albedo)), albedo, 0.2) * 0.9 + vec3(0.06, 0.08, 0.1);
    vec2 w = worley3(n * 8.0 + uSeed);
    albedo += vec3(0.55, 0.65, 0.75) * (1.0 - smoothstep(0.0, 0.04, w.y - w.x)) * 0.5;
  }

  vec3 col = albedo * uStarColor * diff;
  vec3 H = normalize(Ldir + V);
  col += uStarColor * pow(max(dot(N, H), 0.0), 60.0) * spec * 0.8 * step(0.0, ndl);
  col += albedo * 0.015; // faint ambient so the night side isn't pure black

  // Night side: faint city-light noise only with the Cyber City Lights skin; lava glows regardless of light.
  float night = smoothstep(0.05, -0.15, ndl);
  if (uSkin > 2.5 && uSkin < 3.5) {
    float lights = step(0.62, cv_hash12(floor(vec2(atan(n.z, n.x) * 80.0, n.y * 80.0)))) * smoothstep(0.0, 0.3, fbm3(n * 4.0 + uSeed, 3));
    col += vec3(1.0, 0.75, 0.4) * lights * night * 1.6;
  }
  if (uSkin > 1.5 && uSkin < 2.5) col += albedo * 0.6 * (0.6 + 0.4 * night);

  // Aurora at the poles if pushed within 7 days
  if (uAurora > 0.5) {
    float pole = smoothstep(0.78, 0.9, abs(n.y)) * smoothstep(1.0, 0.92, abs(n.y));
    float wave = 0.5 + 0.5 * sin(atan(n.z, n.x) * 12.0 + uTime * 1.5 + fbm3(n * 6.0 + uTime * 0.2, 2) * 3.0);
    col += vec3(0.25, 1.0, 0.55) * pole * wave * (0.4 + night) * 1.2;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Atmosphere rim: fresnel pow(1 − N·V, 3) in Rayleigh blue mixed with the language hue; forward scattering when back-lit. */
export const atmosphereFragment = /* glsl */ `
uniform vec3 uHue;
uniform vec3 uStarColor;
uniform vec3 uStarViewPos;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  vec3 N = normalize(vViewN);
  vec3 V = normalize(-vViewPos);
  vec3 Ldir = normalize(uStarViewPos - vViewPos);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float lit = smoothstep(-0.3, 0.4, dot(N, Ldir));
  float forward = pow(max(dot(-V, Ldir), 0.0), 8.0) * 2.0;
  vec3 c = mix(vec3(0.3, 0.55, 1.0), uHue, 0.35) * uStarColor * rim * (lit + forward);
  gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * Rings: 1D procedural density (hash of repo id → band gaps), lit by the star, with the planet's shadow via an
 * analytic ray–sphere test. Positions in the planet's local frame; the planet is a unit sphere scaled by uPlanetR.
 */
export const ringVertex = /* glsl */ `
varying vec3 vLocal;
varying vec3 vViewPos;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const ringFragment = /* glsl */ `
#include <cv_common>
#include <cv_noise>
uniform float uInner;
uniform float uOuter;
uniform float uBands;
uniform float uSeed;
uniform float uPlanetR;
uniform vec3 uStarLocal;   // star position in the planet's local frame
uniform vec3 uStarColor;
uniform vec3 uHue;
uniform float uFlash;      // release ring flash
varying vec3 vLocal;
varying vec3 vViewPos;
void main() {
  float r = length(vLocal.xy);
  float x = (r - uInner) / (uOuter - uInner);
  if (x < 0.0 || x > 1.0) discard;
  float density = 0.0;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uBands) break;
    float c = (float(i) + 0.5) / max(uBands, 1.0);
    float w = 0.35 / max(uBands, 1.0) * (0.6 + cv_hash11(uSeed + float(i)));
    density += smoothstep(w, w * 0.4, abs(x - c));
  }
  density *= 0.6 + 0.4 * (snoise(vec3(x * 120.0, uSeed, 0.0)) * 0.5 + 0.5);
  density = clamp(density, 0.0, 1.0);
  // planet shadow: does the ray from this ring point to the star hit the planet sphere?
  vec3 ro = vec3(vLocal.xy, 0.0);
  vec3 rd = normalize(uStarLocal - ro);
  float b = dot(ro, rd);
  float c = dot(ro, ro) - uPlanetR * uPlanetR;
  float h = b * b - c;
  float shadow = (h > 0.0 && -b - sqrt(h) > 0.0) ? 0.08 : 1.0;
  vec3 col = mix(vec3(0.82, 0.76, 0.66), uHue, 0.25) * uStarColor * shadow * 0.9 + vec3(0.9, 0.85, 1.0) * uFlash * 3.0;
  gl_FragColor = vec4(col * density, density * 0.85);
}
`;
