import { describe, expect, it } from 'vitest';

import { BUILD_TASKS, Game, MISSIONS, SEARCH_TOKEN, STEP } from './game.js';

const eatNow = (g, kind, extra = {}) => {
  g.sugars = [{ x: g.fly.x + Math.cos(g.fly.theta) * 14, y: g.fly.y + Math.sin(g.fly.theta) * 14, phase: 0, age: 0, kind, ...extra }];
  g.step(STEP);
  return g.drainEvents();
};

describe('missions', () => {
  it('build mission: the Base44 builder tasks in order ship an app', () => {
    const g = new Game({ seed: 3 });
    g.setMission('build');
    expect(g.sugars.every((s) => BUILD_TASKS.includes(s.kind))).toBe(true);
    let events = [];
    for (const task of BUILD_TASKS) events = events.concat(eatNow(g, task));
    expect(events.filter((e) => e.type === 'stage')).toHaveLength(BUILD_TASKS.length);
    expect(events.some((e) => e.type === 'shipped')).toBe(true);
    expect(g.deployments).toBe(1);
    expect(g.pipeline).toBe(0);
  });

  it('out-of-order tasks are "merge conflicts" and do not advance', () => {
    const g = new Game({ seed: 4 });
    g.setMission('build');
    const ev = eatNow(g, 'Publish');
    expect(ev.some((e) => e.type === 'wrongStage' && e.need === 'Add page')).toBe(true);
    expect(g.pipeline).toBe(0);
  });

  it('search mission: [Search] asks for results, results become readable food', () => {
    const g = new Game({ seed: 5 });
    g.setMission('search');
    expect(g.sugars.map((s) => s.kind)).toEqual([SEARCH_TOKEN]);
    expect(eatNow(g, SEARCH_TOKEN).some((e) => e.type === 'needSearch')).toBe(true);
    g.setSearchResults('fruit fly', [
      { title: 'Drosophila', snippet: 'a fly', url: 'u1' },
      { title: 'Connectome', snippet: 'wiring', url: 'u2' },
    ]);
    const titles = g.sugars.map((s) => s.kind);
    expect(titles).toEqual(expect.arrayContaining(['Drosophila', 'Connectome']));
    const read = eatNow(g, 'Drosophila', { result: { title: 'Drosophila', url: 'u1', query: 'fruit fly' } });
    expect(read.find((e) => e.type === 'read').result.url).toBe('u1');
    expect(Object.keys(MISSIONS)).toEqual(['forage', 'build', 'search', 'vibe', 'sandbox']);
  });

  it('sandbox: the fly cannot starve, odour sources reach each antenna, learned valence turns it', () => {
    const g = new Game({ seed: 4 });
    g.setMission('sandbox');
    g.motorMode = 'neurons';
    g.energy = 1;
    g.step(1 / 120);
    expect(g.over).toBe(false);
    expect(g.energy).toBeGreaterThanOrEqual(40);
    g.fly.theta = 0;
    // odour A ahead and to the fly's right (+y is its right when heading +x)
    expect(g.addOdor(g.fly.x + 80, g.fly.y + 60, 'A')).toBe(true);
    g.sense();
    expect(g.sensors.odorAR).toBeGreaterThan(g.sensors.odorAL);
    expect(g.sensors.odorBL + g.sensors.odorBR).toBe(0);
    // rewarded A: turn toward it (right, +); punished A: away (left, -)
    expect(g.memoryTurn({ A: { valence: 0.5 } })).toBeGreaterThan(0.05);
    expect(g.memoryTurn({ A: { valence: -0.5 } })).toBeLessThan(-0.05);
    expect(g.memoryTurn({ B: { valence: 0.5 } })).toBe(0);
    // leaving the sandbox clears its odours
    g.setMission('forage');
    expect(g.odorSources).toHaveLength(0);
  });
});

describe('training (dopamine-gated plasticity)', () => {
  it('rewarding strengthens the most active pathway, punishing weakens it', () => {
    const g = new Game({ seed: 6 });
    g.reset(6, [8, 8, 8, 8, 8, 8], 0);
    g.eligibility.set([0.9, 0.1, 0.1, 0.1, 0.1, 0.1]); // sugar-drive pathway was busy
    let changes = [];
    for (let i = 0; i < 3; i++) changes = changes.concat(g.train(+1));
    expect(changes.some((c) => c.gene === 0 && c.delta === 1)).toBe(true);
    expect(g.weights[0]).toBeGreaterThan(8);
    const before = g.weights[0];
    for (let i = 0; i < 6; i++) g.train(-1);
    expect(g.weights[0]).toBeLessThan(before);
  });

  it('changes the DNA only once a whole gene level is learned, and stays in range', () => {
    const g = new Game({ seed: 7 });
    g.reset(7, [15, 8, 8, 8, 8, 0], 0);
    const dna = g.toDNA();
    g.eligibility.set([0.5, 0.45, 0.45, 0.45, 0.45, 0.45]);
    g.train(0.1);
    expect(g.toDNA()).toBe(dna); // tiny nudge: no whole-level change yet
    g.eligibility.set([1, 0, 0, 0, 0, 1]);
    for (let i = 0; i < 20; i++) g.train(+1);
    expect(g.weights[0]).toBe(15);
    expect(g.weights[5]).toBeLessThanOrEqual(15);
    expect(g.weights.every((w) => w >= 0 && w <= 15)).toBe(true);
  });

  it('eligibility follows pathway activity over time', () => {
    const g = new Game({ seed: 8 });
    for (let i = 0; i < 120 * 5; i++) g.step(STEP);
    expect(Math.max(...g.eligibility)).toBeGreaterThan(0.05);
  });
});
