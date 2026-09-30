// One running FlyWire brain: the LIF model (lifBrain.js) plus everything the
// game does with it (senses, stimulus trials, neural controls, lesions,
// learning experiments, spike raster), paced against the wall clock.
//
// The same class runs on the Base44 server (server/brainWorker.mjs, a Node
// worker thread per visitor) and, as a fallback, in the visitor's browser
// (connectomeWorker.js). The host passes `post(msg)` and receives plain
// messages, so both transports carry exactly the same data.
//
// The brain is always live: every neuron fires spontaneously at `background`
// Hz (Poisson), so the whole connectome is active and the descending neurons
// fluctuate on their own, which is what makes the fly move autonomously.
//
// in (handle):
//   {type:'drive', rates:{group: Hz}}      continuous senses (vision, looming, smell, taste, touch)
//   {type:'trial', name}                   a stimulus trial from TRIALS (taste, smell)
//   {type:'control', name, hz}             neural controls: walk (DNp09), steerL / steerR (DNa02), reward (PAM dopamine);
//                                          hunger: the fly's internal state, also onto DNp09 (hungry flies walk more)
//   {type:'lesion', name, on}              silence a neuron group (escape, steer, walk, feed, sugar, dopamine)
//   {type:'experiment', action, odor}      learning: 'test' or 'train' an odour ('A' | 'B')
//   {type:'speed', scale} / {type:'pause', paused}
// out (post):
//   {type:'frame', activity, clusters, groups, stats, spikes, controls, lesions}
//   {type:'experiment', ...result}

import { LIFBrain, TRIALS } from './lifBrain.js';

export const FRAME_MS = 50;
const BUDGET_MS = 12;
const ODORS = { A: 'orn_DM4', B: 'orn_VA2' };
/** Odour names for the UI: the glomerulus and a ligand it responds to (DoOR database). */
export const ODOR_INFO = {
  A: { glomerulus: 'DM4', ligand: 'methyl acetate' },
  B: { glomerulus: 'VA2', ligand: '2,3-butanediol' },
};
/** What each neural control stimulates (Poisson drive, like optogenetic activation). */
export const CONTROLS = {
  walk: { label: 'Walk command DNp09', ref: 'Bidaye et al. 2020', group: 'walk' },
  hunger: { label: 'Hunger (internal state) → DNp09', ref: 'hungry flies walk more', group: 'walk' },
  steerL: { label: 'Steering DNa02 left', ref: 'Rayshubskiy et al. 2020', group: 'steerL' },
  steerR: { label: 'Steering DNa02 right', ref: 'Rayshubskiy et al. 2020', group: 'steerR' },
  reward: { label: 'Dopamine PAM (reward)', ref: 'Liu et al. 2012', group: 'reward' },
  punish: { label: 'Dopamine PPL1 (punishment)', ref: 'Aso et al. 2012', group: 'punish' },
  // sandbox: stimulate any sensory group directly
  stimSugar: { label: 'Sugar taste neurons', group: 'sugar' },
  stimBitter: { label: 'Bitter taste neurons', group: 'bitter' },
  stimLoomL: { label: 'Looming LPLC2/LC4 left', group: 'loomingL' },
  stimLoomR: { label: 'Looming LPLC2/LC4 right', group: 'loomingR' },
  stimSmellL: { label: 'Olfactory receptors left', group: 'olfactoryL' },
  stimSmellR: { label: 'Olfactory receptors right', group: 'olfactoryR' },
  stimLightL: { label: 'Photoreceptors left', group: 'visionL' },
  stimLightR: { label: 'Photoreceptors right', group: 'visionR' },
  stimTouch: { label: 'Mechanosensory neurons', group: 'mechano' },
  stimEscape: { label: 'Giant fibers DNp01', group: 'escape' },
  stimGroom: { label: 'Grooming DNg11 / DNg12', group: 'groom' },
};
/** Spontaneous firing of every neuron (Hz): background synaptic noise keeping the whole brain live. */
export const BACKGROUND_HZ = 0.5;
export const LESIONS = {
  escape: 'Giant fibers DNp01',
  steer: 'Steering DNa02 + DNa01',
  walk: 'Walk command DNp09',
  feed: 'Brain motor neurons',
  sugar: 'Sugar taste neurons',
};

const side = (g) => [...(g?.L ?? []), ...(g?.R ?? [])];
const subset = (list, k) => list.filter((_, i) => i % k === 0);

