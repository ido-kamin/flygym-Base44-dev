// Self-test: runs the published circuits on fresh copies of the FlyWire brain
// and reports what the neurons did, so anyone can check that the fly's
// behaviour comes from the connectome (and where it was computed).

import { LIFBrain } from './lifBrain.js';

const side = (g) => [...g.L, ...g.R];

/**
 * @param {ReturnType<import('./lifBrain.js').parseConnectome>} conn
 * @param {{wmv?:Float32Array, now?:()=>number}} [opts]
 * @returns {{checks:{name:string, pass:boolean, measured:string, expect:string}[], simMs:number, wallMs:number, spikes:number}}
 */
export function runSelfTest(conn, { wmv = null, now = () => performance.now() } = {}) {
  const G = conn.header.groups;
  const t0 = now();
  let simMs = 0;
  let spikes = 0;
  const run = (setup, ms, after) => {
    const b = new LIFBrain(conn, { seed: 7, wmv });
    setup(b);
    for (let i = 0; i < ms; i++) b.step();
    simMs += ms;
    spikes += b.totalSpikes;
    return after(b);
  };
  const hz = (x) => `${Math.round(x)} Hz`;
  const checks = [];

  const loom = (s) =>
    run(
      (b) => b.setDrive(G.looming[s], 140),
      300,
      (b) => ({
        escL: b.groupRate(G.escape.L),
        escR: b.groupRate(G.escape.R),
        stL: b.groupRate(G.steer.L),
        stR: b.groupRate(G.steer.R),
      }),
    );
  const L = loom('L');
  checks.push({
    name: 'Spider on the left: giant fibers fire, steer right (away)',
    pass: Math.max(L.escL, L.escR) > 40 && L.escL > L.escR && L.stR > L.stL && L.stR >= 5,
    measured: `DNp01 L ${hz(L.escL)} / R ${hz(L.escR)} · DNa02 L ${hz(L.stL)} / R ${hz(L.stR)}`,
    expect: 'DNp01 > 40 Hz, left leads; DNa02 right > left (≥ 5 Hz)',
  });
  const R = loom('R');
  checks.push({
    name: 'Spider on the right: giant fibers fire, steer left (away)',
    pass: Math.max(R.escL, R.escR) > 40 && R.escR > R.escL && R.stL > R.stR && R.stL >= 5,
    measured: `DNp01 L ${hz(R.escL)} / R ${hz(R.escR)} · DNa02 L ${hz(R.stL)} / R ${hz(R.stR)}`,
    expect: 'DNp01 > 40 Hz, right leads; DNa02 left > right (≥ 5 Hz)',
  });

  const lesioned = run(
    (b) => {
      b.silence(side(G.escape), true);
      b.setDrive(G.looming.R, 140);
    },
    300,
    (b) => Math.max(b.groupRate(G.escape.L), b.groupRate(G.escape.R)),
  );
  checks.push({
    name: 'Lesion: silence DNp01, show the spider again',
    pass: lesioned === 0,
    measured: `DNp01 ${hz(lesioned)}`,
    expect: 'no escape (0 Hz)',
  });

  const sugar = run(
    (b) => b.setDrive(side(G.sugar), 200),
    300,
    (b) => ({ feed: b.groupRate(G.feed.all), esc: b.groupRate(side(G.escape)) }),
  );
  checks.push({
    name: 'Sugar on the proboscis: feeding motor neurons fire',
    pass: sugar.feed > 5 && sugar.esc < 5,
    measured: `motor neurons ${hz(sugar.feed)} · DNp01 ${hz(sugar.esc)}`,
    expect: 'motor neurons > 5 Hz, no escape (Shiu et al. 2024)',
  });

  if (G.photoreceptor) {
    const light = run(
      (b) => b.setDrive(side(G.photoreceptor).filter((_, i) => i % 2 === 0), 20),
      200,
      (b) => {
        const c = b.clusterRates();
        return { ol: (c[0] + c[1]) / 2, esc: b.groupRate(side(G.escape)) };
      },
    );
    checks.push({
      name: 'Light on the eyes: optic lobes respond, nothing else fires off',
      pass: light.ol > 0.05 && light.esc < 5,
      measured: `optic lobes ${light.ol.toFixed(2)} Hz mean · DNp01 ${hz(light.esc)}`,
      expect: 'optic-lobe activity, no escape',
    });
  }

  if (G.kc && G.orn_DM4) {
    const b = new LIFBrain(conn, { seed: 7, wmv });
    b.enablePlasticity({ kc: G.kc.all, mbon: G.mbon.all, dan: G.dopamine.all });
    const present = (orn, reward) => {
      const before = Uint32Array.from(b.spikeCount);
      b.setDrive(orn, 50);
      for (let t = 0; t < 400; t++) {
        if (reward && t === 100) {
          b.setDrive(G.dopamine.all, 80);
          b.plastic.enabled = true;
        }
        b.step();
        if (reward && t % 50 === 49) b.learn();
      }
      b.setDrive(orn, 0);
      if (reward) b.setDrive(G.dopamine.all, 0);
      b.learn();
      b.plastic.enabled = false;
      const d = new Uint32Array(conn.n);
      for (let i = 0; i < d.length; i++) d[i] = b.spikeCount[i] - before[i];
      b.rest();
      simMs += 400;
      return b.kcDrive(d);
    };
    const A = side(G.orn_DM4);
    const B = side(G.orn_VA2);
    const a0 = present(A);
    const b0 = present(B);
    for (let k = 0; k < 3; k++) present(A, true);
    const a1 = present(A);
    const b1 = present(B);
    spikes += b.totalSpikes;
    const dA = 1 - a1 / a0;
    const dB = 1 - b1 / b0;
    checks.push({
      name: 'Learning: odour A + dopamine x3 weakens only odour A’s memory synapses',
      pass: dA > 0.25 && dB < dA / 2,
      measured: `odour A drive −${Math.round(dA * 100)}% · odour B −${Math.round(Math.max(0, dB) * 100)}% · ${b.plastic.changes} synapses changed`,
      expect: 'A drops > 25%, B less than half as much (Hige et al. 2015)',
    });
  }

  return { checks, simMs, wallMs: now() - t0, spikes };
}
