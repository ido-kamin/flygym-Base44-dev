// A 16-cluster rate model of the fly central nervous system.
//
// Each cluster is a neuropil (optic lobe, mushroom body, central complex, ...)
// whose mean activity follows leaky integration toward tanh(drive). Edges are
// the major Sensory -> Intrinsic -> Motor pathways; six of them are scaled by
// the genome, which is how the 24-bit DNA changes behaviour. When a cluster
// crosses threshold it "fires": the event is reported to the renderers and a
// pulse travels down each outgoing tract, kicking the target on arrival
// (the message-passing cascade that is drawn in 3D).

import { GENE_INDEX, norm } from './genome.js';

export const CLASS_SENSORY = 'sensory';
export const CLASS_INTRINSIC = 'intrinsic';
export const CLASS_MOTOR = 'motor';

// anchor: cluster centroid in brain space (units ~ 50 um; +y dorsal, +z anterior)
export const CLUSTERS = [
  { key: 'OL_L', name: 'Optic lobe L', cls: CLASS_SENSORY, anchor: [-4.3, 3.0, 0.0], tau: 0.08 },
  { key: 'OL_R', name: 'Optic lobe R', cls: CLASS_SENSORY, anchor: [4.3, 3.0, 0.0], tau: 0.08 },
  { key: 'AL_L', name: 'Antennal lobe L', cls: CLASS_SENSORY, anchor: [-0.8, 2.3, 1.5], tau: 0.08 },
  { key: 'AL_R', name: 'Antennal lobe R', cls: CLASS_SENSORY, anchor: [0.8, 2.3, 1.5], tau: 0.08 },
  { key: 'MB_L', name: 'Mushroom body L', cls: CLASS_INTRINSIC, anchor: [-1.35, 3.4, 0.3], tau: 0.12 },
  { key: 'MB_R', name: 'Mushroom body R', cls: CLASS_INTRINSIC, anchor: [1.35, 3.4, 0.3], tau: 0.12 },
  { key: 'LH_L', name: 'Lateral horn L', cls: CLASS_INTRINSIC, anchor: [-2.4, 3.5, -0.6], tau: 0.1 },
  { key: 'LH_R', name: 'Lateral horn R', cls: CLASS_INTRINSIC, anchor: [2.4, 3.5, -0.6], tau: 0.1 },
  { key: 'CX', name: 'Central complex', cls: CLASS_INTRINSIC, anchor: [0.0, 3.25, -0.2], tau: 0.15 },
  { key: 'PROTO', name: 'Protocerebrum', cls: CLASS_INTRINSIC, anchor: [0.0, 4.15, 0.0], tau: 0.2 },
  { key: 'PAM', name: 'PAM dopamine', cls: CLASS_INTRINSIC, anchor: [0.0, 2.65, 1.25], tau: 0.1 },
  { key: 'SEZ', name: 'Subesophageal zone', cls: CLASS_MOTOR, anchor: [0.0, 1.65, 0.4], tau: 0.1 },
  { key: 'DN', name: 'Descending neurons', cls: CLASS_MOTOR, anchor: [0.0, 0.3, 0.0], tau: 0.08 },
  { key: 'T1', name: 'VNC prothoracic T1', cls: CLASS_MOTOR, anchor: [0.0, -1.8, 0.0], tau: 0.08 },
  { key: 'T2', name: 'VNC mesothoracic T2', cls: CLASS_MOTOR, anchor: [0.0, -3.7, 0.0], tau: 0.08 },
  { key: 'T3', name: 'VNC metathoracic T3', cls: CLASS_MOTOR, anchor: [0.0, -5.6, 0.0], tau: 0.08 },
];

export const C = Object.fromEntries(CLUSTERS.map((c, i) => [c.key, i]));
export const CLUSTER_COUNT = CLUSTERS.length;

const G = GENE_INDEX;
// [from, to, base weight, gene index scaling it (or null)]
const EDGE_TABLE = [
  ['OL_L', 'LH_L', 1.3, G.fear],
  ['OL_R', 'LH_R', 1.3, G.fear],
  ['OL_L', 'CX', 0.35, null],
  ['OL_R', 'CX', 0.35, null],
  ['OL_L', 'OL_R', 0.1, null],
  ['AL_L', 'MB_L', 1.2, G.food],
  ['AL_R', 'MB_R', 1.2, G.food],
  ['SEZ', 'PAM', 1.0, G.reward],
  ['PAM', 'MB_L', 0.7, G.reward],
  ['PAM', 'MB_R', 0.7, G.reward],
  ['MB_L', 'PROTO', 0.5, null],
  ['MB_R', 'PROTO', 0.5, null],
  ['LH_L', 'DN', 0.8, null],
  ['LH_R', 'DN', 0.8, null],
  ['PROTO', 'CX', 0.6, G.steer],
  ['CX', 'DN', 0.5, G.steer],
  ['PROTO', 'DN', 0.7, G.speed],
  ['CX', 'PROTO', 0.35, G.noise],
  ['SEZ', 'DN', 0.3, null],
  ['DN', 'T1', 1.0, null],
  ['DN', 'T2', 1.0, null],
  ['DN', 'T3', 1.0, null],
  ['T1', 'T2', 0.3, null],
  ['T2', 'T3', 0.3, null],
];

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Conduction speed along tracts, in brain units per second. */
export const CONDUCTION_SPEED = 14;

