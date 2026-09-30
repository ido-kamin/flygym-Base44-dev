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
    await until(() => frames().length > n + 6);
    expect(frames().at(-1).groups.steerL).toBeLessThan(5);
    expect(frames().at(-1).lesions.steer).toBe(true);
    s.stop();
  }, 60000);

  it('learning: pairing odour A with dopamine weakens A’s KC->MBON drive, not B’s', async () => {
    const { s, inbox, until } = session();
    const run = async (action, odor) => {
      const k = inbox.filter((m) => m.type === 'experiment').length;
      s.handle({ type: 'experiment', action, odor });
      return until(() => inbox.filter((m) => m.type === 'experiment')[k]);
    };
    const a0 = await run('test', 'A');
    const b0 = await run('test', 'B');
    for (let i = 0; i < 3; i++) expect((await run('train', 'A')).changed).toBeGreaterThan(0);
    const a1 = await run('test', 'A');
    const b1 = await run('test', 'B');
    const dA = 1 - a1.drive / a0.drive;
    const dB = 1 - b1.drive / b0.drive;
    expect(a0.kcs).toBeGreaterThan(20); // a sparse odour code: tens of Kenyon cells, not thousands
    expect(a0.kcs).toBeLessThan(600);
    expect(dA).toBeGreaterThan(0.25);
    expect(dB).toBeLessThan(dA / 2);
    expect(a1.baseline).toBe(a0.drive);
    s.stop();
  }, 120000);
});
