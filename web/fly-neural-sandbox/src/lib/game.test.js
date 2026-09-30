import { describe, expect, it } from 'vitest';

import { decodeFlyFromBase44, encodeBase44, packDNA } from './base44.js';
import { buildBrain, REGION_COUNTS } from './brainGeometry.js';
import { BRAIN_NEURONS, NEURON_COUNT, VNC_NEURONS } from './constants.js';
import { CLUSTER_COUNT, EDGES } from './connectome.js';
import { Game, PREDATOR_MAX, STEP } from './game.js';
import { generationOf, mulberry32, mutate, personality } from './genome.js';

const run = (game, seconds) => {
  for (let i = 0; i < seconds / STEP; i++) game.step(STEP);
};

describe('genome', () => {
  it('mutates exactly 1 or 2 genes, within range, and always changes them', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 2000; i++) {
      const w = Array.from({ length: 6 }, () => Math.floor(rng() * 16));
      const { weights, changed } = mutate(w, rng);
      expect(changed.length === 1 || changed.length === 2).toBe(true);
      weights.forEach((v, k) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(15);
        if (changed.includes(k)) expect(v).not.toBe(w[k]);
        else expect(v).toBe(w[k]);
      });
    }
  });

  it('names a personality for every genome and derives generation from score', () => {
    expect(personality([10, 8, 8, 9, 8, 15]).title).toBe('Erratic Buzzer');
    expect(personality([10, 8, 8, 9, 15, 2]).title).toBe('Speed Demon');
    expect(personality([10, 8, 8, 9, 8, 4]).title).toBe('Balanced Scout');
    expect(generationOf(0)).toBe(1);
    expect(generationOf(20)).toBe(3);
  });
});

