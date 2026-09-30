// Web Worker: runs the whole-brain LIF model (lifBrain.js) on the FlyWire
// connectome off the main thread, as close to real time as the CPU allows.
//
// in:  {type:'init', buffer}                 gunzipped connectome file (transferred)
//      {type:'drive', rates:{group: Hz}}     continuous sensory drive (light, looming, touch)
//      {type:'trial', name}                  a stimulus trial from TRIALS (taste, smell)
// out: {type:'ready', n, nnz, cluster (Uint8 per neuron), header}
//      {type:'frame', activity (Uint8 per neuron), clusters (Hz x16), groups {name: Hz}, stats}

import { LIFBrain, parseConnectome, TRIALS } from './lifBrain.js';

let brain = null;
let groups = null;
let driveGroups = null;
let trial = null; // {name, group, until}
const FRAME_MS = 50; // post activity ~20x per second
const BUDGET_MS = 12; // simulate in slices so messages get through

function side(g) {
  return [...(g?.L ?? []), ...(g?.R ?? [])];
}

function init(buffer) {
  const conn = parseConnectome(buffer);
  brain = new LIFBrain(conn, { seed: (Math.random() * 2 ** 31) | 0 });
  const G = conn.header.groups;
  groups = G;
  // odour-specific subsets: a real odour activates a few glomeruli, not every ORN
  const subset = (list, k) => list.filter((_, i) => i % k === 0);
  driveGroups = {
    visionL: subset(G.photoreceptor.L, 2),
    visionR: subset(G.photoreceptor.R, 2),
    olfactoryL: subset(G.olfactory.L, 6),
    olfactoryR: subset(G.olfactory.R, 6),
    loomingL: G.looming.L,
    loomingR: G.looming.R,
    sugar: side(G.sugar),
    mechano: subset(side(G.mechano), 4),
  };
  const cluster = conn.cluster.slice();
  postMessage(
    {
      type: 'ready',
      n: conn.n,
      nnz: conn.nnz,
      cluster, // game region of each neuron, so the renderer can place its spikes
      header: { source: conn.header.source, license: conn.header.license, clusterCounts: conn.header.clusterCounts },
    },
    [cluster.buffer],
  );
  loop();
}

const lastDrive = {};
function setDrive(rates) {
  for (const [k, hz] of Object.entries(rates)) {
    const q = Math.round(hz);
    if (!driveGroups[k] || lastDrive[k] === q) continue;
    lastDrive[k] = q;
    brain.setDrive(driveGroups[k], q);
  }
}

function startTrial(name) {
  const t = TRIALS[name];
  if (!t || trial) return; // one trial at a time
  trial = { name, group: t.group, until: brain.t + t.ms };
  brain.setDrive(driveGroups[t.group], t.hz);
}

function endTrial() {
  brain.setDrive(driveGroups[trial.group], 0);
  trial = null;
  brain.rest();
  // continuous drives stay on (rest() keeps them); re-apply in case a trial shared a group
  for (const [k, hz] of Object.entries(lastDrive)) if (hz > 0) brain.setDrive(driveGroups[k], hz);
}

let lastFrame = 0;
let simAtFrame = 0;
let wallAtFrame = 0;
const clusters = new Float32Array(16);
function loop() {
  const start = performance.now();
  // run no faster than real time
  const target = start - wallAtFrame + simAtFrame;
  while (performance.now() - start < BUDGET_MS && brain.t < target + 5) {
    brain.step();
    if (trial && brain.t >= trial.until) endTrial();
  }
  const now = performance.now();
  if (now - lastFrame >= FRAME_MS) {
    const wall = now - wallAtFrame;
    const sim = brain.t - simAtFrame;
    const activity = brain.activityBytes();
    brain.clusterRates(clusters);
    const r = (list) => brain.groupRate(list);
    postMessage(
      {
        type: 'frame',
        activity,
        clusters: clusters.slice(),
        groups: {
          steerL: r(groups.steer.L),
          steerR: r(groups.steer.R),
          steer2L: r(groups.steer2.L),
          steer2R: r(groups.steer2.R),
          walk: r(side(groups.walk)),
          escapeL: r(groups.escape.L),
          escapeR: r(groups.escape.R),
          feed: r(groups.feed.all),
          groom: r(side(groups.groom)),
          dopamine: r(groups.dopamine.all),
          looming: r(side(groups.looming)),
          sugar: r(side(groups.sugar)),
          olfactory: r(side(groups.olfactory)),
        },
        stats: {
          simMs: brain.t,
          rtf: wall > 0 ? sim / wall : 0,
          spikesPerSec: sim > 0 ? (brain.spikesThisWindow * 1000) / sim : 0,
          active: brain.activeCount,
          trial: trial?.name ?? null,
        },
      },
      [activity.buffer],
    );
    brain.spikesThisWindow = 0;
    lastFrame = now;
    simAtFrame = brain.t;
    wallAtFrame = now;
  }
  setTimeout(loop, 0);
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') init(msg.buffer);
  else if (!brain) return;
  else if (msg.type === 'drive') setDrive(msg.rates);
  else if (msg.type === 'trial') startTrial(msg.name);
};
