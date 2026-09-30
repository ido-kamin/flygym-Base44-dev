// Whole-brain leaky integrate-and-fire model of the fly (Shiu et al. 2024),
// running on the FlyWire v783 connectome (138,639 neurons, 2.7M connections of
// >= 5 synapses) packed by scripts/prep_flywire_connectome.py.
//
// Same equations and constants as the published model (model.py):
//   dv/dt = (v0 - v + g) / tau_m     (unless refractory)
//   dg/dt = -g / tau_syn
//   spike when v > v_th: v = v_reset, g = 0, refractory t_ref
//   each presynaptic spike adds w = w_syn x (signed synapse count) to g of
//   every target after a 1.8 ms synaptic delay
//   Poisson inputs (sensory drive) add poissonWeight to v per input spike.
// Integrated with forward Euler at dt = 1 ms (the delay rounds to 2 steps) so
// the whole brain runs in a browser Web Worker.

const MAGIC = 'FWC2';

/** Decode the packed connectome (already gunzipped) into typed arrays. */
export function parseConnectome(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== MAGIC) throw new Error(`not a FlyWire connectome file (${magic})`);
  const view = new DataView(buffer);
  const hlen = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hlen)));
  let off = 8 + hlen;
  off += (4 - (off % 4)) % 4;
  const n = header.n;
  const offsets = new Uint32Array(buffer.slice(off, off + (n + 1) * 4));
  off += (n + 1) * 4;
  const cluster = bytes.slice(off, off + n);
  off += n;
  const side = bytes.slice(off, off + n);
  off += n;
  const nnz = offsets[n];
  const post = new Int32Array(nnz);
  const weight = new Float32Array(nnz);
  let p = off;
  const readVarint = () => {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = bytes[p++];
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return result;
  };
  for (let row = 0; row < n; row++) {
    let prev = 0;
    for (let e = offsets[row]; e < offsets[row + 1]; e++) {
      prev += readVarint();
      post[e] = prev;
      const z = readVarint();
      weight[e] = z & 1 ? -(z + 1) / 2 : z / 2; // un-zigzag: signed synapse count
    }
  }
  return { header, n, nnz, offsets, post, weight, cluster, side };
}

