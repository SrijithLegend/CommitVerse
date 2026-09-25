/** Reusable GLSL chunks, pulled in with `#include <name>` and resolved by `glsl()` (index.ts). */

/** Ashima 3D/4D simplex noise (MIT) + fBm / ridged / Worley helpers. */
export const noise = /* glsl */ `
vec4 cv_mod289(vec4 x){return x - floor(x * (1.0/289.0)) * 289.0;}
vec3 cv_mod289(vec3 x){return x - floor(x * (1.0/289.0)) * 289.0;}
float cv_mod289(float x){return x - floor(x * (1.0/289.0)) * 289.0;}
vec4 cv_permute(vec4 x){return cv_mod289(((x*34.0)+10.0)*x);}
float cv_permute(float x){return cv_mod289(((x*34.0)+10.0)*x);}
vec4 cv_taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float cv_taylorInvSqrt(float r){return 1.79284291400159 - 0.85373472095314 * r;}

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = cv_mod289(i);
  vec4 p = cv_permute(cv_permute(cv_permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = cv_taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

vec4 cv_grad4(float j, vec4 ip){
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;
  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz*2.0 - 1.0) * s.www;
  return p;
}

float snoise(vec4 v){
  const vec4 C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
  vec4 i = floor(v + dot(v, vec4(0.309016994374947451)));
  vec4 x0 = v - i + dot(i, C.xxxx);
  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  vec4 i3 = clamp(i0, 0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);
  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;
  i = cv_mod289(i);
  float j0 = cv_permute(cv_permute(cv_permute(cv_permute(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = cv_permute(cv_permute(cv_permute(cv_permute(
             i.w + vec4(i1.w, i2.w, i3.w, 1.0)) + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
             + i.y + vec4(i1.y, i2.y, i3.y, 1.0)) + i.x + vec4(i1.x, i2.x, i3.x, 1.0));
  vec4 ip = vec4(1.0/294.0, 1.0/49.0, 1.0/7.0, 0.0);
  vec4 p0 = cv_grad4(j0, ip);
  vec4 p1 = cv_grad4(j1.x, ip);
  vec4 p2 = cv_grad4(j1.y, ip);
  vec4 p3 = cv_grad4(j1.z, ip);
  vec4 p4 = cv_grad4(j1.w, ip);
  vec4 norm = cv_taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  p4 *= cv_taylorInvSqrt(dot(p4,p4));
  vec3 m0 = max(0.6 - vec3(dot(x0,x0), dot(x1,x1), dot(x2,x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3,x3), dot(x4,x4)), 0.0);
  m0 = m0 * m0; m1 = m1 * m1;
  return 49.0 * (dot(m0*m0, vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2))) + dot(m1*m1, vec2(dot(p3, x3), dot(p4, x4))));
}

float fbm3(vec3 p, int oct){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * snoise(p); p *= 2.02; a *= 0.5; }
  return s;
}
float fbm4(vec4 p, int oct){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++){ if (i >= oct) break; s += a * snoise(p); p.xyz *= 2.03; p.w *= 1.3; a *= 0.5; }
  return s;
}
float ridged3(vec3 p, int oct){
  float a = 0.5, s = 0.0, w = 1.0;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; float n = 1.0 - abs(snoise(p)); n *= n * w; w = clamp(n * 2.0, 0.0, 1.0); s += n * a; p *= 2.1; a *= 0.5; }
  return s;
}
vec3 cv_hash33(vec3 p){
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
/** Worley F1 distance (cells) — craters, crystal facets, convection cells. */
vec2 worley3(vec3 p){
  vec3 id = floor(p); vec3 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec3 b = vec3(float(i), float(j), float(k));
    vec3 r = b + cv_hash33(id + b) - f;
    float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; } else if (d < d2){ d2 = d; }
  }
  return sqrt(vec2(d1, d2));
}
float cv_hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float cv_hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

/** Blackbody LUT lookup: T_q (0..255) → linear RGB. The LUT texture is sRGB-encoded; decode here. */
export const blackbody = /* glsl */ `
uniform sampler2D uLut;
vec3 cv_srgbToLinear(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 blackbodyQ(float tq){ return cv_srgbToLinear(texture2D(uLut, vec2((tq + 0.5) / 256.0, 0.5)).rgb); }
float kelvinToQ(float T){ return clamp(log(T / 2400.0) / log(40000.0 / 2400.0) * 255.0, 0.0, 255.0); }
vec3 blackbodyK(float T){ return blackbodyQ(kelvinToQ(T)); }
`;

export const common = /* glsl */ `
#define CV_PI 3.141592653589793
#define CV_TAU 6.283185307179586
float cv_luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 cv_saturate(vec3 c, float s){ float l = cv_luma(c); return mix(vec3(l), c, s); }
mat2 cv_rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

export const CHUNKS: Record<string, string> = { cv_noise: noise, cv_blackbody: blackbody, cv_common: common };