export class BrainSession {
  /**
   * @param {ReturnType<import('./lifBrain.js').parseConnectome>} conn
   * @param {{post:(msg:object)=>void, seed?:number, wmv?:Float32Array, now?:()=>number}} opts
   */
  constructor(conn, { post, seed = (Math.random() * 2 ** 31) | 0, wmv = null, now = () => performance.now(), background = BACKGROUND_HZ }) {
    this.conn = conn;
    this.post = post;
    this.now = now;
    const G = conn.header.groups;
    this.G = G;
    this.brain = new LIFBrain(conn, { seed, wmv });
    this.background = background;
    this.brain.background = background;
    this.plasticity = G.kc
      ? this.brain.enablePlasticity({ kc: G.kc.all, mbon: G.mbon.all, dan: G.dopamine.all, punish: G.punish?.all ?? [] })
      : null;
    this.named = conn.header.named ?? [];
    this.brain.track(this.named.map((x) => x.idx));
    this.driveGroups = {
      visionL: subset(G.photoreceptor?.L ?? [], 2),
      visionR: subset(G.photoreceptor?.R ?? [], 2),
      // every olfactory receptor neuron of each antenna (the odour-guided steering needs the whole population)
      olfactoryL: G.olfactory.L,
      olfactoryR: G.olfactory.R,
      loomingL: G.looming.L,
      loomingR: G.looming.R,
      sugar: side(G.sugar),
      mechano: subset(side(G.mechano), 4),
      walk: side(G.walk),
      steerL: G.steer.L,
      steerR: G.steer.R,
      reward: G.dopamine.all,
      punish: G.punish?.all ?? [],
      bitter: side(G.bitter),
      escape: side(G.escape),
      groom: side(G.groom),
      // the two odours: both antennae (lab tests) and each antenna (odour sources in the world)
      odorA: side(G[ODORS.A]),
      odorB: side(G[ODORS.B]),
      odorAL: G[ODORS.A]?.L ?? [],
      odorAR: G[ODORS.A]?.R ?? [],
      odorBL: G[ODORS.B]?.L ?? [],
      odorBR: G[ODORS.B]?.R ?? [],
    };
    this.lesionGroups = {
      escape: side(G.escape),
      steer: [...side(G.steer), ...side(G.steer2)],
      walk: side(G.walk),
      feed: G.feed.all,
      sugar: side(G.sugar),
    };
    this.rates = {}; // continuous senses
    this.controlRates = {}; // user controls
    this.lesions = {};
    this.protocol = null; // running trial / experiment
    this.memory = { A: null, B: null }; // untrained KC->MBON drive per odour
    this.odorKCs = { A: null, B: null }; // each odour's Kenyon cells, from its first test
    this.queue = []; // experiments waiting to run
    this.speed = 1;
    this.paused = false;
    this.looping = false;
    this.lastFrame = 0;
    this.simAtFrame = 0;
    this.wallAtFrame = 0;
    this.clusters = new Float32Array(16);
    this.totalWallMs = 0;
    this.startedAt = now();
  }

  start() {
    // calibrate: smell each odour once in a quiet brain, to find its Kenyon cells and untrained drive
    this.queue.push(['test', 'A', true], ['test', 'B', true]);
    this.wallAtFrame = this.now();
    this.simAtFrame = this.brain.t;
    this.lastFrame = this.wallAtFrame;
    const first = this.queue.shift();
    if (first) this.startExperiment(...first);
    this.loop();
  }

  stop() {
    this.stopped = true;
  }

  // ---- inputs ----
  handle(msg) {
    switch (msg.type) {
      case 'drive':
        for (const [k, hz] of Object.entries(msg.rates ?? {})) this.rates[k] = hz;
        this.applyDrive();
        break;
      case 'trial':
        this.startTrial(msg.name);
        break;
      case 'control':
        if (CONTROLS[msg.name]) {
          this.controlRates[msg.name] = Math.max(0, Math.min(200, Number(msg.hz) || 0));
          this.applyDrive();
        }
        break;
      case 'lesion':
        if (this.lesionGroups[msg.name]) {
          this.lesions[msg.name] = Boolean(msg.on);
          this.brain.silence(this.lesionGroups[msg.name], this.lesions[msg.name]);
        }
        break;
      case 'experiment':
        this.startExperiment(msg.action, msg.odor);
        break;
      case 'reset-learning':
        this.resetLearning();
        break;
      case 'background':
        this.background = Math.max(0, Math.min(5, Number(msg.hz) || 0));
        if (!this.protocol?.quiet) this.brain.background = this.background;
        break;
      case 'speed':
        this.speed = Math.max(0.05, Math.min(4, Number(msg.scale) || 1));
        this.wallAtFrame = this.now();
        this.simAtFrame = this.brain.t;
        break;
      case 'pause':
        if (Boolean(msg.paused) === this.paused) break;
        this.paused = Boolean(msg.paused);
        if (!this.paused) {
          this.wallAtFrame = this.now();
          this.simAtFrame = this.brain.t;
          this.brain.spikesThisWindow = 0;
          if (!this.looping) this.loop();
        }
        break;
      default:
        break;
    }
  }