/** mulberry32 */
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class LIFBrain {
  /**
   * Event-driven integration: only neurons that received input, are driven,
   * refractory, or not yet back at rest are updated each step (the "active
   * set"). The equations are the same as the dense model; a neuron leaves the
   * active set once v and g have decayed to rest (|v - v0| < 1e-3 mV, |g| < 1e-4 mV),
   * where the dense update would leave it unchanged anyway.
   * @param {ReturnType<typeof parseConnectome>} conn
   * @param {{dt?:number, seed?:number}} [opts]
   */
  constructor(conn, { dt = 1.0, seed = 1 } = {}) {
    const P = conn.header.params;
    this.conn = conn;
    this.n = conn.n;
    this.dt = dt;
    this.P = P;
    const n = this.n;
    this.v = new Float32Array(n).fill(P.v0);
    this.g = new Float32Array(n);
    this.refr = new Float32Array(n);
    this.delaySteps = Math.max(1, Math.round(P.delay / dt));
    const D = this.delaySteps + 1;
    this.ring = Array.from({ length: D }, () => new Float32Array(n));
    this.touched = Array.from({ length: D }, () => new Int32Array(n));
    this.touchedCount = new Int32Array(D);
    this.touchStamp = new Int32Array(n).fill(-1);
    this.active = new Int32Array(n);
    this.activeCount = 0;
    this.nextActive = new Int32Array(n);
    this.isActive = new Uint8Array(n);
    this.wmv = new Float32Array(conn.weight.length);
    for (let i = 0; i < this.wmv.length; i++) this.wmv[i] = conn.weight[i] * P.wSyn;
    this.decayG = Math.exp(-dt / P.tauSyn);
    this.kM = dt / P.tauM;
    this.t = 0; // ms
    this.step_ = 0;
    this.rng = rng32(seed);
    /** Poisson drive: neuron index -> rate (Hz) */
    this.drive = new Map();
    // exponentially filtered firing rate (Hz, tau 60 ms), decayed lazily per neuron
    this.rateTau = 60;
    this.rate = new Float32Array(n);
    this.rateStep = new Int32Array(n);
    this.decayTable = Float32Array.from({ length: 2048 }, (_, k) => Math.exp((-k * dt) / this.rateTau));
    this.rateKick = 1000 / this.rateTau;
    this.spikesThisWindow = 0;
    this.totalSpikes = 0;
    this.spikeCount = new Uint32Array(n); // spikes per neuron since the start
    this.poissonTargets = new Uint8Array(n); // Poisson targets have no refractory period
  }

  /** Set the Poisson rate (Hz) for a list of neurons (0 removes the drive). */
  setDrive(indices, hz) {
    for (const i of indices) {
      if (hz > 0) {
        this.drive.set(i, hz);
        this.poissonTargets[i] = 1;
      } else {
        this.drive.delete(i);
        this.poissonTargets[i] = 0;
      }
    }
  }

  /**
   * Return every neuron to rest (v = v0, g = 0, nothing in flight), keeping the
   * Poisson drives. The published model is run as separate trials from rest;
   * this starts a new one. (Filtered rates are only a display trace and fade out.)
   */
  rest() {
    this.v.fill(this.P.v0);
    this.g.fill(0);
    this.refr.fill(0);
    for (const r of this.ring) r.fill(0);
    this.touchedCount.fill(0);
    this.touchStamp.fill(-1);
    this.isActive.fill(0);
    this.activeCount = 0;
    for (const i of this.drive.keys()) this.wake(i);
  }

  wake(i) {
    if (!this.isActive[i]) {
      this.isActive[i] = 1;
      this.active[this.activeCount++] = i;
    }
  }

  /** Advance one dt; returns the number of spikes. */
  step() {
    const { v, g, refr, P, kM, decayG, rate, rateStep, decayTable } = this;
    const { offsets, post } = this.conn;
    const wmv = this.wmv;
    const D = this.delaySteps + 1;
    const slotNow = this.step_ % D;
    const slotFuture = (this.step_ + this.delaySteps) % D;
    const now = this.ring[slotNow];
    const future = this.ring[slotFuture];
    const futureList = this.touched[slotFuture];
    const futureStamp = this.step_ + this.delaySteps;
    const dt = this.dt;

    // 1. deliver synaptic input that arrives this step
    const arrived = this.touched[slotNow];
    for (let k = 0, c = this.touchedCount[slotNow]; k < c; k++) {
      const i = arrived[k];
      g[i] += now[i];
      now[i] = 0;
      this.wake(i);
    }
    this.touchedCount[slotNow] = 0;

    // 2. Poisson (sensory) input spikes
    for (const [i, hz] of this.drive) {
      if (this.rng() < (hz * dt) / 1000) v[i] += P.poissonWeight;
      this.wake(i);
    }

    // 3. integrate the active set
    let spikes = 0;
    let nextCount = 0;
    const next = this.nextActive;
    const vTh = P.vTh;
    const v0 = P.v0;
    let fc = this.touchedCount[slotFuture];
    const step = this.step_;
    for (let k = 0, c = this.activeCount; k < c; k++) {
      const i = this.active[k];
      if (refr[i] > 0) {
        refr[i] -= dt;
        next[nextCount++] = i;
        continue;
      }
      v[i] += kM * (v0 - v[i] + g[i]);
      g[i] *= decayG;
      if (v[i] > vTh) {
        spikes++;
        this.spikeCount[i]++;
        v[i] = P.vReset;
        g[i] = 0;
        refr[i] = this.poissonTargets[i] ? 0 : P.tRef;
        // lazy rate decay, then the spike kick
        const age = step - rateStep[i];
        rate[i] = (age < 2048 ? rate[i] * decayTable[age] : 0) + this.rateKick;
        rateStep[i] = step;
        for (let e = offsets[i], end = offsets[i + 1]; e < end; e++) {
          const j = post[e];
          future[j] += wmv[e];
          if (this.touchStamp[j] !== futureStamp) {
            this.touchStamp[j] = futureStamp;
            futureList[fc++] = j;
          }
        }
      }
      const dv = v[i] - v0;
      if (refr[i] > 0 || dv > 1e-3 || dv < -1e-3 || g[i] > 1e-4 || g[i] < -1e-4 || this.poissonTargets[i]) {
        next[nextCount++] = i;
      } else {
        v[i] = v0;
        g[i] = 0;
        this.isActive[i] = 0;
      }
    }
    this.touchedCount[slotFuture] = fc;
    // swap active lists
    this.nextActive = this.active;
    this.active = next;
    this.activeCount = nextCount;

    this.t += dt;
    this.step_++;
    this.spikesThisWindow += spikes;
    this.totalSpikes += spikes;
    return spikes;
  }

  /** Current filtered rate (Hz) of one neuron. */
  rateOf(i) {
    const age = this.step_ - this.rateStep[i];
    return age < 2048 ? this.rate[i] * this.decayTable[age] : 0;
  }

  /** Mean filtered rate (Hz) over a list of neurons. */
  groupRate(indices) {
    if (!indices?.length) return 0;
    let s = 0;
    for (const i of indices) s += this.rateOf(i);
    return s / indices.length;
  }

  /** Mean rate per game cluster (Hz). */
  clusterRates(out = new Float32Array(16)) {
    const { cluster } = this.conn;
    const counts = this.conn.header.clusterCounts;
    out.fill(0);
    for (let i = 0; i < this.n; i++) out[cluster[i]] += this.rateOf(i);
    for (let c = 0; c < 16; c++) out[c] = counts[c] ? out[c] / counts[c] : 0;
    return out;
  }

  /** Per-neuron activity 0..255 for rendering (a neuron firing >= 40 Hz is fully lit). */
  activityBytes(out = new Uint8Array(this.n)) {
    for (let i = 0; i < this.n; i++) {
      const x = this.rateOf(i) * 6.4;
      out[i] = x > 255 ? 255 : x;
    }
    return out;
  }
}

