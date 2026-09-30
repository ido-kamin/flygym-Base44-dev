// Procedural, anatomically inspired point cloud of the adult fly CNS.
//
// Positions are NOT FlyWire morphology (FlyWire data is CC BY-NC): they are
// generated from simple shapes placed where the real neuropils sit (optic
// lobes with columnar lamina/medulla/lobula layers, glomerular antennal lobes,
// mushroom-body calyx/peduncle/lobes, the central-complex fan/ellipsoid/bridge,
// the VNC neuromeres with their nerves). The number of neurons in each region,
// however, is taken from the published FlyWire annotations (Schlegel et al.
// 2024, super_class / cell_class counts; see REGION_COUNTS) and MANC for the
// VNC, so relative densities are real. Everything is seeded: same seed, same brain.

import { BRAIN_NEURONS, VNC_NEURONS } from './constants.js';
import { C, CLUSTERS, EDGES } from './connectome.js';
import { mulberry32 } from './genome.js';

const TAU = Math.PI * 2;

/**
 * Neurons per cluster, from FlyWire's annotation table (139,248 annotated
 * neurons of 139,255) grouped by where their arbors sit:
 * - optic lobes: optic-lobe intrinsic 77,541 + visual projection 8,038 +
 *   visual centrifugal 524 + visual sensory (photoreceptors) 11,391
 * - antennal lobes: olfactory 2,282 + hygro 74 + thermo 29 sensory, ALPN 685,
 *   ALLN 429, ALIN 24, ALON 14, mAL 77
 * - mushroom bodies: Kenyon cells 5,177 + MBON 96 + MBIN 4
 * - lateral horn: LHLN 514 + LHCENT 42
 * - central complex: CX 2,875 + TuBu 150
 * - PAM dopaminergic: 307
 * - SEZ: mechanosensory 2,667 + gustatory 336 + motor 110 + other sensory 128
 * - neck connective: descending 1,303 + ascending 1,750 + sensory-ascending 612
 * - protocerebrum / other central brain: the remainder (22,076)
 * VNC (MANC ~22.3k) split over the thoracic neuromeres; that split is approximate.
 */
export const REGION_COUNTS = {
  OL: 97494,
  AL: 3614,
  MB: 5277,
  LH: 556,
  CX: 3025,
  PAM: 307,
  SEZ: 3241,
  DN: 3665,
  T1: 7300,
  T2: 8200,
  T3: VNC_NEURONS - 7300 - 8200,
};

function makeSampler(rng) {
  const gauss = () => {
    const u = Math.max(1e-9, rng());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng());
  };
  const unitVec = () => {
    const z = rng() * 2 - 1;
    const t = rng() * TAU;
    const r = Math.sqrt(1 - z * z);
    return [r * Math.cos(t), r * Math.sin(t), z];
  };
  /** Uniform in an ellipsoid; `falloff` > 1 concentrates points toward the centre. */
  const ellipsoid = (c, r, falloff = 1) => {
    const d = unitVec();
    const k = Math.cbrt(rng()) ** falloff;
    return [c[0] + d[0] * r[0] * k, c[1] + d[1] * r[1] * k, c[2] + d[2] * r[2] * k];
  };
  const ellipsoidSurface = (c, r, jitter) => {
    const d = unitVec();
    const j = 1 + gauss() * jitter;
    return [c[0] + d[0] * r[0] * j, c[1] + d[1] * r[1] * j, c[2] + d[2] * r[2] * j];
  };
  /** Gaussian blob around a point. */
  const blob = (c, sd) => [c[0] + gauss() * sd, c[1] + gauss() * sd, c[2] + gauss() * sd];
  /** Along a straight tube from a to b with a gaussian cross-section, optionally tapering. */
  const tube = (a, b, sd, taper = 1) => {
    const t = rng();
    const s = sd * (1 - (1 - taper) * t);
    return [
      a[0] + (b[0] - a[0]) * t + gauss() * s,
      a[1] + (b[1] - a[1]) * t + gauss() * s,
      a[2] + (b[2] - a[2]) * t + gauss() * s,
    ];
  };
  return { gauss, unitVec, ellipsoid, ellipsoidSurface, blob, tube };
}