  /** Continuous drive = senses + controls + the running protocol's stimulus, per group. */
  applyDrive() {
    const want = {};
    // a lab experiment (quiet protocol) isolates the brain: only its own stimulus, no senses or controls
    const isolated = Boolean(this.protocol?.quiet);
    if (!isolated) {
      for (const [k, hz] of Object.entries(this.rates)) if (this.driveGroups[k]) want[k] = Math.round(hz);
      // controls onto the same group add up (hunger + explore on DNp09)
      for (const [k, hz] of Object.entries(this.controlRates)) {
        const g = CONTROLS[k].group;
        want[g] = (want[g] ?? 0) + Math.round(hz);
      }
    }
    const p = this.protocol?.phase;
    if (p?.drive) for (const [k, hz] of Object.entries(p.drive)) want[k] = Math.max(want[k] ?? 0, hz);
    // groups can share neurons (odour A = its left + right ORNs): each neuron gets the strongest drive
    const next = new Map();
    for (const [k, hz] of Object.entries(want)) {
      const list = this.driveGroups[k];
      if (!list || hz <= 0) continue;
      for (const i of list) if ((next.get(i) ?? 0) < hz) next.set(i, hz);
    }
    const prev = this.appliedDrive ?? new Map();
    for (const [i, hz] of next) if (prev.get(i) !== hz) this.brain.setDrive([i], hz);
    for (const i of prev.keys()) if (!next.has(i)) this.brain.setDrive([i], 0);
    this.appliedDrive = next;
    // dopamine counts for learning while a reward or punishment is on
    if (this.brain.plastic) this.brain.plastic.enabled = (want.reward ?? 0) > 0 || (want.punish ?? 0) > 0;
  }

  startTrial(name) {
    const t = TRIALS[name];
    if (!t || this.protocol) return; // one at a time
    this.runProtocol(name, [{ drive: { [t.group]: t.hz }, ms: t.ms }], {}, null);
  }

  /**
   * The mushroom-body learning experiment (after Hige et al. 2015):
   * test = present the odour for 400 ms and measure its KC->MBON drive;
   * train = present it with a reward (PAM dopamine from 100 ms) and apply the learning rule.
   */
  startExperiment(action, odor, calibration = false) {
    if (!ODORS[odor] || !this.brain.plastic) return;
    if (this.protocol) {
      if (this.queue.length < 8) this.queue.push([action, odor, calibration]);
      return;
    }
    const key = `odor${odor}`;
    // train = odour + reward (PAM); punish = odour + punishment (PPL1); test = odour alone
    const us = action === 'train' ? 'reward' : action === 'punish' ? 'punish' : null;
    const phases = us
      ? [
          { drive: { [key]: 50 }, ms: 100 },
          { drive: { [key]: 50, [us]: 80 }, ms: 300 },
        ]
      : [{ drive: { [key]: 50 }, ms: 400 }];
    const before = Uint32Array.from(this.brain.spikeCount);
    const changesBefore = this.brain.plastic.changes;
    this.runProtocol(`${action}${odor}`, phases, { quiet: true }, () => {
      const d = new Uint32Array(this.conn.n);
      for (let i = 0; i < d.length; i++) d[i] = this.brain.spikeCount[i] - before[i];
      const drive = this.brain.kcDrive(d);
      let kcs = 0;
      for (const i of this.G.kc.all) if (d[i]) kcs++;
      if (action === 'test' && this.memory[odor] === null) this.memory[odor] = drive;
      if (action === 'test' && !this.odorKCs[odor]) this.odorKCs[odor] = this.G.kc.all.filter((i) => d[i] > 0);
      this.post({
        type: 'experiment',
        action,
        odor,
        calibration,
        memory: this.memoryOf(odor),
        ...ODOR_INFO[odor],
        drive,
        baseline: this.memory[odor],
        kcs,
        changed: this.brain.plastic.changes - changesBefore,
        strength: this.brain.plasticStrength(),
      });
    });
  }

