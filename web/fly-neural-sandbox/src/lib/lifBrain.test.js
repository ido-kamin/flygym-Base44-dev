import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { LIFBrain, parseConnectome, sensoryDrive, TRIALS } from './lifBrain.js';
import { mulberry32 } from './genome.js';

const PARAMS = { v0: -52, vReset: -52, vTh: -45, tauM: 20, tauSyn: 5, tRef: 2.2, delay: 1.8, wSyn: 0.275, poissonWeight: 68.75 };

/** Encode a CSR network in the FWC2 file format (mirror of prep_flywire_connectome.py). */
function encode({ n, rows, cluster, side, header = {} }) {
  const hjson = new TextEncoder().encode(JSON.stringify({ n, params: PARAMS, groups: {}, clusterCounts: countClusters(cluster), ...header }));
  const bytes = [];
  const varint = (x) => {
    do {
      let b = x & 0x7f;
      x = Math.floor(x / 128);
      if (x) b |= 0x80;
      bytes.push(b);
    } while (x);
  };
  const offsets = new Uint32Array(n + 1);
  rows.forEach((row, i) => {
    offsets[i + 1] = offsets[i] + row.length;
    let prev = 0;
    for (const [post, w] of row) {
      varint(post - prev);
      prev = post;
      varint(w >= 0 ? 2 * w : -2 * w - 1);
    }
  });
  const pad = (4 - ((8 + hjson.length) % 4)) % 4;
  const out = new Uint8Array(8 + hjson.length + pad + offsets.byteLength + 2 * n + bytes.length);
  out.set([70, 87, 67, 50]);
  new DataView(out.buffer).setUint32(4, hjson.length, true);
  out.set(hjson, 8);
  let off = 8 + hjson.length + pad;
  out.set(new Uint8Array(offsets.buffer), off);
  off += offsets.byteLength;
  out.set(cluster, off);
  out.set(side, off + n);
  out.set(bytes, off + 2 * n);
  return out.buffer;
}

function countClusters(cluster) {
  const c = new Array(16).fill(0);
  for (const x of cluster) c[x]++;
  return c;
}

/** A random sparse signed network with a few strong hubs. */
function randomNetwork(n, seed) {
  const rng = mulberry32(seed);
  const rows = Array.from({ length: n }, () => {
    const targets = new Map();
    const k = 4 + Math.floor(rng() * 12);
    for (let e = 0; e < k; e++) {
      const j = Math.floor(rng() * n);
      const w = Math.round((rng() < 0.75 ? 1 : -1) * (5 + rng() * 60));
      targets.set(j, w);
    }
    return [...targets.entries()].sort((a, b) => a[0] - b[0]);
  });
  const cluster = Uint8Array.from({ length: n }, () => Math.floor(rng() * 16));
  const side = Uint8Array.from({ length: n }, () => Math.floor(rng() * 3));
  return { n, rows, cluster, side };
}

/** Straightforward dense implementation of the same equations (every neuron, every step). */
function denseRun(conn, drive, steps, seed) {
  const P = conn.header.params;
  const { n, offsets, post, weight } = conn;
  const v = new Float64Array(n).fill(P.v0);
  const g = new Float64Array(n);
  const refr = new Float64Array(n);
  const D = Math.round(P.delay) + 1;
  const ring = Array.from({ length: D }, () => new Float64Array(n));
  const rng = mulberry32(seed);
  const poisson = new Uint8Array(n);
  for (const i of drive.keys()) poisson[i] = 1;
  const spikes = new Int32Array(n);
  const kM = 1 / P.tauM;
  const dG = Math.exp(-1 / P.tauSyn);
  for (let s = 0; s < steps; s++) {
    const now = ring[s % D];
    const future = ring[(s + D - 1) % D];
    for (let i = 0; i < n; i++) {
      g[i] += now[i];
      now[i] = 0;
    }
    for (const [i, hz] of drive) if (rng() < hz / 1000) v[i] += P.poissonWeight;
    for (let i = 0; i < n; i++) {
      if (refr[i] > 0) {
        refr[i] -= 1;
        continue;
      }
      v[i] += kM * (P.v0 - v[i] + g[i]);
      g[i] *= dG;
      if (v[i] > P.vTh) {
        spikes[i]++;
        v[i] = P.vReset;
        g[i] = 0;
        refr[i] = poisson[i] ? 0 : P.tRef;
        for (let e = offsets[i]; e < offsets[i + 1]; e++) future[post[e]] += weight[e] * P.wSyn;
      }
    }
  }
  return spikes;
}

