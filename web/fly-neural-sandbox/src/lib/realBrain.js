// Page side of the FlyWire brain. The brain runs on the Base44 server when a
// slot is free (WebSocket /api/brain, one brain per visitor in a worker
// thread); otherwise it runs here in a Web Worker on the same code
// (brainSession.js). Either way this object feeds the brain the fly's senses
// and the player's neural controls, and turns its descending neurons back
// into motor commands.
//
// Senses -> sensory neurons (Poisson drive):
//   eyes: light + image motion -> R1-6 / R7 / R8 photoreceptors    (continuous)
//   eyes: a spider looming L/R -> LPLC2 / LC4 looming detectors   (continuous)
//   bumping a wall             -> mechanosensory neurons           (continuous)
//   eating                     -> sugar GRNs, 200 Hz for 0.4 s     (trial)
//   catching a new scent L/R   -> olfactory receptor neurons       (trial)
// Neural controls (the player, like optogenetic stimulation):
//   explore -> DNp09 walk command · steer -> DNa02 left / right · reward -> PAM dopamine
// Descending / motor neurons -> behaviour (motor()):
//   DNp09 -> forward walking · DNa02 (+DNa01) L/R -> turning · DNp01 giant fiber -> escape jump
//   brain motor neurons -> feeding · DNg11/DNg12 -> grooming

import { sensoryDrive } from './lifBrain.js';

export const CONNECTOME_URL = 'connectome/flywire783.bin.gz';
const SERVER_TIMEOUT_MS = 6000;
const RASTER_MS = 4000;
/** Descending-neuron rates (Hz) that mean "full" command. */
export const MOTOR_SCALE = { walk: 60, turn: 60, escape: 40, feed: 5, groom: 12 };