/**
 * Directions for the retinotopic columns of one optic lobe: a Fibonacci
 * lattice on a spherical cap around the +/-x axis.
 */
function columnLattice(count, maxAngle) {
  const cols = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const cosMax = Math.cos(maxAngle);
  for (let k = 0; k < count; k++) {
    const cosA = 1 - ((k + 0.5) / count) * (1 - cosMax);
    const beta = k * golden;
    cols.push([Math.acos(cosA), beta]);
  }
  return cols;
}

/**
 * Build the brain.
 * @returns {{
 *   count:number, positions:Float32Array, cluster:Float32Array, phase:Float32Array, size:Float32Array,
 *   tracts:{positions:Float32Array, t:Float32Array, edge:Float32Array, color:Float32Array, count:number},
 *   bounds:{min:number[], max:number[]}
 * }}
 */
export function buildBrain(seed = 44, brainCount = BRAIN_NEURONS, vncCount = VNC_NEURONS) {
  const count = brainCount + vncCount;
  // small test builds scale every region down proportionally
  const k = brainCount / BRAIN_NEURONS;
  const kv = vncCount / VNC_NEURONS;
  const n_ = (x) => Math.round(x * k);
  const nv = (x) => Math.round(x * kv);
  // paired neuropils: left gets floor(total / 2), right the rest, so odd totals stay exact
  const half = (total, side) => {
    const t = n_(total);
    return side < 0 ? Math.floor(t / 2) : t - Math.floor(t / 2);
  };
  const rng = mulberry32(seed);
  const S = makeSampler(rng);
  const positions = new Float32Array(count * 3);
  const cluster = new Float32Array(count);
  const phase = new Float32Array(count);
  const size = new Float32Array(count);
  let n = 0;

  const put = (p, c, sz) => {
    if (n >= count) return;
    positions[n * 3] = p[0];
    positions[n * 3 + 1] = p[1];
    positions[n * 3 + 2] = p[2];
    cluster[n] = c;
    phase[n] = rng();
    // a sprinkle of large "hub" neurons makes the cloud read as cells, not dust
    size[n] = rng() < 0.015 ? sz * 2.6 : sz * (0.6 + 0.8 * rng());
    n++;
  };
  const fill = (k, c, sz, gen) => {
    for (let i = 0; i < k; i++) put(gen(i), c, sz);
  };

  // ---- optic lobes: columnar lamina / medulla + lobula / lobula plate ----
  const opticLobe = (side, c) => {
    const total = half(REGION_COUNTS.OL, side);
    const centre = [side * 2.55, 3.0, 0.0];
    const cols = columnLattice(780, 0.95);
    const layer = (k, rIn, rOut, offset, spread, stretchY) => {
      fill(k, c, 0.055, () => {
        const [a0, b0] = cols[Math.floor(rng() * cols.length)];
        const a = a0 * spread + S.gauss() * 0.01;
        const b = b0 + S.gauss() * 0.01;
        const R = rIn + (rOut - rIn) * rng();
        const dx = Math.cos(a);
        const dy = Math.sin(a) * Math.sin(b);
        const dz = Math.sin(a) * Math.cos(b);
        return [
          centre[0] + side * dx * R + offset[0] * side,
          centre[1] + dy * R * stretchY + offset[1],
          centre[2] + dz * R + offset[2],
        ];
      });
    };
    const lamina = Math.round(total * 0.14);
    const medulla = Math.round(total * 0.5);
    const lobula = Math.round(total * 0.23);
    layer(lamina, 2.55, 2.68, [0, 0, 0], 1.0, 1.35); // lamina (+ photoreceptor terminals)
    layer(medulla, 1.72, 2.12, [0, 0, 0], 0.95, 1.3); // medulla
    layer(lobula, 1.05, 1.4, [-0.1, -0.05, -0.25], 0.75, 1.15); // lobula
    layer(total - lamina - medulla - lobula, 1.15, 1.32, [0.05, 0.0, -0.75], 0.6, 1.1); // lobula plate
  };
  opticLobe(-1, C.OL_L);
  opticLobe(1, C.OL_R);

  // ---- antennal lobes: ~48 glomeruli each ----
  const antennalLobe = (c, side) => {
    const anchor = CLUSTERS[c].anchor;
    const glomeruli = Array.from({ length: 48 }, () => S.ellipsoid(anchor, [0.46, 0.42, 0.4], 0.6));
    fill(half(REGION_COUNTS.AL, side), c, 0.06, () => S.blob(glomeruli[Math.floor(rng() * glomeruli.length)], 0.065));
  };
  antennalLobe(C.AL_L, -1);
  antennalLobe(C.AL_R, 1);

  // ---- mushroom bodies: Kenyon-cell rind, calyx, peduncle, vertical + medial lobes ----
  const mushroomBody = (side, c) => {
    const calyx = [side * 1.45, 4.05, -0.95];
    const heel = [side * 1.1, 2.85, 0.95];
    const total = half(REGION_COUNTS.MB, side);
    const part = (f) => Math.round(total * f);
    // Kenyon-cell somata rind, calyx, peduncle, vertical and medial lobes
    fill(part(0.17), c, 0.05, () => {
      const d = S.unitVec();
      if (d[1] < -0.2) d[1] = -d[1];
      return [calyx[0] + d[0] * 0.62, calyx[1] + Math.abs(d[1]) * 0.55 + 0.1, calyx[2] + d[2] * 0.5 - 0.1];
    });
    fill(part(0.29), c, 0.055, () => {
      const d = S.unitVec();
      const r = 0.28 + 0.17 * rng();
      return [calyx[0] + d[0] * r, calyx[1] + Math.abs(d[1]) * r * 0.8, calyx[2] + d[2] * r];
    });
    fill(part(0.19), c, 0.05, () => S.tube([side * 1.42, 3.8, -0.65], heel, 0.075));
    fill(part(0.17), c, 0.055, () => S.tube(heel, [side * 1.28, 4.25, 1.1], 0.09, 0.7));
    fill(total - part(0.17) - part(0.29) - part(0.19) - part(0.17), c, 0.055, () =>
      S.tube(heel, [side * 0.12, 2.92, 1.02], 0.095, 0.8),
    );
  };
  mushroomBody(-1, C.MB_L);
  mushroomBody(1, C.MB_R);

  // ---- lateral horns ----
  for (const [c, side] of [
    [C.LH_L, -1],
    [C.LH_R, 1],
  ]) {
    fill(half(REGION_COUNTS.LH, side), c, 0.07, () => S.ellipsoid(CLUSTERS[c].anchor, [0.55, 0.5, 0.45], 1.3));
  }

  // ---- central complex: fan-shaped body, ellipsoid body, protocerebral bridge ----
  const cx = n_(REGION_COUNTS.CX);
  fill(Math.round(cx * 0.5), C.CX, 0.055, () => {
    const col = Math.floor(rng() * 9);
    const theta = (-62 + col * 15.5 + S.gauss() * 2.2) * (Math.PI / 180);
    const layerR = 0.55 + Math.floor(rng() * 6) * 0.075 + S.gauss() * 0.012;
    return [layerR * Math.sin(theta), 3.05 + layerR * Math.cos(theta) * 0.62, -0.35 + S.gauss() * 0.07];
  });
  fill(Math.round(cx * 0.3), C.CX, 0.055, () => {
    const u = rng() * TAU;
    const v = rng() * TAU;
    const r = 0.36 + 0.085 * Math.cos(v);
    return [r * Math.cos(u), 2.95 + r * Math.sin(u), 0.25 + 0.085 * Math.sin(v)];
  });
  fill(cx - Math.round(cx * 0.5) - Math.round(cx * 0.3), C.CX, 0.055, () => {
    const g = Math.floor(rng() * 18);
    const x = -0.95 + (g + 0.5) * (1.9 / 18) + S.gauss() * 0.02;
    return [x, 3.95 + 0.28 * x * x + S.gauss() * 0.035, -0.9 + S.gauss() * 0.04];
  });

  // ---- PAM dopaminergic clusters + their projections to the MB lobes ----
  const pam = n_(REGION_COUNTS.PAM);
  fill(Math.round(pam * 0.78), C.PAM, 0.075, () => S.blob([(rng() < 0.5 ? -1 : 1) * 0.55, 2.62, 1.3], 0.12));
  fill(pam - Math.round(pam * 0.78), C.PAM, 0.05, () => {
    const side = rng() < 0.5 ? -1 : 1;
    return S.tube([side * 0.55, 2.62, 1.3], [side * 0.7, 2.9, 1.0], 0.05);
  });

  // ---- subesophageal zone ----
  fill(n_(REGION_COUNTS.SEZ), C.SEZ, 0.065, () => S.ellipsoid(CLUSTERS[C.SEZ].anchor, [1.05, 0.55, 0.75], 1.1));

  // ---- descending neurons: neck connective + long fibres into the VNC ----
  const dn = n_(REGION_COUNTS.DN);
  fill(Math.round(dn * 0.6), C.DN, 0.055, () => S.tube([0, 1.3, 0.1], [0, -0.9, 0], 0.17));
  const fibres = Array.from({ length: 14 }, () => [S.gauss() * 0.3, S.gauss() * 0.22]);
  fill(dn - Math.round(dn * 0.6), C.DN, 0.045, () => {
    const [fx, fz] = fibres[Math.floor(rng() * fibres.length)];
    const y = -0.9 - rng() * 6.0;
    return [fx + S.gauss() * 0.02, y, fz + S.gauss() * 0.02];
  });

  // ---- protocerebrum: diffuse neuropil + cortex rind; takes whatever is left ----
  const protoCentre = [0, 3.3, 0];
  const rind = Math.floor((brainCount - n) * 0.35);
  fill(rind, C.PROTO, 0.05, () => S.ellipsoidSurface(protoCentre, [2.95, 1.6, 1.4], 0.035));
  while (n < brainCount) put(S.ellipsoid(protoCentre, [2.6, 1.35, 1.2], 1.25), C.PROTO, 0.055);
  const brainPoints = n;

  // ---- VNC neuromeres (paired hemi-neuromeres) with leg / wing nerves ----
  // exactly k points: paired hemi-neuromere bodies + left/right nerves
  const neuromere = (c, k, y, r, nerves) => {
    const per = Math.floor((k * 0.28) / (2 * nerves.length));
    fill(k - per * 2 * nerves.length, c, 0.06, () => {
      const side = rng() < 0.5 ? -1 : 1;
      return S.ellipsoid([side * 0.42, y, 0], r, 1.1);
    });
    for (const [a, b, sd] of nerves) {
      fill(per, c, 0.045, () => S.tube(a, b, sd, 0.45));
      fill(per, c, 0.045, () => S.tube([-a[0], a[1], a[2]], [-b[0], b[1], b[2]], sd, 0.45));
    }
  };
  neuromere(C.T1, nv(REGION_COUNTS.T1), -1.8, [0.62, 0.8, 0.62], [[[0.8, -1.9, 0.2], [2.3, -2.7, 0.8], 0.06]]);
  neuromere(C.T2, nv(REGION_COUNTS.T2), -3.7, [0.72, 0.95, 0.68], [
    [[0.9, -3.9, 0.2], [2.5, -4.3, 0.8], 0.06],
    [[0.7, -3.3, -0.3], [1.9, -3.0, -1.0], 0.05],
  ]);
  const abdominal = nv(1800);
  neuromere(C.T3, nv(REGION_COUNTS.T3) - abdominal, -5.45, [0.62, 0.8, 0.58], [[[0.8, -5.6, 0.2], [2.4, -6.3, 0.7], 0.06]]);
  // abdominal ganglion tail; tops the VNC up to its exact count
  while (n < count) put(S.tube([0, -6.1, 0], [0, -7.9, -0.25], 0.22, 0.25), C.T3, 0.05);


  const bounds = computeBounds(positions, count);
  return { count, brainCount: brainPoints, positions, cluster, phase, size, tracts: buildTracts(S), bounds };
}

