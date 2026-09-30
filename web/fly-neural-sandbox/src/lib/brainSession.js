// One running FlyWire brain: the LIF model (lifBrain.js) plus everything the
// game does with it (senses, stimulus trials, neural controls, lesions,
// learning experiments, spike raster), paced against the wall clock.
//
// The same class runs on the Base44 server (server/brainWorker.mjs, a Node
// worker thread per visitor) and, as a fallback, in the visitor's browser
// (connectomeWorker.js). The host passes `post(msg)` and receives plain
// messages, so both transports carry exactly the same data.
//
// in (handle):
//   {type:'drive', rates:{group: Hz}}      continuous senses (vision, looming, touch)
//   {type:'trial', name}                   a stimulus trial from TRIALS (taste, smell)
//   {type:'control', name, hz}             neural controls: walk (DNp09), steerL / steerR (DNa02), reward (PAM dopamine)
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
  walk: { label: 'Walk command DNp09', ref: 'Bidaye et al. 2020' },
  steerL: { label: 'Steering DNa02 left', ref: 'Rayshubskiy et al. 2020' },
  steerR: { label: 'Steering DNa02 right', ref: 'Rayshubskiy et al. 2020' },
  reward: { label: 'Dopamine PAM (reward)', ref: 'Liu et al. 2012' },
};
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
  constructor(conn, { post, seed = (Math.random() * 2 ** 31) | 0, wmv = null, now = () => performance.now() }) {
    this.conn = conn;
    this.post = post;
    this.now = now;
    const G = conn.header.groups;
    this.G = G;
    this.brain = new LIFBrain(conn, { seed, wmv });
    this.plasticity = G.kc
      ? this.brain.enablePlasticity({ kc: G.kc.all, mbon: G.mbon.all, dan: G.dopamine.all })
      : null;
    this.named = conn.header.named ?? [];
    this.brain.track(this.named.map((x) => x.idx));
    this.driveGroups = {
      visionL: subset(G.photoreceptor?.L ?? [], 2),
      visionR: subset(G.photoreceptor?.R ?? [], 2),
      olfactoryL: subset(G.olfactory.L, 6),
      olfactoryR: subset(G.olfactory.R, 6),
      loomingL: G.looming.L,
      loomingR: G.looming.R,
      sugar: side(G.sugar),
      mechano: subset(side(G.mechano), 4),
      walk: side(G.walk),
      steerL: G.steer.L,
      steerR: G.steer.R,
      reward: G.dopamine.all,
      odorA: side(G[ODORS.A]),
      odorB: side(G[ODORS.B]),
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
    this.wallAtFrame = this.now();
    this.simAtFrame = this.brain.t;
    this.lastFrame = this.wallAtFrame;
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
    for (const [k, hz] of Object.entries(this.rates)) if (this.driveGroups[k]) want[k] = Math.round(hz);
    for (const [k, hz] of Object.entries(this.controlRates)) want[k] = Math.max(want[k] ?? 0, Math.round(hz));
    const p = this.protocol?.phase;
    if (p?.drive) for (const [k, hz] of Object.entries(p.drive)) want[k] = Math.max(want[k] ?? 0, hz);
    this.lastApplied ??= {};
    for (const k of Object.keys(this.driveGroups)) {
      const hz = want[k] ?? 0;
      if (this.lastApplied[k] === hz) continue;
      this.lastApplied[k] = hz;
      this.brain.setDrive(this.driveGroups[k], hz);
    }
    // dopamine counts for learning while the reward is on
    if (this.brain.plastic) this.brain.plastic.enabled = (want.reward ?? 0) > 0;
  }

  startTrial(name) {
    const t = TRIALS[name];
    if (!t || this.protocol) return; // one at a time
    this.runProtocol(name, [{ drive: { [t.group]: t.hz }, ms: t.ms }], null);
  }

  /**
   * The mushroom-body learning experiment (after Hige et al. 2015):
   * test = present the odour for 400 ms and measure its KC->MBON drive;
   * train = present it with a reward (PAM dopamine from 100 ms) and apply the learning rule.
   */
  startExperiment(action, odor) {
    if (this.protocol || !ODORS[odor] || !this.brain.plastic) return;
    const key = `odor${odor}`;
    const phases =
      action === 'train'
        ? [
            { drive: { [key]: 50 }, ms: 100 },
            { drive: { [key]: 50, reward: 80 }, ms: 300 },
          ]
        : [{ drive: { [key]: 50 }, ms: 400 }];
    const before = Uint32Array.from(this.brain.spikeCount);
    const changesBefore = this.brain.plastic.changes;
    this.runProtocol(`${action}${odor}`, phases, () => {
      const d = new Uint32Array(this.conn.n);
      for (let i = 0; i < d.length; i++) d[i] = this.brain.spikeCount[i] - before[i];
      const drive = this.brain.kcDrive(d);
      let kcs = 0;
      for (const i of this.G.kc.all) if (d[i]) kcs++;
      if (action === 'test' && this.memory[odor] === null) this.memory[odor] = drive;
      this.post({
        type: 'experiment',
        action,
        odor,
        ...ODOR_INFO[odor],
        drive,
        baseline: this.memory[odor],
        kcs,
        changed: this.brain.plastic.changes - changesBefore,
        strength: this.brain.plasticStrength(),
      });
    });
  }

  /** Run phases back to back (sim time), then return the network to rest, as the model's trials are run. */
  runProtocol(name, phases, done) {
    this.brain.rest(); // each trial starts from rest
    this.protocol = { name, phases, i: 0, phase: phases[0], until: this.brain.t + phases[0].ms, done };
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
        synapseStrength: b.plastic ? b.plasticStrength() : 1,
      },
      controls: { ...this.controlRates },
      lesions: { ...this.lesions },
    });
    b.spikesThisWindow = 0;
    this.lastFrame = now;
    this.simAtFrame = b.t;
    this.wallAtFrame = now;
  }
}