describe('parseConnectome', () => {
  it('round-trips the packed CSR network', () => {
    const net = randomNetwork(300, 5);
    const conn = parseConnectome(encode(net));
    expect(conn.n).toBe(300);
    expect(conn.nnz).toBe(net.rows.reduce((a, r) => a + r.length, 0));
    for (const i of [0, 17, 299]) {
      const row = Array.from({ length: conn.offsets[i + 1] - conn.offsets[i] }, (_, k) => [
        conn.post[conn.offsets[i] + k],
        conn.weight[conn.offsets[i] + k],
      ]);
      expect(row).toEqual(net.rows[i]);
    }
    expect(Array.from(conn.cluster)).toEqual(Array.from(net.cluster));
  });

  it('rejects other files', () => {
    expect(() => parseConnectome(new Uint8Array(16).buffer)).toThrow(/not a FlyWire connectome/);
  });
});

describe('LIFBrain', () => {
  it('matches a dense integration of the same equations', () => {
    const conn = parseConnectome(encode(randomNetwork(400, 9)));
    const driven = Array.from({ length: 20 }, (_, i) => i * 7);
    const brain = new LIFBrain(conn, { seed: 42 });
    brain.setDrive(driven, 120);
    for (let s = 0; s < 600; s++) brain.step();
    const spikes = brain.spikeCount;
    const dense = denseRun(conn, new Map(driven.map((i) => [i, 120])), 600, 42);
    const total = dense.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(500); // the network is actually active
    expect(brain.totalSpikes).toBe(spikes.reduce((a, b) => a + b, 0));
    let same = 0;
    for (let i = 0; i < conn.n; i++) if (Math.abs(spikes[i] - dense[i]) <= 1) same++;
    expect(same / conn.n).toBeGreaterThan(0.99);
    expect(Math.abs(brain.totalSpikes - total) / total).toBeLessThan(0.01);
  });

  it('is silent without input and quiet again after rest()', () => {
    const conn = parseConnectome(encode(randomNetwork(200, 3)));
    const brain = new LIFBrain(conn);
    for (let s = 0; s < 100; s++) brain.step();
    expect(brain.totalSpikes).toBe(0);
    brain.setDrive([1, 2, 3], 200);
    for (let s = 0; s < 100; s++) brain.step();
    expect(brain.totalSpikes).toBeGreaterThan(0);
    brain.setDrive([1, 2, 3], 0);
    brain.rest();
    const after = brain.totalSpikes;
    for (let s = 0; s < 100; s++) brain.step();
    expect(brain.totalSpikes).toBe(after);
    expect(brain.activeCount).toBe(0);
  });

  it('maps senses to Poisson rates', () => {
    expect(sensoryDrive({ loomL: 1, loomR: 0.5, touch: 2 })).toEqual({ visionL: 6, visionR: 6, loomingL: 140, loomingR: 70, mechano: 60 });
    expect(sensoryDrive({ visionL: 1 }).visionL).toBe(30);
    expect(TRIALS.sugar).toMatchObject({ group: 'sugar', hz: 200 });
  });
});

// The shipped FlyWire v783 connectome: the published circuits respond as in the papers.
describe('FlyWire connectome', () => {
  const raw = gunzipSync(readFileSync(new URL('../../public/connectome/flywire783.bin.gz', import.meta.url)));
  const conn = parseConnectome(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const G = conn.header.groups;
  const both = (g) => [...g.L, ...g.R];
  const run = (setup, ms) => {
    const b = new LIFBrain(conn, { seed: 11 });
    setup(b);
    for (let i = 0; i < ms; i++) b.step();
    return b;
  };

  it('has the whole brain', () => {
    expect(conn.n).toBe(138639);
    expect(conn.nnz).toBeGreaterThan(2.5e6);
    expect(G.escape.L).toHaveLength(1); // one giant fiber (DNp01) per side
    expect(G.escape.R).toHaveLength(1);
    expect(conn.header.license).toMatch(/CC BY-NC/);
  });

  it('a looming stimulus on one eye fires the giant fibers and steers away', () => {
    const b = run((x) => x.setDrive(G.looming.R, 140), 300);
    expect(Math.max(b.groupRate(G.escape.L), b.groupRate(G.escape.R))).toBeGreaterThan(40);
    expect(b.groupRate(G.escape.R)).toBeGreaterThan(b.groupRate(G.escape.L));
    // DNa02 on the side away from the threat
    expect(b.groupRate(G.steer.L)).toBeGreaterThan(b.groupRate(G.steer.R) + 20);
  }, 60000);

  it('light on the eyes drives the optic lobes without running away', () => {
    const b = run((x) => x.setDrive([...G.photoreceptor.L, ...G.photoreceptor.R].filter((_, i) => i % 2 === 0), 20), 200);
    const rates = b.clusterRates();
    expect(rates[0]).toBeGreaterThan(0.2); // OL_L
    expect(rates[1]).toBeGreaterThan(0.2); // OL_R
    expect(b.groupRate(G.escape.L) + b.groupRate(G.escape.R)).toBe(0); // no escape from plain light
  }, 60000);

  it('tasting sugar drives the brain motor neurons (feeding)', () => {
    const b = run((x) => x.setDrive(both(G.sugar), 200), 250);
    expect(b.groupRate(G.feed.all)).toBeGreaterThan(5);
  }, 60000);
});