export const EDGES = EDGE_TABLE.map(([from, to, weight, gene]) => {
  const f = C[from];
  const t = C[to];
  const delay = 0.08 + dist3(CLUSTERS[f].anchor, CLUSTERS[t].anchor) / CONDUCTION_SPEED;
  return { from: f, to: t, weight, gene, delay };
});

/** Genome level -> multiplicative gain on a gene-scaled edge (0.2 .. 1.8). */
export const geneGain = (level) => 0.2 + 1.6 * norm(level);

const FIRE_THRESHOLD = 0.5;
const REFRACTORY = 0.45;
const PULSE_KICK = 0.12;
const MAX_ACTIVITY = 1.6;

export class Connectome {
  constructor() {
    this.a = new Float32Array(CLUSTER_COUNT);
    this.drive = new Float32Array(CLUSTER_COUNT);
    this.refractory = new Float32Array(CLUSTER_COUNT);
    this.edgeWeights = new Float32Array(EDGES.length);
    this.pulses = []; // {edge, arrive}
    this.time = 0;
    this.setWeights([8, 8, 8, 8, 8, 8]);
  }

  reset() {
    this.a.fill(0);
    this.refractory.fill(0);
    this.pulses.length = 0;
  }

  setWeights(weights) {
    EDGES.forEach((e, i) => {
      this.edgeWeights[i] = e.weight * (e.gene === null ? 1 : geneGain(weights[e.gene]));
    });
  }

  /** Instantaneous activity boost (reward, collisions, pulse arrivals). */
  kick(cluster, amount) {
    this.a[cluster] = Math.min(MAX_ACTIVITY, this.a[cluster] + amount);
  }

  /**
   * Advance by h seconds with external sensory input. Fired clusters and
   * launched tract pulses are appended to `events`.
   */
  step(h, input, events) {
    this.time += h;
    const { a, drive, refractory, edgeWeights } = this;

    for (let i = 0; i < CLUSTER_COUNT; i++) drive[i] = input[i];
    for (let e = 0; e < EDGES.length; e++) {
      drive[EDGES[e].to] += edgeWeights[e] * Math.min(1, a[EDGES[e].from]);
    }

    for (let i = 0; i < CLUSTER_COUNT; i++) {
      const target = Math.tanh(Math.max(0, drive[i]));
      a[i] += (h / CLUSTERS[i].tau) * (target - a[i]);
      if (a[i] < 0) a[i] = 0;
      refractory[i] -= h;
      if (a[i] > FIRE_THRESHOLD && refractory[i] <= 0) {
        refractory[i] = REFRACTORY;
        events.push({ type: 'fire', cluster: i, strength: a[i] });
        for (let e = 0; e < EDGES.length; e++) {
          if (EDGES[e].from !== i) continue;
          this.pulses.push({ edge: e, arrive: this.time + EDGES[e].delay });
          events.push({ type: 'pulse', edge: e, duration: EDGES[e].delay, strength: a[i] });
        }
      }
    }

    // deliver arrived pulses (kept sorted-free; the list is short)
    for (let k = this.pulses.length - 1; k >= 0; k--) {
      const p = this.pulses[k];
      if (p.arrive <= this.time) {
        const e = EDGES[p.edge];
        this.kick(e.to, PULSE_KICK * edgeWeights[p.edge]);
        this.pulses.splice(k, 1);
      }
    }
  }

  /**
   * Braitenberg-style readout of the motor command from cluster activity.
   * Left/right mushroom-body contrast steers toward food, lateral-horn
   * contrast steers away from threats, descending-neuron activity sets speed.
   * @returns {{turn:number, drive:number}} turn in [-1, 1] (+ = clockwise), drive in [0, 1]
   */
  motor(weights) {
    const a = this.a;
    const steer = 0.35 + 1.3 * norm(weights[G.steer]);
    const approach = a[C.MB_R] - a[C.MB_L];
    const avoid = a[C.LH_L] - a[C.LH_R];
    const turn = Math.max(-1, Math.min(1, steer * (2.4 * approach + 3.2 * avoid)));
    const drive = Math.min(1, a[C.DN]);
    return { turn, drive };
  }
}
