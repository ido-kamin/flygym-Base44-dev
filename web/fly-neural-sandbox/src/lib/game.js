// Deterministic game world: the fly, sugar, predators, energy and score.
//
// The fly has no hand-written steering. Each fixed step it samples the world
// with two antennae (sugar odour) and two eyes (looming predators and walls),
// feeds that into the Connectome, and moves according to the connectome's
// motor readout. The genome therefore *is* the behaviour.
//
// On top of that sit the fly's survival instincts, as timed motor programs:
// escape (giant-fiber burst away from a looming threat), feeding (the fly stops
// while the proboscis is on sugar), grooming (a pause to clean the antennae
// after a bump or when idle and fed), and hunger, which sharpens the odour
// drive. The real FlyWire brain (realBrain.js), when loaded, can steer and
// trigger these programs through `brainMotor`.
//
// motorMode 'neurons': the fly moves ONLY from the FlyWire brain's descending
// neurons (DNp09 walk, DNa02 turn, DNp01 escape, motor neurons feed, DNg groom);
// the genome model, noise and scripted instincts are off. 'assist' (default)
// adds the genome model's steering and the instincts on top.

import { ARENA, MAX_SCORE } from './constants.js';
import { encodeFlyToBase44 } from './base44.js';
import { C, CLUSTER_COUNT, Connectome } from './connectome.js';
import {
  DEFAULT_WEIGHTS,
  GENE_INDEX as G,
  generationOf,
  hashString,
  mulberry32,
  mutate as mutateWeights,
  norm,
} from './genome.js';

export const STEP = 1 / 120;
const MAX_STEPS_PER_ADVANCE = 24;

export const FLY_RADIUS = 16;
/** Vibecode theme: food items are pipeline tokens; collect them in this order to deploy. */
export const PIPELINE = ['Compile', 'Audit', 'Mint', 'Deploy', 'Base'];
/** Base44 builder mission: the tasks of building an app, in order; the last one ships it. */
export const BUILD_TASKS = ['Add page', 'Add entity', 'Connect login', 'Design UI', 'Add function', 'Publish'];

/**
 * Missions: what the fly's food items are. Ordered missions (`stages`) advance
 * when the fly eats the next stage and complete with `doneEvent`; the search
 * mission's items are real web results (see setSearchResults).
 */
export const MISSIONS = {
  forage: { stages: null, doneEvent: null },
  build: { stages: BUILD_TASKS, doneEvent: 'shipped' },
  search: { stages: null, doneEvent: null, search: true },
  vibe: { stages: PIPELINE, doneEvent: 'deployed' },
  // free play: the fly can't starve; the player drops sugar, spiders and odour sources
  sandbox: { stages: null, doneEvent: null, sandbox: true },
};
/** Odour sources the player can drop in the sandbox (each is one glomerulus, see brainSession ODOR_INFO). */
export const ODOR_KINDS = ['A', 'B'];
const ODOR_SOURCE_MAX = 6;
export const SEARCH_TOKEN = 'Search';

