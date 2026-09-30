import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { BrainSession } from './brainSession.js';
import { parseConnectome } from './lifBrain.js';

const raw = gunzipSync(readFileSync(new URL('../../public/connectome/flywire783.bin.gz', import.meta.url)));
const conn = parseConnectome(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

function session() {
  const inbox = [];
  const s = new BrainSession(conn, { post: (m) => inbox.push(m), seed: 3 });
  s.start();
  const until = async (fn, ms = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timeout');
  };
  return { s, inbox, until, frames: () => inbox.filter((m) => m.type === 'frame') };
}

describe('BrainSession (the same code runs on the server and in the browser)', () => {
  it('has real positions and named FlyWire neurons', () => {
    expect(conn.positions).toHaveLength(conn.n * 3);
    expect(conn.header.named.map((n) => n.type)).toEqual(expect.arrayContaining(['DNp01', 'DNa02', 'DNp09', 'LPLC2']));
    expect(conn.header.signs.alLocalAsGaba).toBeGreaterThan(0);
  });

  it('controls stimulate the descending neurons, lesions silence them, spikes of named cells are streamed', async () => {
    const { s, until, frames } = session();
    s.handle({ type: 'control', name: 'steerL', hz: 80 });
    const steering = await until(() => frames().find((f) => f.groups.steerL > 40 && f.groups.steerR < 10));
    expect(steering.controls.steerL).toBe(80);
    expect(frames().some((f) => f.spikes.length > 0)).toBe(true);
    s.handle({ type: 'lesion', name: 'steer', on: true });
    const n = frames().length;
    await until(() => frames().length > n + 20);
    expect(frames().at(-1).groups.steerL).toBeLessThan(5);
    expect(frames().at(-1).lesions.steer).toBe(true);
    s.stop();
  }, 60000);

  it('learning: pairing odour A with dopamine weakens A’s KC->MBON drive, not B’s', async () => {
    const { s, inbox, until } = session();
    // the world keeps sending smells and hunger meanwhile: the lab protocol must ignore them
    s.handle({ type: 'drive', rates: { olfactoryL: 40, olfactoryR: 40, visionL: 20, visionR: 20 } });
    s.handle({ type: 'control', name: 'hunger', hz: 30 });
    const results = () => inbox.filter((m) => m.type === 'experiment' && !m.calibration);
    // the session first calibrates both odours (finds their Kenyon cells)
    await until(() => inbox.filter((m) => m.calibration).length === 2);
    const run = async (action, odor) => {
      const k = results().length;
      s.handle({ type: 'experiment', action, odor });
      return until(() => results()[k]);
    };
    for (let i = 0; i < 3; i++) expect((await run('train', 'A')).changed).toBeGreaterThan(0);
    const a1 = await run('test', 'A');
    const b1 = await run('test', 'B');
    // drive relative to each odour's calibrated (untrained) drive
    const dA = 1 - a1.drive / a1.baseline;
    const dB = 1 - b1.drive / b1.baseline;
    expect(dA).toBeGreaterThan(0.2);
    expect(dB).toBeLessThan(dA / 2);
    // the synaptic memory readout: A is now rewarded (approach), B untouched
    expect(a1.memory.valence).toBeGreaterThan(0.05);
    expect(Math.abs(b1.memory.valence)).toBeLessThan(a1.memory.valence / 2);
    // punishing B makes it aversive
    for (let i = 0; i < 3; i++) await run('punish', 'B');
    const b2 = await run('test', 'B');
    expect(b2.memory.valence).toBeLessThan(-0.03);
    s.stop();
  }, 180000);
});
