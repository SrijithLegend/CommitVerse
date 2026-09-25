/** Black holes, comets, signal beams, ships, asteroid belts. */

/**
 * Accretion disk (§5.3): animated spiral noise, inner white-blue → outer orange, relativistic Doppler beaming
 * approximation brightness *= pow(1 + 0.6·dot(orbitalVel, viewDir), 3).
 */
export const diskVertex = /* glsl */ `
varying vec3 vLocal;
varying vec3 vViewPos;
varying vec3 vViewTangent;
void main() {
  vLocal = position;
  vec3 tangent = normalize(vec3(-position.y, position.x, 0.0));
  vViewTangent = normalize(normalMatrix * tangent);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const diskFragment = /* glsl */ `
#include <cv_common>
#include <cv_noise>
uniform float uInner;
uniform float uOuter;
uniform float uTime;
uniform float uIntensity;
varying vec3 vLocal;
varying vec3 vViewPos;
varying vec3 vViewTangent;
void main() {
  float r = length(vLocal.xy);
  float x = (r - uInner) / (uOuter - uInner);
  if (x < 0.0 || x > 1.0) discard;
  float ang = atan(vLocal.y, vLocal.x);
  float swirl = fbm3(vec3(cos(ang - uTime * 0.6 / (0.3 + x)) * 3.0 + x * 8.0, sin(ang - uTime * 0.6 / (0.3 + x)) * 3.0, x * 4.0), 4) * 0.5 + 0.5;
  vec3 hot = vec3(0.85, 0.92, 1.0);
  vec3 cool = vec3(1.0, 0.5, 0.15);
  vec3 col = mix(hot, cool, pow(x, 0.7)) * (0.4 + swirl * 1.2);
  float beaming = pow(max(0.0, 1.0 + 0.6 * dot(normalize(vViewTangent), normalize(-vViewPos))), 3.0);
  float edge = smoothstep(0.0, 0.08, x) * smoothstep(1.0, 0.55, x);
  gl_FragColor = vec4(col * beaming * edge * uIntensity * mix(4.0, 1.0, x), 1.0);
}
`;

/**
 * Comets: head sprite + two GPU particle tails, analytic (zero CPU per particle):
 * ion tail straight, anti-sunward, blue; dust tail curved, star-coloured. 600 particles each, lifetime 4 s.
 * Each particle stores (seed, tailKind); the vertex shader computes where it is at uAge.
 */
export const cometVertex = /* glsl */ `
attribute vec2 aSeed;        // x: random, y: 0 head, 1 ion, 2 dust
uniform vec3 uOrigin;        // camera-relative start (star position)
uniform vec3 uDir;           // travel direction
uniform vec3 uCurve;         // perpendicular (dust curvature)
uniform float uAge;          // seconds since spawn
uniform float uDuration;     // travel time for 300 u
uniform float uPixelRatio;
uniform vec3 uIonColor;
uniform vec3 uDustColor;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float travel = clamp(uAge / uDuration, 0.0, 1.0);
  float ease = 1.0 - pow(1.0 - travel, 1.6);
  vec3 head = uOrigin + uDir * 300.0 * ease;
  float life = 4.0;
  float birth = aSeed.x * life;
  float pAge = mod(uAge - birth, life);
  float fade = 1.0 - smoothstep(0.75, 1.0, travel);
  vec3 p = head;
  float size;
  if (aSeed.y < 0.5) {
    size = 9.0;
    vColor = vec3(1.4, 1.5, 1.7);
    vAlpha = fade;
  } else if (aSeed.y < 1.5) {
    p = head - uDir * pAge * 9.0 + uCurve * (fract(aSeed.x * 91.7) - 0.5) * pAge * 0.8;
    size = 3.0 * (1.0 - pAge / life);
    vColor = uIonColor;
    vAlpha = (1.0 - pAge / life) * fade * 0.7;
  } else {
    p = head - uDir * pAge * 6.0 + uCurve * pAge * pAge * 0.9 + uCurve.zxy * (fract(aSeed.x * 53.1) - 0.5) * pAge;
    size = 4.0 * (1.0 - pAge / life);
    vColor = uDustColor;
    vAlpha = (1.0 - pAge / life) * fade * 0.5;
  }
  if (uAge < birth * 0.25 && aSeed.y > 0.5) vAlpha = 0.0;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(size * 260.0 / max(-mv.z, 1.0), 0.0, 64.0) * uPixelRatio;
}
`;

export const cometFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(uv, uv) * 4.0) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

/** Signal beam ribbon along a slight arc with a travelling pulse (uProgress 0..1 over 1.5 s). */
export const signalVertex = /* glsl */ `
attribute float aT;        // 0..1 along the arc
attribute float aSide;     // -1 / +1
uniform vec3 uFrom;
uniform vec3 uTo;
uniform vec3 uBow;
uniform float uWidth;
varying float vT;
varying float vSide;
void main() {
  vec3 p = mix(uFrom, uTo, aT) + uBow * sin(aT * 3.14159265);
  vec3 tangent = normalize((uTo - uFrom) + uBow * cos(aT * 3.14159265) * 3.14159265);
  vec3 toCam = normalize(-p);
  vec3 side = normalize(cross(tangent, toCam));
  float w = uWidth * max(1.0, length(p) * 0.004);
  p += side * aSide * w;
  vT = aT;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const signalFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uProgress;
uniform float uStyle;     // 0 laser · 1 torpedo · 2 paper plane
varying float vT;
varying float vSide;
void main() {
  float core = 1.0 - abs(vSide);
  float trail = smoothstep(uProgress - 0.35, uProgress, vT) * step(vT, uProgress);
  float pulse = exp(-pow((vT - uProgress) * 40.0, 2.0)) * 4.0;
  if (uStyle > 0.5 && uStyle < 1.5) trail *= 0.25 + 0.75 * step(0.5, fract(vT * 30.0 - uProgress * 10.0));
  if (uStyle > 1.5) trail *= 0.15;
  float a = (trail * 0.8 + pulse) * pow(core, 1.5);
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

/** Minimal lit shader for ships, moons and asteroid instances (tinted by the local star). */
export const litVertex = /* glsl */ `
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  #ifdef USE_INSTANCING
    mat4 m = modelViewMatrix * instanceMatrix;
    vViewN = normalize(mat3(m) * normal);
    vec4 mv = m * vec4(position, 1.0);
  #else
    vViewN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
  #endif
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const litFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uStarColor;
uniform vec3 uStarViewPos;
uniform float uEmissive;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  vec3 N = normalize(vViewN);
  vec3 L = normalize(uStarViewPos - vViewPos);
  float d = max(dot(N, L), 0.0);
  vec3 c = uColor * (uStarColor * d + 0.03) + uColor * uEmissive;
  gl_FragColor = vec4(c, 1.0);
}
`;
