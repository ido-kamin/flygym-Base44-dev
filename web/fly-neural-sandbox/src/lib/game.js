// Deterministic game world: the fly, sugar, predators, energy and score.
//
// The fly has no hand-written steering. Each fixed step it samples the world
// with two antennae (sugar odour) and two eyes (looming predators and walls),
// feeds that into the Connectome, and moves according to the connectome's
// motor readout. The genome therefore *is* the behaviour.

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
const WALL_MARGIN = 20;
const MAX_SPEED = 300; // world units / s at full locomotor drive and full DN
const MAX_TURN = 5.5; // rad / s
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
    this.sensors = { odorL: 0, odorR: 0, loomL: 0, loomR: 0 };
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
    };
    for (let i = 0; i < SUGAR_TARGET; i++) this.spawnSugar();
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

  addSugar(x, y) {
    if (this.sugars.length >= SUGAR_MAX) return false;
    this.sugars.push({ x, y, phase: this.rng() * TAU, age: 0 });
    this.events.push({ type: 'sugar', x, y });
    return true;
  }

  spawnSugar() {
    const m = 50;
    for (let tries = 0; tries < 20; tries++) {
      const x = m + this.rng() * (ARENA.w - 2 * m);
      const y = m + this.rng() * (ARENA.h - 2 * m);
      if (Math.hypot(x - this.fly.x, y - this.fly.y) > 110 || tries === 19) {
        this.sugars.push({ x, y, phase: this.rng() * TAU, age: 0 });
        return;
      }
    }
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
    inp[C.AL_L] = s.odorL;
    inp[C.AL_R] = s.odorR;
    inp[C.OL_L] = s.loomL;
    inp[C.OL_R] = s.loomR;
    inp[C.PROTO] = 0.1 + 0.5 * hunger + chaos * 0.5 * Math.abs(this.noise);
    inp[C.CX] = 0.15 + chaos * 0.6 * Math.abs(this.noise);
    inp[C.SEZ] = 0.05;
    this.network.step(h, inp, this.events);

    const { turn, drive } = this.network.motor(w);
    const turnCmd = turn + chaos * 1.1 * this.noise;
    fly.omega += (turnCmd * MAX_TURN - fly.omega) * Math.min(1, h * 10);
    fly.theta = wrapAngle(fly.theta + fly.omega * h);

    const locomotor = 0.3 + 0.7 * norm(w[G.speed]);
    const vTarget = MAX_SPEED * locomotor * (0.25 + 0.75 * drive);
    fly.v += (vTarget - fly.v) * Math.min(1, h * 4);
    fly.x += Math.cos(fly.theta) * fly.v * h;
    fly.y += Math.sin(fly.theta) * fly.v * h;
    this.collideWalls();

    fly.gait += h * fly.v * 0.085;
    fly.wing += h * (30 + fly.v * 0.35);
    fly.hitCooldown = Math.max(0, fly.hitCooldown - h);
    fly.escapeCooldown = Math.max(0, fly.escapeCooldown - h);

    // giant-fiber style escape burst when threat and descending drive peak together
    if (s.loomL + s.loomR > 1.4 && this.network.a[C.DN] > 0.75 && fly.escapeCooldown === 0) {
      fly.escapeCooldown = 1.2;
      this.network.kick(C.T2, 0.8);
      this.events.push({ type: 'escape', x: fly.x, y: fly.y });
    }

    this.updateSugar(h);
    this.updatePredators(h);

    // metabolism: a baseline cost plus a speed^2 cost that scales with the drive gene
    const vn = fly.v / MAX_SPEED;
    this.energy -= h * (0.9 + 2.2 * vn * vn * (0.5 + norm(w[G.speed])));
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
    // walls read as looming surfaces to the eyes
    const wallProbe = 90;
    if (fly.x < wallProbe) addThreat(-fly.x, 0, 22, 1);
    if (ARENA.w - fly.x < wallProbe) addThreat(ARENA.w - fly.x, 0, 22, 1);
    if (fly.y < wallProbe) addThreat(0, -fly.y, 22, 1);
    if (ARENA.h - fly.y < wallProbe) addThreat(0, ARENA.h - fly.y, 22, 1);
    this.sensors.loomL = Math.min(3, loomL);
    this.sensors.loomR = Math.min(3, loomR);
  }

  collideWalls() {
    const fly = this.fly;
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
    if (hit) {
      // antennal mechanosensation on contact
      this.network.kick(C.AL_L, 0.25);
      this.network.kick(C.AL_R, 0.25);
    }
  }

  updateSugar(h) {
    const fly = this.fly;
    const headX = fly.x + Math.cos(fly.theta) * FLY_RADIUS * 0.8;
    const headY = fly.y + Math.sin(fly.theta) * FLY_RADIUS * 0.8;
    for (let i = this.sugars.length - 1; i >= 0; i--) {
      const s = this.sugars[i];
      s.age += h;
      if (Math.hypot(s.x - headX, s.y - headY) < SUGAR_RADIUS + FLY_RADIUS * 0.6) {
        this.sugars.splice(i, 1);
        this.eat(s);
      }
    }
    while (this.sugars.length < SUGAR_TARGET) this.spawnSugar();
  }

  eat(sugar) {
    const reward = norm(this.weights[G.reward]);
    const gain = 10 * (0.5 + reward);
    this.energy = Math.min(MAX_ENERGY, this.energy + gain);
    this.score = Math.min(MAX_SCORE, this.score + 1);
    // gustatory input to the SEZ, dopamine burst in PAM
    this.network.kick(C.SEZ, 1.0);
    this.network.kick(C.PAM, 0.5 + reward);
    this.events.push({ type: 'eat', x: sugar.x, y: sugar.y, energy: gain, reward, score: this.score });
    const gen = generationOf(this.score);
    if (gen > this.generation) {
      this.generation = gen;
      this.events.push({ type: 'levelup', generation: gen });
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

      if (d < PREDATOR_RADIUS + FLY_RADIUS && fly.hitCooldown === 0) {
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