/**
 * Continuous senses -> Poisson drive rates (Hz). Light, looming and touch
 * drive feed-forward pathways that fall silent when the input stops. Smell and
 * taste are given as trials instead (see TRIALS).
 * `visionL/R` 0..1: how much the image on each eye is changing (the fly's own
 * motion plus nearby animals); photoreceptors fire 6 Hz in steady light and up
 * to 30 Hz with strong flicker.
 */
export function sensoryDrive({ visionL = 0, visionR = 0, loomL = 0, loomR = 0, touch = 0 }) {
  const clamp = (x) => Math.max(0, Math.min(1, x));
  return {
    visionL: 6 + 24 * clamp(visionL),
    visionR: 6 + 24 * clamp(visionR),
    loomingL: 140 * clamp(loomL),
    loomingR: 140 * clamp(loomR),
    mechano: 60 * clamp(touch),
  };
}

/**
 * Stimulus trials, run like the published model's experiments: a fixed-rate
 * Poisson stimulus for a fixed time, after which the brain returns to rest.
 * Taste and smell recruit the recurrent antennal-lobe / mushroom-body /
 * lateral-horn loop, which in this model (as published: no spike-frequency
 * adaptation, no graded APL inhibition) keeps firing after the stimulus ends,
 * so each trial ends by resetting to rest instead of letting it run on.
 */
export const TRIALS = {
  // Shiu et al. stimulate sugar GRNs at 200 Hz (for 1 s); a shorter trial keeps
  // the recruited brain close to real time in a browser
  sugar: { group: 'sugar', hz: 200, ms: 400 },
  smellL: { group: 'olfactoryL', hz: 30, ms: 250 },
  smellR: { group: 'olfactoryR', hz: 30, ms: 250 },
};
