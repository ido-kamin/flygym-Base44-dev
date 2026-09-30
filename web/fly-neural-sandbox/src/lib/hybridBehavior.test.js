import { describe, expect, it } from 'vitest';
import { ARENA } from './constants.js';
import { Game, STEP } from './game.js';

function hybrid(seed = 11) {
  const g = new Game({ seed });
  g.motorMode = 'hybrid';
  return g;
}
const run = (g, seconds) => {
  for (let i = 0; i < seconds / STEP; i++) g.step(STEP);
};

describe('lifelike hybrid assistance', () => {
  it('approaches nearby food even with a persistent neural turning bias', () => {
    for (const turn of [-1, 0, 1]) {
      const g = hybrid();
      g.fly.theta = 0;
      g.fly.groomCooldown = 100;
      g.brainMotor = { turn, walk: 0.6 };
      const food = { x: g.fly.x + 160, y: g.fly.y + 65, phase: 0, age: 0 };
      g.sugars = [food];
      run(g, 12);
      expect(g.sugars.includes(food)).toBe(false);
      expect(g.score).toBeGreaterThan(0);
    }
  });

  it('alternates walking and pauses, covers ground, and stays fed across seeds', () => {
    for (const seed of [1, 5, 11, 44]) {
      const g = hybrid(seed);
      g.brainMotor = { turn: 0.9, walk: 0.6 };
      const cells = new Set();
      const behaviours = new Set();
      let slow = false;
      let fast = false;
      for (let i = 0; i < 60 / STEP; i++) {
        g.step(STEP);
        cells.add(`${Math.floor(g.fly.x / 100)},${Math.floor(g.fly.y / 100)}`);
        behaviours.add(g.behaviour);
        if (g.behaviour === 'stand' && g.fly.v < 20) slow = true;
        if (g.fly.v > 60) fast = true;
        expect(Number.isFinite(g.fly.theta)).toBe(true);
      }
      expect(cells.size).toBeGreaterThan(6);
      expect(behaviours.has('feed')).toBe(true);
      expect(slow && fast).toBe(true);
      expect(g.score).toBeGreaterThan(2);
      expect(g.over).toBe(false);
    }
  });

  it('turns inward before reaching each wall', () => {
    for (const [x, y, theta] of [[90, ARENA.h / 2, Math.PI], [ARENA.w - 90, ARENA.h / 2, 0], [ARENA.w / 2, 90, -Math.PI / 2], [ARENA.w / 2, ARENA.h - 90, Math.PI / 2]]) {
      const g = hybrid();
      Object.assign(g.fly, { x, y, theta, groomCooldown: 100 });
      g.hybrid.heading = theta;
      g.sugars = [];
      g.foodTarget = () => 0;
      run(g, 3);
      expect(g.drainEvents().some((e) => e.type === 'bump')).toBe(false);
      expect(Math.min(g.fly.x, ARENA.w - g.fly.x, g.fly.y, ARENA.h - g.fly.y)).toBeGreaterThan(90);
    }
  });

  it('keeps neural escapes, but pivots briefly rather than making a circle', () => {
    const g = hybrid();
    g.fly.theta = 0;
    g.brainMotor = { turn: 0, walk: 0.5, escape: true, escapeSide: 1 };
    g.step(STEP);
    expect(g.drainEvents()).toContainEqual(expect.objectContaining({ type: 'escape', brain: true }));
    g.brainMotor.escape = false;
    run(g, 0.8);
    expect(g.fly.theta).toBeLessThan(-0.2);
    expect(Math.abs(g.fly.theta)).toBeLessThan(1.3);
  });

  it('can reach food near an edge without avoidance trapping it', () => {
    const g = hybrid();
    Object.assign(g.fly, { x: 180, y: ARENA.h / 2, theta: Math.PI, groomCooldown: 100 });
    const food = { x: 50, y: g.fly.y, phase: 0, age: 0 };
    g.sugars = [food];
    run(g, 8);
    expect(g.sugars.includes(food)).toBe(false);
    expect(g.score).toBeGreaterThan(0);
  });

  it('preserves held neural steering instead of treating it as a resting bias', () => {
    const g = hybrid();
    g.fly.theta = 0;
    g.brainMotor = { turn: -1, walk: 0.5, steering: true };
    g.hybrid.pause = 1;
    let command;
    for (let i = 0; i < 4 / STEP; i++) command = g.hybrid.step(STEP, g);
    expect(g.hybrid.pause).toBe(0);
    expect(command.turn).toBeLessThan(-0.35);
    expect(command.speed).toBeGreaterThan(0);
  });

  it('is deterministic and resets its behavioral state on restart', () => {
    const a = hybrid(9);
    const b = hybrid(9);
    run(a, 20);
    run(b, 20);
    expect(a.fly).toEqual(b.fly);
    const old = a.hybrid;
    a.restart();
    expect(a.hybrid).not.toBe(old);
    expect(a.hybrid.target).toBe(null);
    expect(a.hybrid.neuralBias).toBe(0);
    expect(a.motorMode).toBe('hybrid');
  });
});
