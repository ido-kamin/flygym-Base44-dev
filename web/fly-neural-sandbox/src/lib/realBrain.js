// Main-thread side of the real FlyWire brain: downloads the packed connectome,
// starts the LIF worker, feeds it the fly's senses and turns its descending
// neurons back into motor commands for the game.
//
// Senses -> sensory neurons (Poisson drive):
//   eyes: light + image motion -> R1-6 / R7 / R8 photoreceptors    (continuous)
//   eyes: a spider looming L/R -> LPLC2 / LC4 looming detectors   (continuous)
//   bumping a wall             -> mechanosensory neurons           (continuous)
//   eating                     -> sugar GRNs, 200 Hz for 1 s       (trial)
//   catching a new scent L/R   -> olfactory receptor neurons       (trial)
// Descending / motor neurons -> behaviour:
//   DNa02 (+DNa01) L/R -> steering  (high-passed, so tonic asymmetries don't make it circle)
//   DNp01 giant fiber  -> escape burst
//   brain motor neurons-> feeding (proboscis extension): the fly stops to eat
//   DNg11/DNg12 groom  -> grooming pause

import { sensoryDrive } from './lifBrain.js';

export const CONNECTOME_URL = 'connectome/flywire783.bin.gz';

async function fetchConnectome(baseUrl, onProgress) {
  const r = await fetch(`${baseUrl}${CONNECTOME_URL}`);
  if (!r.ok) throw new Error(`connectome: HTTP ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 7.7e6;
  // count compressed bytes as they arrive, then inflate
  let got = 0;
  const counted = r.body.pipeThrough(
    new TransformStream({
      transform(chunk, ctl) {
        got += chunk.byteLength;
        onProgress?.(Math.min(0.99, got / total));
        ctl.enqueue(chunk);
      },
    }),
  );
  // a server may already have decoded it (Content-Encoding: gzip); detect by the gzip magic
  const reader = counted.getReader();
  const first = await reader.read();
  const head = first.value ?? new Uint8Array();
  const isGzip = head[0] === 0x1f && head[1] === 0x8b;
  const rest = new ReadableStream({
    start(ctl) {
      if (head.length) ctl.enqueue(head);
    },
    async pull(ctl) {
      const { value, done } = await reader.read();
      if (done) ctl.close();
      else ctl.enqueue(value);
    },
  });
  const stream = isGzip ? rest.pipeThrough(new DecompressionStream('gzip')) : rest;
  return new Response(stream).arrayBuffer();
}

export class RealBrain {
  constructor({ baseUrl = './', onReady, onFrame, onProgress, onError } = {}) {
    this.ready = false;
    this.frame = null;
    this.steerBaseline = 0;
    this.touch = 0;
    this.smellClock = 0;
    this.lastOdor = 0;
    this.worker = null;
    this.disposed = false;
    fetchConnectome(baseUrl, onProgress)
      .then((buffer) => {
        if (this.disposed) return;
        this.worker = new Worker(new URL('./connectomeWorker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'ready') {
            this.ready = true;
            this.info = m;
            onReady?.(m);
          } else if (m.type === 'frame') {
            this.frame = m;
            onFrame?.(m);
          }
        };
        this.worker.onerror = (e) => onError?.(e);
        this.worker.postMessage({ type: 'init', buffer }, [buffer]);
      })
      .catch((err) => onError?.(err));
  }

  /**
   * Send the fly's current senses to the sensory neurons (call ~20 Hz).
   * @param {{threatL:number, threatR:number, odorL:number, odorR:number}} sensors  game.sensors
   * @param {{speed:number, turn:number}} [motion]  the fly's own motion, 0..1 and -1..1
   */
  sense(sensors, dt, motion = { speed: 0, turn: 0 }) {
    if (!this.worker || !this.ready) return;
    this.touch = Math.max(0, this.touch - dt / 0.15);
    // image motion on each eye: self-motion flow plus anything moving nearby
    const flow = 0.7 * motion.speed + 0.4 * Math.abs(motion.turn);
    this.worker.postMessage({
      type: 'drive',
      rates: sensoryDrive({
        visionL: flow + 0.3 * sensors.threatL,
        visionR: flow + 0.3 * sensors.threatR,
        loomL: sensors.threatL / 1.2,
        loomR: sensors.threatR / 1.2,
        touch: this.touch > 0 ? 1 : 0,
      }),
    });
    // a sniff trial when the scent gets clearly stronger, at most every 6 s
    this.smellClock = Math.max(0, this.smellClock - dt);
    const odor = sensors.odorL + sensors.odorR;
    if (this.smellClock === 0 && odor > 0.35 && odor > this.lastOdor * 1.6 + 0.05) {
      this.smellClock = 6;
      this.trial(sensors.odorL >= sensors.odorR ? 'smellL' : 'smellR');
    }
    this.lastOdor += (odor - this.lastOdor) * Math.min(1, dt / 1.5);
  }

  trial(name) {
    if (this.worker && this.ready) this.worker.postMessage({ type: 'trial', name });
  }

  /** The proboscis touches sugar: a 1 s sugar-GRN trial. */
  tasteSugar() {
    this.trial('sugar');
  }

  bump() {
    this.touch = 1;
  }

  /**
   * Motor command from the descending neurons, for the game to blend in.
   * escapeSide: -1 when the left giant fiber leads (threat on the left).
   * @returns {{turn:number, escape:boolean, escapeSide:number, feed:boolean, groom:boolean, walk:number} | null}
   */
  motor(dt) {
    const f = this.frame;
    if (!f) return null;
    const G = f.groups;
    const diff = G.steerR + 0.5 * G.steer2R - (G.steerL + 0.5 * G.steer2L);
    // high-pass: subtract a slow running mean (tau 3 s) of the steering asymmetry
    this.steerBaseline += (diff - this.steerBaseline) * Math.min(1, dt / 3);
    const turn = Math.max(-1, Math.min(1, (diff - this.steerBaseline) / 60));
    return {
      turn,
      escape: Math.max(G.escapeL, G.escapeR) > 40,
      escapeSide: G.escapeL > G.escapeR ? -1 : 1,
      feed: G.feed > 5,
      groom: G.groom > 12,
      walk: G.walk,
    };
  }

  dispose() {
    this.disposed = true;
    this.worker?.terminate();
  }
}