function computeBounds(positions, count) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/** Class colors (linear RGB). Shared by the points, tracts and HUD chips. */
export const CLUSTER_COLORS = CLUSTERS.map((c) => {
  switch (c.key) {
    case 'OL_L':
    case 'OL_R':
      return [0.1, 0.78, 1.0];
    case 'AL_L':
    case 'AL_R':
      return [0.22, 0.45, 1.0];
    case 'MB_L':
    case 'MB_R':
      return [0.62, 0.28, 1.0];
    case 'LH_L':
    case 'LH_R':
      return [0.95, 0.22, 0.85];
    case 'CX':
      return [1.0, 0.3, 0.72];
    case 'PROTO':
      return [0.46, 0.28, 0.95];
    case 'PAM':
      return [0.85, 0.4, 1.0];
    case 'SEZ':
      return [1.0, 0.55, 0.14];
    case 'DN':
      return [1.0, 0.38, 0.1];
    default:
      return [1.0, 0.24, 0.1]; // VNC
  }
});

const STRANDS_PER_EDGE = 7;
const SEGMENTS_PER_STRAND = 40;

/** Axon bundles along each connectome edge, as line-segment pairs. */
function buildTracts(S) {
  const verts = EDGES.length * STRANDS_PER_EDGE * SEGMENTS_PER_STRAND * 2;
  const positions = new Float32Array(verts * 3);
  const t = new Float32Array(verts);
  const edge = new Float32Array(verts);
  const color = new Float32Array(verts * 3);
  let v = 0;

  EDGES.forEach((e, ei) => {
    const a = CLUSTERS[e.from].anchor;
    const b = CLUSTERS[e.to].anchor;
    const dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...dir) || 1;
    // bulge perpendicular to the edge (in the plane with +z) so bundles arc
    let perp = [dir[1], -dir[0], 0];
    const pl = Math.hypot(...perp);
    perp = pl < 1e-6 ? [1, 0, 0] : perp.map((x) => x / pl);
    const bend = (ei % 2 ? 1 : -1) * 0.16 * len;
    const mid = [
      (a[0] + b[0]) / 2 + perp[0] * bend,
      (a[1] + b[1]) / 2 + perp[1] * bend,
      (a[2] + b[2]) / 2 + 0.25 * len * 0.3,
    ];
    const ca = CLUSTER_COLORS[e.from];
    const cb = CLUSTER_COLORS[e.to];
    for (let s = 0; s < STRANDS_PER_EDGE; s++) {
      const p0 = S.blob(a, 0.1);
      const p1 = S.blob(mid, 0.14);
      const p2 = S.blob(b, 0.1);
      let prev = null;
      for (let k = 0; k <= SEGMENTS_PER_STRAND; k++) {
        const u = k / SEGMENTS_PER_STRAND;
        const w0 = (1 - u) * (1 - u);
        const w1 = 2 * (1 - u) * u;
        const w2 = u * u;
        const p = [
          w0 * p0[0] + w1 * p1[0] + w2 * p2[0],
          w0 * p0[1] + w1 * p1[1] + w2 * p2[1],
          w0 * p0[2] + w1 * p1[2] + w2 * p2[2],
        ];
        if (prev) {
          for (const [q, qu] of [
            [prev.p, prev.u],
            [p, u],
          ]) {
            positions.set(q, v * 3);
            t[v] = qu;
            edge[v] = ei;
            color[v * 3] = ca[0] + (cb[0] - ca[0]) * qu;
            color[v * 3 + 1] = ca[1] + (cb[1] - ca[1]) * qu;
            color[v * 3 + 2] = ca[2] + (cb[2] - ca[2]) * qu;
            v++;
          }
        }
        prev = { p, u };
      }
    }
  });
  return { positions, t, edge, color, count: v };
}