  /**
   * Run phases back to back (sim time), then return the network to rest, as
   * the model's trials are run. `quiet`: spontaneous activity is paused during
   * the protocol (the learning measurements are made in a quiet brain).
   */
  runProtocol(name, phases, { quiet = false }, done) {
    this.brain.rest(); // each trial starts from rest
    if (quiet) this.brain.background = 0;
    this.protocol = { name, phases, i: 0, phase: phases[0], until: this.brain.t + phases[0].ms, done, quiet };
    this.applyDrive();
  }

  advanceProtocol() {
    const p = this.protocol;
    if (!p || this.brain.t < p.until) return;
    p.i++;
    if (p.i < p.phases.length) {
      p.phase = p.phases[p.i];
      p.until = this.brain.t + p.phase.ms;
      this.applyDrive();
      return;
    }
    this.brain.learn();
    this.protocol = null;
    this.applyDrive();
    p.done?.();
    this.brain.rest();
    this.brain.background = this.background;
    const next = this.queue.shift();
    if (next) this.startExperiment(...next);
  }

  /** Forget everything: all KC->MBON synapses back to their connectome weights. */
  resetLearning() {
    const p = this.brain.plastic;
    if (!p) return;
    for (const [e, w0] of p.original) this.brain.wmv[e] = w0;
    p.changes = 0;
    this.post({ type: 'experiment', action: 'reset', memory: this.memoryOf('A') });
  }

  /** What the brain has learned about an odour, read from its KC->MBON synapses (valence > 0: rewarded). */
  memoryOf(odor) {
    const kcs = this.odorKCs[odor];
    return kcs ? this.brain.odorMemory(kcs) : null;
  }

  // ---- the clock ----
  loop() {
    this.looping = !this.paused && !this.stopped;
    if (!this.looping) return;
    const start = this.now();
    // run no faster than (scaled) real time
    const target = (start - this.wallAtFrame) * this.speed + this.simAtFrame;
    const b = this.brain;
    while (this.now() - start < BUDGET_MS && b.t < target + 5) {
      b.step();
      if (this.protocol) {
        if (b.plastic?.enabled && b.step_ % 50 === 0) b.learn();
        this.advanceProtocol();
      }
    }
    const now = this.now();
    this.totalWallMs += now - start;
    if (now - this.lastFrame >= FRAME_MS) this.frame(now);
    setTimeout(() => this.loop(), 0);
  }

  frame(now) {
    const b = this.brain;
    const wall = now - this.wallAtFrame;
    const sim = b.t - this.simAtFrame;
    const activity = b.activityBytes();
    b.clusterRates(this.clusters);
    const G = this.G;
    const r = (list) => b.groupRate(list);
    this.post({
      type: 'frame',
      activity,
      clusters: this.clusters.slice(),
      groups: {
        steerL: r(G.steer.L),
        steerR: r(G.steer.R),
        steer2L: r(G.steer2.L),
        steer2R: r(G.steer2.R),
        walk: r(side(G.walk)),
        escapeL: r(G.escape.L),
        escapeR: r(G.escape.R),
        feed: r(G.feed.all),
        groom: r(side(G.groom)),
        dopamine: r(G.dopamine.all),
        looming: r(side(G.looming)),
        sugar: r(side(G.sugar)),
        olfactory: r(side(G.olfactory)),
        vision: r(this.driveGroups.visionL),
        kc: r(G.kc?.all ?? []),
        mbon: r(G.mbon?.all ?? []),
      },
      spikes: b.drainSpikes(), // [named index, t ms, ...]
      stats: {
        simMs: b.t,
        rtf: wall > 0 ? sim / wall / this.speed : 0,
        spikesPerSec: sim > 0 ? (b.spikesThisWindow * 1000) / sim : 0,
        totalSpikes: b.totalSpikes,
        active: b.activeCount,
        trial: this.protocol?.name ?? null,
        cpuShare: this.totalWallMs / Math.max(1, now - this.startedAt),
        learnedSynapses: b.plastic?.changes ?? 0,
        background: b.background,
        dense: b.dense,
        synapseStrength: b.plastic ? b.plasticStrength() : 1,
      },
      controls: { ...this.controlRates },
      memory: { A: this.memoryOf('A'), B: this.memoryOf('B') },
      lesions: { ...this.lesions },
    });
    b.spikesThisWindow = 0;
    this.lastFrame = now;
    this.simAtFrame = b.t;
    this.wallAtFrame = now;
  }
}
