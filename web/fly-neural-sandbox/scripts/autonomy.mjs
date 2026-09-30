// Autonomy check: the fly alone for a minute, no player input. Couples the same
// Game (neurons-only mode) and BrainSession code the page uses, in lockstep:
// 1 ms brain steps, senses at 20 Hz, the pure motor readout. Prints what the
// fly did and what its neurons did.
//
//   node scripts/autonomy.mjs [seconds=60] [seed=1]
// (also run, shorter, by src/lib/autonomy.test.js)

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { BrainSession } from '../src/lib/brainSession.js';
import { Game } from '../src/lib/game.js';
import { parseConnectome } from '../src/lib/lifBrain.js';
import { HUNGER_HZ, motorFromGroups, senseRates } from '../src/lib/realBrain.js';

/** Run the fly alone for `seconds`; a spider appears halfway. Returns what happened. */
export function runAlone(conn, { seconds = 60, seed = 1, spider = true } = {}) {

  let frame = null;
  let simNow = 0;
  const session = new BrainSession(conn, { post: (m) => m.type === 'frame' && (frame = m), seed, now: () => simNow });
  const game = new Game({ seed });
  game.motorMode = 'neurons';
  game.energy = 70; // a bit hungry
  const state = { turnBaseline: 0 };
  const H = 1 / 120;
  let touch = 0;
  const log = { distance: 0, left: 0, right: 0, eaten: 0, escapes: 0, escapesBeforeSpider: 0, feedingS: 0, restS: 0, bumps: 0, headings: [] };
  let last = { x: game.fly.x, y: game.fly.y };
  const t0 = performance.now();
  let brainMs = 0;
  for (let step = 0; step * H < seconds; step++) {
    const t = step * H;
    if (spider && Math.abs(t - seconds / 2) < H / 2) {
      // halfway: a spider appears 90 units ahead-right of the fly
      const f = game.fly;
      game.addPredator(f.x + Math.cos(f.theta + 0.6) * 90, f.y + Math.sin(f.theta + 0.6) * 90);
    }
    // brain catches up to game time (1 ms steps)
    while (brainMs < t * 1000) {
      session.brain.step();
      brainMs += 1;
      simNow += 1;
      if (brainMs % 50 === 0) session.frame(simNow);
    }
    if (step % 6 === 0) {
      touch = Math.max(0, touch - 0.05 / 0.15);
      session.handle({ type: 'drive', rates: senseRates(game.sensors, { speed: game.fly.v / 300, turn: game.fly.omega / 5.5 }, touch > 0) });
      const hz = Math.round(HUNGER_HZ.min + (HUNGER_HZ.max - HUNGER_HZ.min) * (1 - game.energy / 100));
      session.handle({ type: 'control', name: 'hunger', hz });
    }
    game.brainMotor = frame ? motorFromGroups(frame.groups, state, {}, H) : null;
    game.step(H);
    for (const ev of game.drainEvents()) {
      if (ev.type === 'eat') log.eaten++;
      if (ev.type === 'escape' && ev.brain) {
        log.escapes++;
        if (!game.predators.length) log.escapesBeforeSpider++;
      }
      if (ev.type === 'bump' || ev.type === 'hit') {
        touch = 1;
        log.bumps++;
      }
    }
    const f = game.fly;
    log.distance += Math.hypot(f.x - last.x, f.y - last.y);
    last = { x: f.x, y: f.y };
    if (f.omega < -0.3) log.left += H;
    if (f.omega > 0.3) log.right += H;
    if (game.behaviour === 'feed') log.feedingS += H;
    if (game.behaviour === 'stand') log.restS += H;
    if (step % 600 === 0) log.headings.push(Math.round((f.theta * 180) / Math.PI));
    if (game.over) break;
}
log.wallS = (performance.now() - t0) / 1000;
log.seconds = seconds;
log.energy = game.energy;
log.spikes = session.brain.totalSpikes;
log.neuronsFired = Array.from(session.brain.spikeCount).filter((c) => c > 0).length;
log.n = conn.n;
return log;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seconds = Number(process.argv[2] ?? 60);
  const seed = Number(process.argv[3] ?? 1);
  const raw = gunzipSync(readFileSync(new URL('../public/connectome/flywire783.bin.gz', import.meta.url)));
  const conn = parseConnectome(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const log = runAlone(conn, { seconds, seed });
  console.log(`${seconds} s alone (seed ${seed}), computed in ${log.wallS.toFixed(1)} s (${(seconds / log.wallS).toFixed(2)}x real time)`);
  console.log(`walked ${(log.distance * 0.044).toFixed(0)} mm · turned left ${log.left.toFixed(1)} s, right ${log.right.toFixed(1)} s · headings every 5 s: ${log.headings.join(', ')}`);
  console.log(`ate ${log.eaten} sugar drops (fed ${log.feedingS.toFixed(1)} s) · rested ${log.restS.toFixed(1)} s · wall bumps ${log.bumps} · giant-fiber take-offs ${log.escapes} (${log.escapesBeforeSpider} before the spider) · energy ${log.energy.toFixed(0)}`);
  console.log(`brain: ${(log.spikes / 1e6).toFixed(1)}M spikes, ${log.neuronsFired} of ${log.n} neurons fired`);
}
