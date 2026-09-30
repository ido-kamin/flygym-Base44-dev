// GLSL for the brain. All per-neuron animation happens on the GPU: the CPU
// only uploads cluster activity (16 floats), wave fronts (12 x vec4 + color)
// and tract pulses (24 x vec3) each frame.

export const MAX_WAVES = 12;
export const MAX_EDGES = 32;

// Ashima Arts / Stefan Gustavson 3D simplex noise (MIT).
const SIMPLEX_3D = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
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
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
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
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

export const NEURON_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform float uAct[16];
uniform vec3 uColor[16];
uniform vec4 uWave[${MAX_WAVES}];      // xyz origin, w start time
uniform vec4 uWaveColor[${MAX_WAVES}]; // rgb color, a strength
uniform float uWaveSpeed;
uniform float uIntensity;
uniform float uReal;       // 0 model animation .. 1 real FlyWire spikes

attribute float aCluster;
attribute float aSpike;    // filtered firing rate of this point's FlyWire neuron (1 = 40 Hz)
attribute float aPhase;
attribute float aSize;

varying vec3 vColor;
varying float vAlpha;

${SIMPLEX_3D}

void main() {
  int ci = int(aCluster + 0.5);
  float act = uAct[ci];
  vec3 base = uColor[ci];

  // spontaneous activity: two octaves of drifting noise (slow field + fast crackle)
  float slow = snoise(position * 0.85 + vec3(0.0, uTime * 0.32, uTime * 0.18));
  float fast = snoise(position * 3.3 - vec3(uTime * 0.9));
  // per-neuron spikes: sharp periodic flashes, rate rising with cluster activity
  float rate = 0.25 + aPhase * 1.4 + act * 2.2;
  float spike = pow(max(0.0, sin(6.2831853 * (aPhase * 7.0 + uTime * rate))), 28.0);

  float fire = 0.1
    + 0.28 * smoothstep(0.15, 0.95, slow)
    + act * (0.35 + 0.75 * smoothstep(-0.3, 0.8, fast))
    + spike * (0.25 + 1.4 * act);
  vec3 col = base * fire;

  // real mode (brain points only; clusters 13-15 are the VNC, outside FlyWire):
  // a dim resting brain in which each neuron flashes when it actually fires
  float real = uReal * step(aCluster, 12.5);
  if (real > 0.0) {
    float s = min(aSpike, 1.0);
    float rest = 0.05 + 0.05 * smoothstep(0.2, 0.95, slow);
    float fireReal = rest + s * 1.9 + act * 0.12;
    vec3 colReal = base * rest + mix(base, vec3(1.0, 0.8, 0.52), 0.55) * s * 1.9;
    fire = mix(fire, fireReal, real);
    col = mix(col, colReal, real);
  }

  // expanding wave fronts: bright shells travelling outward from each origin
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    float dt = uTime - uWave[i].w;
    if (dt > 0.0 && dt < 4.5) {
      float r = length(position - uWave[i].xyz);
      float front = dt * uWaveSpeed;
      float x = (r - front) / (0.22 + dt * 0.12);
      float shell = exp(-x * x) * exp(-dt * 0.9) * uWaveColor[i].a;
      // a faint lingering glow inside the shell
      float wake = step(r, front) * exp(-dt * 1.8) * 0.05 * uWaveColor[i].a;
      col += uWaveColor[i].rgb * (shell * 0.75 + wake);
      fire += 0.6 * shell + wake;
    }
  }

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = aSize * (0.9 + 0.5 * min(fire, 2.0));
  gl_PointSize = clamp(sz * uScale / -mv.z, 1.0, 48.0);
  vColor = col * uIntensity;
  // capped: tens of thousands of additive sprites overlap on screen, so a
  // per-neuron flare must stay a few x baseline or dense regions clip to white
  vAlpha = clamp(0.12 + fire * 0.3, 0.0, 0.5);
  // real mode: resting neurons are faint dust, firing ones stand out
  float realA = uReal * step(aCluster, 12.5);
  vAlpha = mix(vAlpha, clamp(0.07 + min(aSpike, 1.0) * 0.55, 0.0, 0.6), realA);
}
`;

export const NEURON_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(q, q);
  if (d2 > 1.0) discard;
  float core = exp(-d2 * 7.0);
  float halo = exp(-d2 * 2.5) * 0.16;
  // push very active neurons toward white-hot
  float heat = clamp(max(max(vColor.r, vColor.g), vColor.b) - 0.95, 0.0, 1.5);
  vec3 c = vColor * (core + halo) + vec3(heat * core * 0.6);
  gl_FragColor = vec4(c, (core + halo) * vAlpha);
}
`;

export const TRACT_VERTEX = /* glsl */ `
uniform float uTime;
uniform vec3 uPulse[${MAX_EDGES}]; // x start time, y duration, z strength
uniform float uGain[${MAX_EDGES}];
uniform float uFlash[${MAX_EDGES}];
uniform float uDim;

attribute float aT;
attribute float aEdge;
attribute vec3 color;

varying vec3 vColor;
varying float vIntensity;

void main() {
  int ei = int(aEdge + 0.5);
  vec3 p = uPulse[ei];
  float prog = (uTime - p.x) / max(p.y, 0.05);
  float packet = 0.0;
  if (prog > -0.1 && prog < 1.25) {
    float x = (aT - prog) / 0.075;
    packet = exp(-x * x) * p.z;
  }
  float fdt = uTime - uFlash[ei];
  float flash = fdt > 0.0 ? exp(-fdt * 1.3) * (0.65 + 0.35 * sin(aT * 42.0 - uTime * 14.0)) : 0.0;
  vIntensity = (0.02 + 0.07 * uGain[ei] + packet * 1.6 + flash * 1.2) * uDim;
  vColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const TRACT_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vIntensity;

void main() {
  gl_FragColor = vec4(vColor * vIntensity, 1.0);
}
`;