/** Which cluster activity marks each gene's pathway as "in use" (training credit). */
const GENE_SOURCES = [
  [C.MB_L, C.MB_R], // food: mushroom bodies
  [C.LH_L, C.LH_R], // fear: lateral horn
  [C.PAM], // reward: dopamine
  [C.CX], // steer: central complex
  [C.DN], // speed: descending neurons
  null, // noise: the chaos loop itself (|noise|)
];
const ELIGIBILITY_TAU = 2.0; // s
const TRAINING_RATE = 2.2;
const WALL_MARGIN = 20;
export const MAX_SPEED = 300; // world units / s at full locomotor drive and full DN
export const MAX_TURN = 5.5; // rad / s
const SUGAR_TARGET = 12;
const SUGAR_MAX = 24;
const SUGAR_RADIUS = 9;
export const PREDATOR_MAX = 8;
export const PREDATOR_RADIUS = 22;
const PREDATOR_SIGHT = 240;
const HIT_DAMAGE = 12;
const MAX_ENERGY = 100;
const TRAIL_EVERY = 0.035;
const TRAIL_LENGTH = 90;
const ANTENNA_SPREAD = 0.65; // rad either side of the heading
const FEED_TIME = 0.5; // s the fly stops on each sugar
const FEED_MAX = 1.5; // s, while the real brain's feeding motor neurons keep firing
const GROOM_TIME = 1.6; // s
/** The giant-fiber escape: take-off and a short flight away (s). */
export const ESCAPE_TIME = 1.1;
const ESCAPE_SPEED = 1.7; // x MAX_SPEED, in the air
/** Neurons mode: seconds of feeding (brain motor neurons firing, proboscis on it) to finish one sugar drop. */
const MEAL_TIME = 1.2;
/** What the fly is doing, for the HUD. */
export const BEHAVIOURS = ['explore', 'forage', 'flee', 'feed', 'groom', 'stand'];
export const MOTOR_MODES = ['assist', 'neurons'];
const TAU = Math.PI * 2;

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Game {
  /**
   * @param {object} opts
   * @param {number} [opts.seed]  PRNG seed (food layout, noise, mutations)
   * @param {ReturnType<import('./base44.js').decodeFlyFromBase44>} [opts.dna]  decoded DNA to spawn from
   */
  constructor({ seed = 1, dna = null } = {}) {
    this.network = new Connectome();
    this.input = new Float32Array(CLUSTER_COUNT);
    this.events = [];
    this.sensors = {
      odorL: 0,
      odorR: 0,
      loomL: 0,
      loomR: 0,
      threatL: 0,
      threatR: 0,
      wallL: 0,
      wallR: 0,
      taste: 0,
      odorAL: 0,
      odorAR: 0,
      odorBL: 0,
      odorBR: 0,
    };
    this.odorSources = [];
    /**
     * Optional motor command from the real brain, set by the caller each frame:
     * {turn -1..1, escape, escapeSide, feed, groom}. null = connectome model only.
     */
    this.brainMotor = null;
    this.motorMode = 'assist';
    this.nextPredatorId = 1;
    if (dna) this.loadDNA(dna);
    else this.reset(seed, DEFAULT_WEIGHTS.slice(), 0);
  }

  /** Fresh world with the given genome and score; fly in the arena centre. */
  reset(seed, weights, score, pose = null) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.weights = weights.slice();
    this.network.reset();
    this.network.setWeights(this.weights);
    this.score = score;
    this.energy = MAX_ENERGY;
    this.over = false;
    this.time = 0;
    this.acc = 0;
    this.noise = 0;
    this.trail = [];
    this.trailClock = 0;
    this.predators = [];
    this.sugars = [];
    this.mission = this.mission ?? 'forage';
    this.pipeline = 0; // index of the next stage the fly needs (ordered missions)
    this.deployments = 0; // completed ordered missions (vibe: deployments, build: shipped apps)
    this.searchResults = []; // queued web results for the search mission
    this.eligibility = new Float32Array(6);
    this.plasticity = new Float32Array(6);
    this.fly = {
      x: pose ? pose.x : ARENA.w / 2,
      y: pose ? pose.y : ARENA.h / 2,
      theta: pose ? pose.theta : this.rng() * TAU,
      v: 0,
      omega: 0,
      gait: 0,
      wing: 0,
      hitCooldown: 0,
      escapeCooldown: 0,
      escapeTimer: 0,
      escapeTurn: 0,
      feedTimer: 0,
      feedTime: 0,
      groomTimer: 0,
      groomCooldown: 4,
      wallCooldown: 0,
    };
    this.behaviour = 'explore';
    const initial = MISSIONS[this.mission]?.search ? 1 : this.foodTarget();
    for (let i = 0; i < initial; i++) this.spawnSugar();
    this.generation = generationOf(this.score);
  }

  /** Respawn exactly from a decoded DNA link (weights, score, pose). */
  loadDNA(dna) {
    this.reset(hashString(dna.dna ?? ''), dna.weights, dna.score, dna);
  }

  /** Current Base44 DNA of this fly. */
  toDNA() {
    return encodeFlyToBase44(this);
  }

  /** Same genome, zero score, full energy. */
  restart() {
    this.reset((this.rng() * 2 ** 32) >>> 0, this.weights, 0);
    this.events.push({ type: 'restart' });
  }

  /** Apply a localized mutation; returns the indices of the genes that changed. */
  mutate() {
    const { weights, changed } = mutateWeights(this.weights, this.rng);
    this.weights = weights;
    this.network.setWeights(weights);
    this.events.push({ type: 'mutate', genes: changed });
    return changed;
  }

  addPredator(x, y) {
    if (this.predators.length >= PREDATOR_MAX) return false;
    const px = Math.min(ARENA.w - WALL_MARGIN, Math.max(WALL_MARGIN, x));
    const py = Math.min(ARENA.h - WALL_MARGIN, Math.max(WALL_MARGIN, y));
    this.predators.push({
      id: this.nextPredatorId++,
      x: px,
      y: py,
      theta: this.rng() * TAU,
      v: 0,
      gait: 0,
      wander: 0,
      hunting: false,
      age: 0,
    });
    this.events.push({ type: 'predator', x: px, y: py });
    return true;
  }

  clearPredators() {
    this.predators.length = 0;
  }

  /** Drop an odour source (sandbox). */
  addOdor(x, y, odor) {
    if (!ODOR_KINDS.includes(odor)) return false;
    if (this.odorSources.length >= ODOR_SOURCE_MAX) this.odorSources.shift();
    this.odorSources.push({ x, y, odor, age: 0 });
    this.events.push({ type: 'odor', x, y, odor });
    return true;
  }

  addSugar(x, y) {
    if (this.sugars.length >= SUGAR_MAX) return false;
    this.sugars.push({ x, y, phase: this.rng() * TAU, age: 0, kind: this.nextKind() });
    this.events.push({ type: 'sugar', x, y });
    return true;
  }

  spawnSugar() {
    const m = 50;
    const result = MISSIONS[this.mission]?.search ? this.searchResults.shift() : undefined;
    for (let tries = 0; tries < 20; tries++) {
      const x = m + this.rng() * (ARENA.w - 2 * m);
      const y = m + this.rng() * (ARENA.h - 2 * m);
      if (Math.hypot(x - this.fly.x, y - this.fly.y) > 110 || tries === 19) {
        const kind = result ? result.title : this.nextKind();
        this.sugars.push({ x, y, phase: this.rng() * TAU, age: 0, kind, result });
        return;
      }
    }
  }

  /** Token kind for a new food item: the stage the fly needs next is over-represented. */
  nextKind() {
    const stages = MISSIONS[this.mission]?.stages;
    if (stages) return this.rng() < 0.4 ? stages[this.pipeline] : stages[Math.floor(this.rng() * stages.length)];
    if (MISSIONS[this.mission]?.search) return SEARCH_TOKEN;
    return null;
  }

  /** Switch mission: resets the pipeline and respawns the food items for it. */
  setMission(mission) {
    if (!MISSIONS[mission]) throw new Error(`unknown mission ${mission}`);
    this.mission = mission;
    this.pipeline = 0;
    this.searchResults = [];
    this.sugars = [];
    const initial = MISSIONS[mission].search ? 1 : this.foodTarget();
    for (let i = 0; i < initial; i++) this.spawnSugar();
    if (!MISSIONS[mission].sandbox) this.odorSources = [];
    this.events.push({ type: 'mission', mission });
  }

  foodTarget() {
    if (MISSIONS[this.mission]?.sandbox) return 4; // the player adds more
    return MISSIONS[this.mission]?.search ? 7 : SUGAR_TARGET;
  }

  /** Search mission: web results become food items (the fly "reads" them by eating). */
  setSearchResults(query, results) {
    this.searchResults = results.slice(0, 6).map((r) => ({ ...r, query }));
    this.sugars = this.sugars.filter((s) => s.kind === SEARCH_TOKEN).slice(0, 1);
    while (this.searchResults.length) this.spawnSugar();
    this.events.push({ type: 'results', query, count: results.length });
  }

  /** Events since the last drain (eat, hit, fire, pulse, ...), for the renderers. */
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Advance wall-clock `dt` seconds in fixed STEP increments. */
  advance(dt) {
    if (this.over) return;
    this.acc = Math.min(this.acc + dt, STEP * MAX_STEPS_PER_ADVANCE);
    while (this.acc >= STEP && !this.over) {
      this.step(STEP);
      this.acc -= STEP;
    }
  }

  step(h) {
    this.time += h;
    const fly = this.fly;
    const w = this.weights;

    this.sense();
    const s = this.sensors;
    const hunger = 1 - this.energy / MAX_ENERGY;

    // chaos loop: an Ornstein-Uhlenbeck process scaled by the noise gene
    this.noise += -1.6 * this.noise * h + Math.sqrt(h) * (this.rng() * 2 - 1) * 3.2;
    const chaos = norm(w[G.noise]);

    const inp = this.input;
    inp.fill(0);
    // hunger sharpens the odour drive
    const appetite = 0.7 + 0.8 * hunger;
    inp[C.AL_L] = s.odorL * appetite;
    inp[C.AL_R] = s.odorR * appetite;
    inp[C.OL_L] = s.loomL;
    inp[C.OL_R] = s.loomR;
    inp[C.PROTO] = 0.1 + 0.5 * hunger + chaos * 0.5 * Math.abs(this.noise);
    inp[C.CX] = 0.15 + chaos * 0.6 * Math.abs(this.noise);
    inp[C.SEZ] = 0.05;
    this.network.step(h, inp, this.events);

    const { turn, drive } = this.network.motor(w);
    const bm = this.brainMotor;
    const neurons = this.motorMode === 'neurons';
    this.instincts(h, bm, hunger);
    let turnCmd;
    let vTarget;
    if (neurons) {
      // FlyWire descending neurons only: no brain connected = the fly stands still
      turnCmd = bm ? bm.turn : 0;
      vTarget = bm ? MAX_SPEED * bm.walk : 0;
      // learned odours: the mushroom body's memory (valence, read from its KC->MBON synapses)
      // turns the fly toward a rewarded odour and away from a punished one
      if (bm?.memory) turnCmd += this.memoryTurn(bm.memory);
      // proboscis on sugar and the feeding motor neurons firing: feeding arrests walking
      if (bm?.feed && s.taste > 0) {
        turnCmd = 0;
        vTarget = 0;
      }
    } else {
      turnCmd = turn + chaos * 1.1 * this.noise + (bm ? bm.turn * 0.6 : 0);
      const locomotor = 0.3 + 0.7 * norm(w[G.speed]);
      vTarget = MAX_SPEED * locomotor * (0.25 + 0.75 * drive);
    }
    let vRate = 4;
    if (fly.escapeTimer > 0) {
      // in the air: the take-off direction fades into the brain's own steering
      const u = fly.escapeTimer / ESCAPE_TIME;
      turnCmd = fly.escapeTurn * u + (bm ? bm.turn * 0.6 : 0) * (1 - u);
      vTarget = MAX_SPEED * ESCAPE_SPEED;
      vRate = 14;
    } else if (fly.feedTimer > 0 || fly.groomTimer > 0) {
      turnCmd = 0;
      vTarget = 0;
      vRate = 10;
    }
    fly.omega += (turnCmd * MAX_TURN - fly.omega) * Math.min(1, h * 10);
    fly.theta = wrapAngle(fly.theta + fly.omega * h);
    fly.v += (vTarget - fly.v) * Math.min(1, h * vRate);
    fly.x += Math.cos(fly.theta) * fly.v * h;
    fly.y += Math.sin(fly.theta) * fly.v * h;
    this.collideWalls();

    fly.gait += h * fly.v * 0.085;
    fly.wing += h * (30 + fly.v * 0.35);
    fly.hitCooldown = Math.max(0, fly.hitCooldown - h);
    fly.escapeCooldown = Math.max(0, fly.escapeCooldown - h);


    this.updateSugar(h);
    this.updatePredators(h);
    this.updateEligibility(h);

    // metabolism: a baseline cost plus a speed^2 cost that scales with the drive gene
    const vn = fly.v / MAX_SPEED;
    // neurons mode: a gentler metabolism (a live fly lasts minutes, not seconds, between meals)
    this.energy -= h * (neurons ? 0.3 + 0.5 * vn * vn : 0.9 + 2.2 * vn * vn * (0.5 + norm(w[G.speed])));
    if (MISSIONS[this.mission]?.sandbox) this.energy = Math.max(this.energy, 40); // can't starve in the sandbox
    if (this.energy <= 0) {
      this.energy = 0;
      this.over = true;
      this.events.push({ type: 'starved', score: this.score });
    }

    this.trailClock += h;
    if (this.trailClock >= TRAIL_EVERY) {
      this.trailClock = 0;
      this.trail.push({ x: fly.x, y: fly.y });
      if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
    }
  }

  /** Turn command from learned odour valence: toward the side that smells more of a rewarded odour. */
  memoryTurn(memory) {
    const s = this.sensors;
    let t = 0;
    for (const o of ODOR_KINDS) {
      const v = memory[o]?.valence ?? 0;
      const l = s[`odor${o}L`];
      const r = s[`odor${o}R`];
      if (!v || l + r < 0.02) continue;
      t += 1.6 * v * ((r - l) / (l + r + 0.05)) * Math.min(1, (l + r) * 3);
    }
    return Math.max(-0.8, Math.min(0.8, t));
  }

  /**
   * Start the giant-fiber escape: a fast burst turning away from the threat.
   * @param {number} side  -1 threat on the left, +1 on the right
   * @param {boolean} fromBrain  triggered by the real brain's DNp01 rather than the model
   */
  escape(side, fromBrain) {
    const fly = this.fly;
    fly.escapeCooldown = 1.2;
    fly.escapeTimer = ESCAPE_TIME;
    fly.escapeTurn = -side * 0.9; // positive turn = clockwise = to the fly's right
    fly.feedTimer = 0;
    fly.groomTimer = 0;
    this.network.kick(C.DN, 0.8);
    this.network.kick(C.T2, 0.8);
    this.events.push({ type: 'escape', x: fly.x, y: fly.y, side, brain: fromBrain });
  }

  /** Survival instincts: timers for escape, feeding and grooming, and the behaviour label. */
  instincts(h, bm, hunger) {
    const fly = this.fly;
    const s = this.sensors;
    const threat = s.threatL + s.threatR;
    fly.escapeTimer = Math.max(0, fly.escapeTimer - h);
    fly.groomCooldown = Math.max(0, fly.groomCooldown - h);
    const neurons = this.motorMode === 'neurons';
    // giant-fiber escape: the real brain's DNp01, or (assist) the model's threat + descending drive peak
    if (fly.escapeCooldown === 0) {
      if (bm?.escape) this.escape(bm.escapeSide, true);
      else if (!neurons && threat > 1.0 && this.network.a[C.DN] > 0.75) this.escape(s.threatL > s.threatR ? -1 : 1, false);
    }
    if (fly.feedTimer > 0) {
      fly.feedTime += h;
      // keep eating while the real brain's feeding motor neurons fire
      const hold = bm?.feed && fly.feedTime < FEED_MAX;
      fly.feedTimer = hold ? Math.max(fly.feedTimer, h) : Math.max(0, fly.feedTimer - h);
      if (threat > 0.6) fly.feedTimer = 0;
    }
    if (fly.groomTimer > 0) {
      fly.groomTimer = threat > 0.3 ? 0 : Math.max(0, fly.groomTimer - h);
    } else if (fly.escapeTimer === 0 && fly.feedTimer === 0 && threat < 0.1 && fly.groomCooldown === 0) {
      // the real brain's grooming DNs start it; in assist mode a fed, safe fly also grooms now and then
      const idle = !neurons && hunger < 0.3 && this.rng() < h / 9;
      if (idle || bm?.groom) this.groom();
    }
    const odour = s.odorL + s.odorR;
    this.behaviour =
      fly.escapeTimer > 0
        ? 'flee'
        : fly.feedTimer > 0 || (neurons && bm?.feed && s.taste > 0)
          ? 'feed'
          : fly.groomTimer > 0
            ? 'groom'
            : neurons
              ? fly.v > 25
                ? 'explore'
                : 'stand'
              : hunger > 0.45 || odour > 0.55
              ? 'forage'
              : 'explore';
  }

  groom() {
    this.fly.groomTimer = GROOM_TIME;
    this.fly.groomCooldown = GROOM_TIME + 5;
    this.network.kick(C.T1, 0.6); // front legs
    this.events.push({ type: 'groom', x: this.fly.x, y: this.fly.y });
  }

  /** Fill this.sensors: directional odour at each antenna, looming at each eye. */
  sense() {
    const fly = this.fly;
    let odorL = 0;
    let odorR = 0;
    for (const s of this.sugars) {
      const dx = s.x - fly.x;
      const dy = s.y - fly.y;
      const d = Math.hypot(dx, dy);
      const phi = wrapAngle(Math.atan2(dy, dx) - fly.theta);
      const intensity = Math.exp(-d / 110);
      // each antenna has a cosine-tuned receptive field, offset to its side
      odorL += intensity * (0.5 + 0.5 * Math.cos(phi + ANTENNA_SPREAD));
      odorR += intensity * (0.5 + 0.5 * Math.cos(phi - ANTENNA_SPREAD));
    }
    // antennal lobes: divisive normalization (contrast) on top of a
    // log-compressed common signal, like projection neurons after lateral inhibition
    // odour sources: each odour reaches each antenna separately (cosine-tuned, like the sugar scent)
    const src = { AL: 0, AR: 0, BL: 0, BR: 0 };
    for (const o of this.odorSources) {
      const dx = o.x - fly.x;
      const dy = o.y - fly.y;
      const phi = wrapAngle(Math.atan2(dy, dx) - fly.theta);
      const intensity = Math.exp(-Math.hypot(dx, dy) / 160);
      src[`${o.odor}L`] += intensity * (0.5 + 0.5 * Math.cos(phi + ANTENNA_SPREAD));
      src[`${o.odor}R`] += intensity * (0.5 + 0.5 * Math.cos(phi - ANTENNA_SPREAD));
    }
    this.sensors.odorAL = Math.min(1, src.AL);
    this.sensors.odorAR = Math.min(1, src.AR);
    this.sensors.odorBL = Math.min(1, src.BL);
    this.sensors.odorBR = Math.min(1, src.BR);
    const total = odorL + odorR;
    const common = 0.25 * Math.log1p(3 * total);
    const contrast = (odorL - odorR) / (total + 0.08);
    this.sensors.odorL = Math.max(0, common + 0.45 * contrast);
    this.sensors.odorR = Math.max(0, common - 0.45 * contrast);

    let loomL = 0;
    let loomR = 0;
    const addThreat = (dx, dy, size, gain) => {
      const d = Math.max(1, Math.hypot(dx, dy));
      const phi = wrapAngle(Math.atan2(dy, dx) - fly.theta);
      const frontal = 0.55 + 0.45 * Math.cos(phi);
      const loom = gain * frontal * Math.min(3, size / d);
      const side = Math.sin(phi); // < 0 => on the fly's left
      loomL += loom * (0.5 - 0.5 * side);
      loomR += loom * (0.5 + 0.5 * side);
    };
    for (const p of this.predators) {
      const dx = p.x - fly.x;
      const dy = p.y - fly.y;
      if (dx * dx + dy * dy < PREDATOR_SIGHT * PREDATOR_SIGHT * 1.6) addThreat(dx, dy, 70, 1.4);
    }
    // looming from animals only (walls don't trigger escapes)
    this.sensors.threatL = Math.min(3, loomL);
    this.sensors.threatR = Math.min(3, loomR);
    // walls read as looming surfaces to the eyes (a separate, gentler channel)
    const tL = loomL;
    const tR = loomR;
    const wallProbe = 90;
    if (fly.x < wallProbe) addThreat(-fly.x, 0, 22, 1);
    if (ARENA.w - fly.x < wallProbe) addThreat(ARENA.w - fly.x, 0, 22, 1);
    if (fly.y < wallProbe) addThreat(0, -fly.y, 22, 1);
    if (ARENA.h - fly.y < wallProbe) addThreat(0, ARENA.h - fly.y, 22, 1);
    this.sensors.loomL = Math.min(3, loomL);
    this.sensors.loomR = Math.min(3, loomR);
    this.sensors.wallL = Math.min(3, loomL - tL);
    this.sensors.wallR = Math.min(3, loomR - tR);
  }

  collideWalls() {
    const fly = this.fly;
    // neurons mode: a wall just stops the fly (it slides along it); turning away is up to its brain
    const reflect = this.motorMode !== 'neurons';
    const th = fly.theta;
    let hit = false;
    if (fly.x < WALL_MARGIN) {
      fly.x = WALL_MARGIN;
      fly.theta = wrapAngle(Math.PI - fly.theta);
      hit = true;
    } else if (fly.x > ARENA.w - WALL_MARGIN) {
      fly.x = ARENA.w - WALL_MARGIN;
      fly.theta = wrapAngle(Math.PI - fly.theta);
      hit = true;
    }
    if (fly.y < WALL_MARGIN) {
      fly.y = WALL_MARGIN;
      fly.theta = wrapAngle(-fly.theta);
      hit = true;
    } else if (fly.y > ARENA.h - WALL_MARGIN) {
      fly.y = ARENA.h - WALL_MARGIN;
      fly.theta = wrapAngle(-fly.theta);
      hit = true;
    }
    if (hit && !reflect) fly.theta = th;
    if (hit) {
      // antennal mechanosensation on contact
      this.network.kick(C.AL_L, 0.25);
      this.network.kick(C.AL_R, 0.25);
      if (this.time > fly.wallCooldown) {
        fly.wallCooldown = this.time + 0.5;
        this.events.push({ type: 'bump', x: fly.x, y: fly.y });
        // dust on the antennae: sometimes the fly stops to clean them
        if (this.motorMode !== 'neurons' && fly.groomTimer === 0 && fly.escapeTimer === 0 && fly.groomCooldown === 0 && this.rng() < 0.3) {
          this.groom();
        }
      }
    }
  }

  updateSugar(h) {
    const fly = this.fly;
    const headX = fly.x + Math.cos(fly.theta) * FLY_RADIUS * 0.8;
    const headY = fly.y + Math.sin(fly.theta) * FLY_RADIUS * 0.8;
    const neurons = this.motorMode === 'neurons';
    const bm = this.brainMotor;
    this.sensors.taste = 0;
    for (let i = this.sugars.length - 1; i >= 0; i--) {
      const s = this.sugars[i];
      s.age += h;
      const dHead = Math.hypot(s.x - headX, s.y - headY);
      // neurons mode tastes with the legs too (tarsal sugar receptors), so the whole body counts
      const reach = neurons && !s.kind ? SUGAR_RADIUS + FLY_RADIUS * 1.6 : SUGAR_RADIUS + FLY_RADIUS * 0.6;
      if (dHead < reach && fly.escapeTimer === 0) {
        if (!neurons || s.kind) {
          // assist mode (and mission tokens): collected on touch
          this.sugars.splice(i, 1);
          this.eat(s);
          continue;
        }
        // neurons mode: the proboscis tastes it; the fly eats only while its feeding motor neurons fire
        this.sensors.taste = 1;
        s.left ??= MEAL_TIME;
        if (bm?.feed) {
          s.left -= h;
          const gain = 10 * (0.5 + norm(this.weights[G.reward]));
          this.energy = Math.min(MAX_ENERGY, this.energy + (gain / MEAL_TIME) * h);
          if (s.left <= 0) {
            this.sugars.splice(i, 1);
            this.eat(s, { fed: true });
          }
        }
      }
    }
    const target = this.foodTarget();
    if (MISSIONS[this.mission]?.search) {
      // keep one [Search] button on the map; results only come from searches
      if (!this.sugars.some((s) => s.kind === SEARCH_TOKEN)) this.spawnSugar();
    } else {
      while (this.sugars.length < target) this.spawnSugar();
    }
  }

  eat(sugar, { fed = false } = {}) {
    const reward = norm(this.weights[G.reward]);
    const gain = fed ? 0 : 10 * (0.5 + reward); // (neurons mode: already gained while feeding)
    // proboscis extension: the fly stops to feed
    // (neurons mode: it has just fed for as long as its motor neurons fired)
    this.fly.feedTimer = this.motorMode === 'neurons' ? 0 : FEED_TIME;
    this.fly.feedTime = 0;
    this.fly.groomTimer = 0;
    this.energy = Math.min(MAX_ENERGY, this.energy + gain);
    this.score = Math.min(MAX_SCORE, this.score + 1);
    // gustatory input to the SEZ, dopamine burst in PAM
    this.network.kick(C.SEZ, 1.0);
    this.network.kick(C.PAM, 0.5 + reward);
    this.events.push({ type: 'eat', x: sugar.x, y: sugar.y, energy: gain, reward, score: this.score, kind: sugar.kind });
    if (sugar.result) this.events.push({ type: 'read', result: sugar.result });
    else if (sugar.kind === SEARCH_TOKEN) this.events.push({ type: 'needSearch' });
    this.advancePipeline(sugar);
    const gen = generationOf(this.score);
    if (gen > this.generation) {
      this.generation = gen;
      this.events.push({ type: 'levelup', generation: gen });
    }
  }

  /** Ordered missions: the right token advances the pipeline, a full pass completes it. */
  advancePipeline(sugar) {
    const { stages, doneEvent } = MISSIONS[this.mission] ?? {};
    if (!stages) return;
    if (sugar.kind === stages[this.pipeline]) {
      this.pipeline++;
      this.events.push({ type: 'stage', stage: sugar.kind, progress: this.pipeline / stages.length, mission: this.mission });
      if (this.pipeline === stages.length) {
        this.pipeline = 0;
        this.deployments++;
        this.network.kick(C.PAM, 1.0);
        this.events.push({ type: doneEvent, deployments: this.deployments, mission: this.mission });
        this.train(0.35); // learning from success: a small dopamine reward
      }
    } else if (sugar.kind) {
      this.events.push({ type: 'wrongStage', got: sugar.kind, need: stages[this.pipeline], mission: this.mission });
    }
  }

  /**
   * Dopamine-gated training (mushroom-body style reward learning): each gene
   * keeps an eligibility trace of how active its pathway was over the last
   * couple of seconds. A reward (+) strengthens pathways that were more active
   * than average, a punishment (-) weakens them. Fractional changes accumulate
   * until a gene moves a whole level, so the DNA changes only on real learning.
   * @param {number} reward  +1 good fly, -1 bad fly (any magnitude)
   * @returns {{gene:number, delta:number}[]} genes that changed
   */
  train(reward) {
    const e = this.eligibility;
    const mean = (e[0] + e[1] + e[2] + e[3] + e[4] + e[5]) / 6;
    const changes = [];
    for (let i = 0; i < 6; i++) {
      this.plasticity[i] += TRAINING_RATE * reward * (e[i] - mean);
      while (Math.abs(this.plasticity[i]) >= 1) {
        const step = Math.sign(this.plasticity[i]);
        this.plasticity[i] -= step;
        const next = Math.max(0, Math.min(15, this.weights[i] + step));
        if (next !== this.weights[i]) {
          this.weights[i] = next;
          changes.push({ gene: i, delta: step });
        } else {
          this.plasticity[i] = 0; // saturated
          break;
        }
      }
    }
    if (changes.length) this.network.setWeights(this.weights);
    this.network.kick(reward > 0 ? C.PAM : C.LH_L, Math.min(1, Math.abs(reward)));
    this.events.push({ type: 'trained', reward, changes });
    return changes;
  }

  updateEligibility(h) {
    const a = this.network.a;
    const k = h / ELIGIBILITY_TAU;
    for (let i = 0; i < 6; i++) {
      const src = GENE_SOURCES[i];
      let v = 0;
      if (src) {
        for (const c of src) v += Math.min(1, a[c]);
        v /= src.length;
      } else {
        v = Math.min(1, Math.abs(this.noise) / 2);
      }
      this.eligibility[i] += k * (v - this.eligibility[i]);
    }
  }

  updatePredators(h) {
    const fly = this.fly;
    for (const p of this.predators) {
      p.age += h;
      const dx = fly.x - p.x;
      const dy = fly.y - p.y;
      const d = Math.hypot(dx, dy);
      p.hunting = d < PREDATOR_SIGHT;
      let target;
      if (p.hunting) {
        target = Math.atan2(dy, dx);
      } else {
        p.wander += (this.rng() * 2 - 1) * 2.5 * h;
        target = p.theta + p.wander;
      }
      p.theta = wrapAngle(p.theta + Math.max(-2.2 * h, Math.min(2.2 * h, wrapAngle(target - p.theta))));
      const vTarget = p.hunting ? 88 : 36;
      p.v += (vTarget - p.v) * Math.min(1, h * 2);
      p.x = Math.min(ARENA.w - WALL_MARGIN, Math.max(WALL_MARGIN, p.x + Math.cos(p.theta) * p.v * h));
      p.y = Math.min(ARENA.h - WALL_MARGIN, Math.max(WALL_MARGIN, p.y + Math.sin(p.theta) * p.v * h));
      if (p.x <= WALL_MARGIN || p.x >= ARENA.w - WALL_MARGIN || p.y <= WALL_MARGIN || p.y >= ARENA.h - WALL_MARGIN) {
        p.wander = 0;
        p.theta = wrapAngle(Math.atan2(ARENA.h / 2 - p.y, ARENA.w / 2 - p.x));
      }
      p.gait += h * p.v * 0.12;

      if (d < PREDATOR_RADIUS + FLY_RADIUS && fly.hitCooldown === 0 && fly.escapeTimer === 0) {
        fly.hitCooldown = 1.0;
        this.energy = Math.max(0, this.energy - HIT_DAMAGE);
        // which eye saw the strike, measured before the knock-back turns the fly
        const leftSide = Math.sin(wrapAngle(Math.atan2(-dy, -dx) - fly.theta)) < 0;
        // knock-back: shove the fly directly away from the spider
        const away = Math.atan2(dy, dx);
        fly.theta = away;
        fly.x += Math.cos(away) * 14;
        fly.y += Math.sin(away) * 14;
        fly.v = MAX_SPEED;
        this.network.kick(leftSide ? C.OL_L : C.OL_R, 1.2);
        this.network.kick(C.DN, 1.0);
        this.events.push({ type: 'hit', x: fly.x, y: fly.y, left: leftSide });
      }
    }
  }
}