describe('game', () => {
  it('is deterministic for the same seed', () => {
    const a = new Game({ seed: 77 });
    const b = new Game({ seed: 77 });
    a.addPredator(100, 100);
    b.addPredator(100, 100);
    run(a, 8);
    run(b, 8);
    expect(a.fly).toEqual(b.fly);
    expect(a.score).toBe(b.score);
    expect(a.energy).toBe(b.energy);
  });

  it('eating sugar raises score and energy and emits a reward event', () => {
    const g = new Game({ seed: 5 });
    g.energy = 40;
    g.sugars = [{ x: g.fly.x + Math.cos(g.fly.theta) * 14, y: g.fly.y + Math.sin(g.fly.theta) * 14, phase: 0, age: 0 }];
    g.step(STEP);
    const events = g.drainEvents();
    expect(g.score).toBe(1);
    expect(g.energy).toBeGreaterThan(40);
    expect(events.some((e) => e.type === 'eat')).toBe(true);
  });

  it('forages: the default genome finds sugar and survives a minute', () => {
    const g = new Game({ seed: 11 });
    run(g, 60);
    expect(g.over).toBe(false);
    expect(g.score).toBeGreaterThan(5);
  });

  it('a stronger sugar drive forages better than a near-zero one', () => {
    const total = (food) => {
      let s = 0;
      for (let seed = 1; seed <= 5; seed++) {
        const g = new Game({ seed });
        g.reset(seed, [food, 8, 8, 9, 8, 4], 0);
        run(g, 40);
        s += g.score;
      }
      return s;
    };
    expect(total(15)).toBeGreaterThan(total(0) * 1.3);
  });

  it('predator strikes cost energy and emit fear events', () => {
    const g = new Game({ seed: 9 });
    g.addPredator(g.fly.x + 5, g.fly.y);
    const e0 = g.energy;
    g.step(STEP);
    const events = g.drainEvents();
    expect(events.some((e) => e.type === 'hit')).toBe(true);
    expect(g.energy).toBeLessThan(e0 - 10);
  });

  it('stops to feed on sugar, then walks on', () => {
    const g = new Game({ seed: 5 });
    g.sugars = [{ x: g.fly.x + Math.cos(g.fly.theta) * 14, y: g.fly.y + Math.sin(g.fly.theta) * 14, phase: 0, age: 0 }];
    g.step(STEP);
    run(g, 0.3);
    expect(g.behaviour).toBe('feed');
    expect(g.fly.v).toBeLessThan(40);
    run(g, 0.6);
    expect(g.behaviour).not.toBe('feed');
  });

  it('a spider looming close triggers a giant-fiber escape away from it', () => {
    const g = new Game({ seed: 3 });
    g.fly.theta = 0;
    // spider ahead and to the fly's right (+y is the fly's right when heading +x)
    g.addPredator(g.fly.x + 60, g.fly.y + 45);
    let escape = null;
    for (let i = 0; i < 120 && !escape; i++) {
      g.step(STEP);
      escape = g.drainEvents().find((e) => e.type === 'escape');
    }
    expect(escape).toBeTruthy();
    expect(escape.side).toBe(1);
    expect(g.behaviour).toBe('flee');
    expect(g.fly.escapeTurn).toBeLessThan(0); // turns left, away
  });

  it('the real brain can steer and trigger escapes through brainMotor', () => {
    const g = new Game({ seed: 4 });
    g.brainMotor = { turn: 0, escape: true, escapeSide: -1, feed: false, groom: false };
    g.step(STEP);
    const ev = g.drainEvents().find((e) => e.type === 'escape');
    expect(ev).toMatchObject({ side: -1, brain: true });
    expect(g.fly.escapeTurn).toBeGreaterThan(0);
  });

  it('a fed, safe fly grooms now and then', () => {
    const g = new Game({ seed: 8 });
    let groomed = false;
    for (let i = 0; i < 40 * 120 && !groomed; i++) {
      g.energy = 100;
      g.step(STEP);
      groomed = g.drainEvents().some((e) => e.type === 'groom');
    }
    expect(groomed).toBe(true);
  });

  it(`caps predators at ${PREDATOR_MAX}`, () => {
    const g = new Game({ seed: 1 });
    for (let i = 0; i < PREDATOR_MAX; i++) expect(g.addPredator(50 + i * 40, 50)).toBe(true);
    expect(g.addPredator(500, 500)).toBe(false);
  });

  it('starves when energy runs out', () => {
    const g = new Game({ seed: 2 });
    // sugar always spawns >110 units from the fly, so it cannot eat this step
    g.energy = 0.001;
    g.step(STEP);
    expect(g.over).toBe(true);
    expect(g.drainEvents().some((e) => e.type === 'starved')).toBe(true);
  });

  it('respawns exactly from DNA: toDNA() of a loaded fly is the loaded string', () => {
    const rng = mulberry32(8);
    for (let i = 0; i < 200; i++) {
      const s = encodeBase44(
        packDNA({
          weights: Array.from({ length: 6 }, () => Math.floor(rng() * 16)),
          score: Math.floor(rng() * 4096),
          gx: Math.floor(rng() * 16),
          gy: Math.floor(rng() * 16),
          heading: Math.floor(rng() * 16),
        }),
      );
      const g = new Game({ dna: decodeFlyFromBase44(s) });
      expect(g.toDNA()).toBe(s);
    }
  });

  it('mutation changes the DNA string and the network weights', () => {
    const g = new Game({ seed: 4 });
    const before = g.toDNA();
    const w0 = Float32Array.from(g.network.edgeWeights);
    g.mutate();
    expect(g.toDNA()).not.toBe(before);
    expect(Array.from(g.network.edgeWeights)).not.toEqual(Array.from(w0));
  });
});

describe('brain geometry', () => {
  it('builds the FlyWire brain count plus the MANC VNC, region by region', () => {
    const b = buildBrain(44);
    expect(b.count).toBe(NEURON_COUNT);
    expect(b.brainCount).toBe(BRAIN_NEURONS);
    expect(b.count - b.brainCount).toBe(VNC_NEURONS);
    expect(b.positions).toHaveLength(NEURON_COUNT * 3);
    const per = new Array(CLUSTER_COUNT).fill(0);
    b.cluster.forEach((c) => per[c]++);
    expect(per[0] + per[1]).toBe(REGION_COUNTS.OL);
    expect(per[4] + per[5]).toBe(REGION_COUNTS.MB);
    expect(per[10]).toBe(REGION_COUNTS.PAM);
    expect(per[12]).toBe(REGION_COUNTS.DN);
    expect(per[13] + per[14] + per[15]).toBe(VNC_NEURONS);
    expect(b.positions.every(Number.isFinite)).toBe(true);
    expect(b.cluster.every((c) => c >= 0 && c < CLUSTER_COUNT)).toBe(true);
    const seen = new Set(b.cluster);
    expect(seen.size).toBe(CLUSTER_COUNT);
    expect(b.tracts.count).toBeGreaterThan(EDGES.length * 100);
  });

  it('is reproducible for a seed', () => {
    const a = buildBrain(7, 5000, 800);
    const b = buildBrain(7, 5000, 800);
    expect(a.positions).toEqual(b.positions);
  });
});