async function fetchConnectome(baseUrl, onProgress, signal) {
  const r = await fetch(`${baseUrl}${CONNECTOME_URL}`, { signal });
  if (!r.ok) throw new Error(`connectome: HTTP ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 8.5e6;
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

function brainSocketUrl() {
  const u = new URL('api/brain', document.baseURI);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.href;
}

export class RealBrain {
  /**
   * @param {{baseUrl?:string, preferServer?:boolean, onReady?:Function, onFrame?:Function, onProgress?:Function,
   *          onError?:Function, onExperiment?:Function, onTransport?:Function}} opts
   */
  constructor({ baseUrl = './', preferServer = true, onReady, onFrame, onProgress, onError, onExperiment, onTransport } = {}) {
    this.baseUrl = baseUrl;
    this.cb = { onReady, onFrame, onProgress, onError, onExperiment, onTransport };
    this.ready = false;
    this.frame = null;
    this.where = null;
    this.named = [];
    this.raster = []; // [{k, t}] spikes of the named neurons, last RASTER_MS of brain time
    this.touch = 0;
    this.smellClock = 0;
    this.lastOdor = 0;
    this.speed = 1;
    this.controls = {};
    this.turnBaseline = 0;
    this.disposed = false;
    this.abort = new AbortController();
    this.onVisibility = () => this.send({ type: 'pause', paused: document.hidden });
    document.addEventListener('visibilitychange', this.onVisibility);
    if (preferServer && typeof WebSocket !== 'undefined') this.connectServer();
    else this.startLocal('no server');
  }

  // ---- transports ----
  connectServer() {
    let settled = false;
    const fallback = (reason) => {
      if (settled || this.disposed) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      this.startLocal(reason);
    };
    const ws = new WebSocket(brainSocketUrl());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    const timer = setTimeout(() => fallback('server did not answer'), SERVER_TIMEOUT_MS);
    ws.onerror = () => fallback('server unreachable');
    ws.onclose = () => {
      clearTimeout(timer);
      if (!settled) fallback('server closed');
      else if (this.ws === ws && !this.disposed) {
        // the server brain went away mid-session: carry on in the browser
        this.ws = null;
        this.ready = false;
        this.startLocal('server disconnected');
      }
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const m = JSON.parse(e.data);
        if (m.type === 'busy') {
          clearTimeout(timer);
          fallback(`all ${m.maxSessions} server brains are busy`);
        } else if (m.type === 'error') {
          clearTimeout(timer);
          fallback(m.error);
        } else if (m.type === 'ready') {
          clearTimeout(timer);
          settled = true;
          this.pendingReady = m;
        } else this.receive(m);
        return;
      }
      const bytes = new Uint8Array(e.data);
      if (bytes[0] === 1 && this.pendingReady) {
        const n = new DataView(e.data).getUint32(4, true);
        const cluster = bytes.slice(8, 8 + n);
        const posOff = 8 + n + ((4 - (n % 4)) % 4);
        const q = new Uint16Array(e.data, posOff, n * 3);
        const { min, span } = this.pendingReady.header.positions ?? {};
        let positions = null;
        if (min) {
          positions = new Float32Array(n * 3);
          for (let i = 0; i < n * 3; i++) positions[i] = min[i % 3] + (q[i] / 65535) * span[i % 3];
        }
        const m = this.pendingReady;
        this.pendingReady = null;
        this.activity = new Uint8Array(n);
        this.becomeReady({ ...m, cluster, positions });
      } else if (bytes[0] === 2 && this.activity) {
        const k = new DataView(e.data).getUint32(4, true);
        const idx = new Uint32Array(e.data, 8, k);
        const val = new Uint8Array(e.data, 8 + k * 4, k);
        this.activity.fill(0);
        for (let j = 0; j < k; j++) this.activity[idx[j]] = val[j];
        this.freshActivity = true;
      }
    };
  }

  startLocal(reason) {
    if (this.disposed || this.worker) return;
    this.fallbackReason = reason;
    this.cb.onTransport?.({ kind: 'browser', reason });
    fetchConnectome(this.baseUrl, (p) => !this.disposed && this.cb.onProgress?.(p), this.abort.signal)
      .then((buffer) => {
        if (this.disposed) return;
        this.worker = new Worker(new URL('./connectomeWorker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'ready') this.becomeReady({ ...m, where: { ...m.where, reason } });
          else this.receive(m);
        };
        this.worker.onerror = (e) => this.cb.onError?.(e);
        this.worker.postMessage({ type: 'init', buffer }, [buffer]);
      })
      .catch((err) => {
        if (!this.disposed) this.cb.onError?.(err);
      });
  }

  becomeReady(m) {
    this.ready = true;
    this.info = m;
    this.where = m.where;
    this.named = m.header?.named ?? [];
    this.cb.onReady?.(m);
    // re-apply what the page already asked for
    if (this.speed !== 1) this.send({ type: 'speed', scale: this.speed });
    for (const [name, hz] of Object.entries(this.controls)) this.send({ type: 'control', name, hz });
    if (document.hidden) this.send({ type: 'pause', paused: true });
  }

  send(msg) {
    if (!this.ready) return;
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
    else this.worker?.postMessage(msg);
  }

  receive(m) {
    if (m.type === 'frame') {
      if (m.activity) {
        this.activity = m.activity;
        this.freshActivity = true;
      }
      // raster: spikes of the named neurons, in brain time
      const s = m.spikes ?? [];
      for (let j = 0; j < s.length; j += 2) this.raster.push({ k: s[j], t: s[j + 1] });
      const cut = m.stats.simMs - RASTER_MS;
      let drop = 0;
      while (drop < this.raster.length && this.raster[drop].t < cut) drop++;
      if (drop) this.raster.splice(0, drop);
      this.frame = m;
      this.cb.onFrame?.(m, this.freshActivity ? this.activity : null);
      this.freshActivity = false;
    } else if (m.type === 'experiment') {
      this.cb.onExperiment?.(m);
    }
  }

  // ---- inputs ----
  /**
   * Send the fly's current senses to the sensory neurons (call ~20 Hz).
   * @param {{threatL:number, threatR:number, odorL:number, odorR:number}} sensors  game.sensors
   * @param {{speed:number, turn:number}} [motion]  the fly's own motion, 0..1 and -1..1
   */
  sense(sensors, dt, motion = { speed: 0, turn: 0 }) {
    if (!this.ready) return;
    this.touch = Math.max(0, this.touch - dt / 0.15);
    // image motion on each eye: self-motion flow plus anything moving nearby
    const flow = 0.7 * motion.speed + 0.4 * Math.abs(motion.turn);
    this.send({
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
    this.send({ type: 'trial', name });
  }

  /** The proboscis touches sugar: a short sugar-GRN trial (TRIALS.sugar). */
  tasteSugar() {
    this.trial('sugar');
  }

  bump() {
    this.touch = 1;
  }

  /** Neural control: stimulate walk (DNp09), steerL / steerR (DNa02) or reward (PAM) at `hz`. */
  control(name, hz) {
    this.controls[name] = hz;
    this.send({ type: 'control', name, hz });
  }

  lesion(name, on) {
    this.send({ type: 'lesion', name, on });
  }

  /** Learning experiment: action 'test' | 'train', odor 'A' | 'B'. */
  experiment(action, odor) {
    this.send({ type: 'experiment', action, odor });
  }

  /** Brain time per wall time, so slow motion slows the brain with the world. */
  setSpeed(scale) {
    this.speed = scale;
    this.send({ type: 'speed', scale });
  }

  /**
   * Motor command from the descending neurons.
   * escapeSide: -1 when the left giant fiber leads (threat on the left).
   * @returns {{turn:number, walk:number, escape:boolean, escapeSide:number, feed:boolean, groom:boolean, rates:object} | null}
   */
  motor(dt) {
    const f = this.frame;
    if (!f) return null;
    const G = f.groups;
    const diff = G.steerR + 0.5 * G.steer2R - (G.steerL + 0.5 * G.steer2L);
    // remove a slow resting asymmetry, but only while nothing is steering on purpose
    const steering = (this.controls.steerL ?? 0) > 0 || (this.controls.steerR ?? 0) > 0 || G.escapeL + G.escapeR > 20;
    if (!steering) this.turnBaseline += (diff - this.turnBaseline) * Math.min(1, dt / 5);
    const turn = Math.max(-1, Math.min(1, (diff - this.turnBaseline) / MOTOR_SCALE.turn));
    return {
      turn,
      walk: Math.min(1, G.walk / MOTOR_SCALE.walk),
      escape: Math.max(G.escapeL, G.escapeR) > MOTOR_SCALE.escape,
      escapeSide: G.escapeL > G.escapeR ? -1 : 1,
      feed: G.feed > MOTOR_SCALE.feed,
      groom: G.groom > MOTOR_SCALE.groom,
      rates: G,
    };
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    document.removeEventListener('visibilitychange', this.onVisibility);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.worker?.terminate();
  }
}
