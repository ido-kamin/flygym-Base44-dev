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

const MAGICS = ['FWC2', 'FWC3']; // FWC3 adds soma positions

/** Decode the packed connectome (already gunzipped) into typed arrays. */
export function parseConnectome(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (!MAGICS.includes(magic)) throw new Error(`not a FlyWire connectome file (${magic})`);
  const view = new DataView(buffer);
  const hlen = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hlen)));
  let off = 8 + hlen;
  off += (4 - (off % 4)) % 4;
  const n = header.n;
  const offsets = new Uint32Array(buffer.slice(off, off + (n + 1) * 4));
  off += (n + 1) * 4;
  let positions = null; // Float32 xyz per neuron, nm
  if (magic === 'FWC3') {
    const q = new Uint16Array(buffer.slice(off, off + n * 6));
    off += n * 6;
    const { min, span } = header.positions;
    positions = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) positions[i] = min[i % 3] + (q[i] / 65535) * span[i % 3];
  }
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
  return { header, n, nnz, offsets, post, weight, cluster, side, positions };
}

/** Presynaptic neuron of each plastic edge. */
function buildPreIndex(offsets, byMbon) {
  const wanted = new Set();
  for (const edges of byMbon.values()) for (const e of edges) wanted.add(e);
  const out = new Map();
  for (let i = 0; i + 1 < offsets.length; i++) {
    for (let e = offsets[i]; e < offsets[i + 1]; e++) if (wanted.has(e)) out.set(e, i);
  }
  return out;
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
  constructor(conn, { dt = 1.0, seed = 1, wmv = null } = {}) {
    const P = conn.header.params;
    this.conn = conn;
    this.n = conn.n;
    this.dt = dt;
    this.P = P;
    const n = this.n;
    this.v = new Float32Array(n).fill(P.v0);
    this.g = new Float32Array(n);
    // refractory countdown in whole steps (t_ref 2.2 ms at dt 1 ms: the 3 steps a float countdown from 2.2 takes)
    this.refr = new Uint8Array(n);
    this.refrSteps = Math.max(1, Math.ceil(P.tRef / dt - 1e-9));
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
    // synaptic weights in mV (a private copy: learning changes them)
    this.wmv = new Float32Array(conn.weight.length);
    if (wmv) this.wmv.set(wmv);
    else for (let i = 0; i < this.wmv.length; i++) this.wmv[i] = conn.weight[i] * P.wSyn;
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
    this.eligibleFrom = 0;
    /** spontaneous activity: Hz per neuron, and the depolarization of each spontaneous event (mV) */
    this.background = 0;
    this.bgWeight = P.poissonWeight;
    this.bgAcc = 0;
    /** a neuron leaves the active set once |v - v0| and |g| fall below these (mV) */
    this.restV = 1e-3;
    this.restG = 1e-4;
    this.dense = false;
    this.poissonTargets = new Uint8Array(n); // Poisson targets have no refractory period
    /** lesions: silenced neurons never fire (like a genetic silencing experiment) */
    this.silenced = new Uint8Array(n);
    /** spike times of individually tracked neurons, for the raster: [trackedIndex, t ms] pairs */
    this.tracked = new Int16Array(n).fill(-1);
    this.spikeLog = [];
    /** dopamine released onto each neuron's inputs by spiking DANs (see enablePlasticity) */
    this.daOut = null;
  }

  /** Silence (true) or restore (false) a set of neurons. */
  silence(indices, on) {
    for (const i of indices) {
      this.silenced[i] = on ? 1 : 0;
      if (on) {
        this.v[i] = this.P.v0;
        this.g[i] = 0;
      }
    }
  }

  /** Record every spike of these neurons (at most 32k) into spikeLog. */
  track(indices) {
    this.tracked.fill(-1);
    indices.forEach((i, k) => {
      this.tracked[i] = k;
    });
  }

  drainSpikes() {
    const out = this.spikeLog;
    this.spikeLog = [];
    return out;
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

  /** A spike of neuron i: reset, rate trace, raster, dopamine, and synaptic output after the delay. */
  fire(i) {
    const P = this.P;
    if (this.tracked[i] >= 0) this.spikeLog.push(this.tracked[i], this.t);
    if (this.daOut && this.daOut[i]) this.releaseDopamine(i);
    this.spikeCount[i]++;
    this.v[i] = P.vReset;
    this.g[i] = 0;
    this.refr[i] = this.poissonTargets[i] ? 0 : this.refrSteps;
    // lazy rate decay, then the spike kick
    const step = this.step_;
    const age = step - this.rateStep[i];
    this.rate[i] = (age < 2048 ? this.rate[i] * this.decayTable[age] : 0) + this.rateKick;
    this.rateStep[i] = step;
    const { offsets, post } = this.conn;
    const wmv = this.wmv;
    const future = this.future;
    const list = this.futureList;
    const stamp = this.futureStamp;
    const touch = this.touchStamp;
    let fc = this.fc;
    for (let e = offsets[i], end = offsets[i + 1]; e < end; e++) {
      const j = post[e];
      future[j] += wmv[e];
      if (touch[j] !== stamp) {
        touch[j] = stamp;
        list[fc++] = j;
      }
    }
    this.fc = fc;
  }

  enterDense() {
    this.dense = true;
    this.isActive.fill(1); // wake() is a no-op while dense
  }

  leaveDense() {
    this.dense = false;
    const { v, g, refr, P } = this;
    let c = 0;
    for (let i = 0; i < this.n; i++) {
      const dv = v[i] - P.v0;
      if (refr[i] !== 0 || dv > this.restV || dv < -this.restV || g[i] > this.restG || g[i] < -this.restG || this.poissonTargets[i]) {
        this.isActive[i] = 1;
        this.active[c++] = i;
      } else {
        this.isActive[i] = 0;
      }
    }
    this.activeCount = c;
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
    this.dense = false;
    this.eligibleFrom = this.step_; // a new trial: earlier Kenyon-cell spikes are no longer eligible for learning
    if (this.plastic) this.plastic.da.fill(0);
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
    const { v, g, refr, P, kM, decayG } = this;
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

    // 2a. spontaneous activity: every neuron fires on its own at `background` Hz
    // (a Poisson spike source per neuron, sampled as the expected number of hits per step)
    if (this.background > 0) {
      this.bgAcc += (this.n * this.background * dt) / 1000;
      const n = this.n;
      while (this.bgAcc >= 1) {
        this.bgAcc -= 1;
        const i = (this.rng() * n) | 0;
        if (this.silenced[i]) continue;
        v[i] += this.bgWeight;
        this.wake(i);
      }
    }
    // 2b. Poisson (sensory) input spikes
    for (const [i, hz] of this.drive) {
      if (this.rng() < (hz * dt) / 1000 && !this.silenced[i]) v[i] += P.poissonWeight;
      this.wake(i);
    }

    // 3. integrate: the active set, or every neuron when most of the brain is busy
    // (spontaneous activity keeps ~half the brain active; a straight loop is then faster)
    this.fc = this.touchedCount[slotFuture];
    this.futureList = futureList;
    this.future = future;
    this.futureStamp = futureStamp;
    let spikes = 0;
    const vTh = P.vTh;
    const v0 = P.v0;
    const restV = this.restV;
    const restG = this.restG;
    const silenced = this.silenced;
    const poissonTargets = this.poissonTargets;
    const n = this.n;
    if (this.dense) {
      for (let i = 0; i < n; i++) {
        if (refr[i] !== 0) {
          refr[i]--;
          continue;
        }
        const gi = g[i];
        const vi = v[i] + kM * (v0 - v[i] + gi);
        g[i] = gi * decayG;
        if (vi > vTh) {
          if (silenced[i]) {
            v[i] = v0; // lesioned: never fires
          } else {
            spikes++;
            this.fire(i);
          }
        } else {
          v[i] = vi;
        }
      }
      // every 50 steps: is most of the brain still busy?
      if (this.step_ % 50 === 0) {
        let awake = 0;
        for (let i = 0; i < n; i++) {
          const dv = v[i] - v0;
          if (refr[i] !== 0 || dv > restV || dv < -restV || g[i] > restG || g[i] < -restG) awake++;
        }
        if (awake < n * 0.2) this.leaveDense();
      }
    } else {
      let nextCount = 0;
      const next = this.nextActive;
      for (let k = 0, c = this.activeCount; k < c; k++) {
        const i = this.active[k];
        if (refr[i] !== 0) {
          refr[i]--;
          next[nextCount++] = i;
          continue;
        }
        v[i] += kM * (v0 - v[i] + g[i]);
        g[i] *= decayG;
        if (v[i] > vTh && silenced[i]) v[i] = v0; // lesioned: never fires
        if (v[i] > vTh) {
          spikes++;
          this.fire(i);
        }
        const dv = v[i] - v0;
        if (refr[i] !== 0 || dv > restV || dv < -restV || g[i] > restG || g[i] < -restG || poissonTargets[i]) {
          next[nextCount++] = i;
        } else {
          v[i] = v0;
          g[i] = 0;
          this.isActive[i] = 0;
        }
      }
      // swap active lists
      this.nextActive = this.active;
      this.active = next;
      this.activeCount = nextCount;
      if (nextCount > n * 0.35) this.enterDense();
    }
    this.touchedCount[slotFuture] = this.fc;

    this.t += dt;
    this.step_++;
    this.spikesThisWindow += spikes;
    this.totalSpikes += spikes;
    return spikes;
  }

  /**
   * Dopamine-gated plasticity at the Kenyon cell -> MBON synapses of the
   * mushroom body, the fly's learning centre (Hige et al. 2015, Cohn et al.
   * 2015): when a dopamine neuron fires, every MBON it synapses onto gets a
   * dopamine trace; KC->MBON synapses from Kenyon cells that fired in the last
   * `window` ms are then depressed in proportion. Pairing an odour with reward
   * therefore weakens that odour's KC->MBON synapses, a memory of it.
   * @param {{kc:number[], mbon:number[], dan:number[]}} cells
   */
  enablePlasticity({ kc, mbon, dan }, { rate = 0.1, window = 1000, floor = 0.15 } = {}) {
    const { offsets, post } = this.conn;
    const isKC = new Uint8Array(this.n);
    for (const i of kc) isKC[i] = 1;
    const isMBON = new Uint8Array(this.n);
    for (const i of mbon) isMBON[i] = 1;
    // KC->MBON edges grouped by MBON
    const byMbon = new Map(mbon.map((j) => [j, []]));
    for (const i of kc) {
      for (let e = offsets[i]; e < offsets[i + 1]; e++) if (isMBON[post[e]]) byMbon.get(post[e]).push(e);
    }
    // `enabled` gates learning to reward: dopamine counts while a reward (PAM stimulation) is on
    this.plastic = { byMbon, rate, window, floor, original: new Map(), da: new Float32Array(this.n), changes: 0, enabled: false };
    // total KC->MBON weight of each Kenyon cell, for the memory readout
    this.kcList = kc;
    for (const edges of byMbon.values()) for (const e of edges) this.plastic.original.set(e, this.wmv[e]);
    // which DANs release onto which MBONs (their direct synapses in the connectome).
    // Dopamine is a neuromodulator, not a fast transmitter: the DANs' synapses
    // act only through this learning rule (the published model would otherwise
    // treat them as fast excitation and switch on the whole mushroom body).
    this.daOut = new Uint8Array(this.n);
    this.daTargets = new Map();
    let fastRemoved = 0;
    for (const i of dan) {
      const targets = [];
      for (let e = offsets[i]; e < offsets[i + 1]; e++) {
        if (isMBON[post[e]]) targets.push(post[e]);
        if (this.wmv[e] !== 0) fastRemoved++;
        this.wmv[e] = 0;
      }
      if (targets.length) {
        this.daOut[i] = 1;
        this.daTargets.set(i, targets);
      }
    }
    return { plasticSynapses: this.plastic.original.size, dans: this.daTargets.size, fastRemoved };
  }

  releaseDopamine(i) {
    if (!this.plastic.enabled) return;
    const da = this.plastic.da;
    for (const j of this.daTargets.get(i)) da[j] += 1;
  }

  /**
   * Apply the learning rule for the dopamine released since the last call.
   * @returns {{mbons:number, synapses:number}} what changed now
   */
  learn() {
    const p = this.plastic;
    if (!p) return { mbons: 0, synapses: 0 };
    const { offsets } = this.conn;
    const kcOf = this.kcOfEdge ?? (this.kcOfEdge = buildPreIndex(offsets, p.byMbon));
    let mbons = 0;
    let synapses = 0;
    const windowSteps = p.window / this.dt;
    for (const [j, edges] of p.byMbon) {
      const d = p.da[j];
      if (d <= 0) continue;
      p.da[j] = 0;
      mbons++;
      const k = Math.min(0.5, p.rate * d);
      for (const e of edges) {
        const pre = kcOf.get(e);
        const last = this.rateStep[pre];
        if (this.step_ - last > windowSteps || last < this.eligibleFrom || this.spikeCount[pre] === 0) continue;
        const floor = p.original.get(e) * p.floor;
        const w = this.wmv[e];
        if (w <= floor) continue;
        this.wmv[e] = Math.max(floor, w * (1 - k));
        synapses++;
      }
    }
    p.changes += synapses;
    return { mbons, synapses };
  }

  /**
   * Synaptic drive (mV) that these Kenyon-cell spike counts deliver to the
   * MBONs through the plastic synapses: the memory readout. The same odour
   * after reward pairing drives the MBONs less.
   * @param {Uint32Array} kcSpikes  spikes per neuron during the test (spikeCount difference)
   */
  kcDrive(kcSpikes) {
    const p = this.plastic;
    if (!p) return 0;
    const kcOf = this.kcOfEdge ?? (this.kcOfEdge = buildPreIndex(this.conn.offsets, p.byMbon));
    let d = 0;
    for (const edges of p.byMbon.values()) for (const e of edges) d += kcSpikes[kcOf.get(e)] * this.wmv[e];
    return d;
  }

  /** Mean relative strength of the plastic synapses (1 = untrained). */
  plasticStrength() {
    const p = this.plastic;
    if (!p) return 1;
    let s = 0;
    for (const [e, w0] of p.original) s += w0 ? this.wmv[e] / w0 : 1;
    return p.original.size ? s / p.original.size : 1;
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
