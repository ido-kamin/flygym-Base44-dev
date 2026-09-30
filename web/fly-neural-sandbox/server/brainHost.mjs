// The FlyWire brain on the Base44 server: each visitor gets their own brain,
// simulated in a Node worker thread on this container, and streamed to the
// page over a WebSocket at /api/brain. The page sends the fly's senses and the
// player's neural controls; the server sends back spikes, rates and the
// descending-neuron readouts that move the fly.
//
// ws  /api/brain            one brain per connection (or {type:'busy'} when all slots are taken)
// GET /api/brain/selftest   run the published circuits on fresh brains here and report what happened
//
// Server -> page messages: JSON text {type:'ready'|'frame'|'experiment'|'busy'|'error'}; binary
// messages start with a tag byte: 1 = neuron regions + positions (once), 3 = activity (4 bits per neuron).

import { readFileSync } from 'node:fs';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';

import { WebSocketServer } from 'ws';

import { parseConnectome } from '../src/lib/lifBrain.js';

const IDLE_MS = 120_000; // a brain with no message from its page for this long is stopped
const MAX_BUFFERED = 2_000_000; // skip activity frames for slow connections

function toShared(typed) {
  const out = new typed.constructor(new SharedArrayBuffer(typed.byteLength));
  out.set(typed);
  return out;
}

/**
 * @param {{connectomePath:string, maxSessions?:number, now?:()=>number}} opts
 */
export function createBrainHost({ connectomePath, maxSessions = Math.max(1, os.cpus().length - 1), now = () => Date.now() }) {
  let loaded = null;
  const sessions = new Set();
  const startedAt = now();
  let totalSessions = 0;
  let selfTest = null; // {at, report} | {pending: Promise}

  /** Parse the connectome once, into memory shared by every brain worker. */
  function load() {
    if (loaded) return loaded;
    const t0 = now();
    const raw = gunzipSync(readFileSync(connectomePath));
    const conn = parseConnectome(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const wmv = new Float32Array(conn.weight.length);
    for (let i = 0; i < wmv.length; i++) wmv[i] = conn.weight[i] * conn.header.params.wSyn;
    // regions + quantized positions, sent once to each page for the 3D brain
    const n = conn.n;
    const init = new Uint8Array(4 + 4 + n + ((4 - (n % 4)) % 4) + n * 6);
    const dv = new DataView(init.buffer);
    init[0] = 1;
    dv.setUint32(4, n, true);
    init.set(conn.cluster, 8);
    const posOff = 8 + n + ((4 - (n % 4)) % 4);
    if (conn.positions) {
      const { min, span } = conn.header.positions;
      const q = new Uint16Array(init.buffer, posOff, n * 3);
      for (let i = 0; i < n * 3; i++) q[i] = Math.round(((conn.positions[i] - min[i % 3]) / span[i % 3]) * 65535);
    }
    loaded = {
      header: conn.header,
      shared: {
        offsets: toShared(conn.offsets),
        post: toShared(conn.post),
        weight: toShared(conn.weight),
        cluster: toShared(conn.cluster),
        side: toShared(conn.side),
        wmv: toShared(wmv),
      },
      init,
      nnz: conn.nnz,
      loadMs: now() - t0,
    };
    return loaded;
  }

  function where() {
    return {
      kind: 'server',
      host: os.hostname(),
      platform: `${os.type()} ${os.arch()}`,
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model?.trim() ?? '',
      memoryGb: Math.round(os.totalmem() / 1e9),
      node: process.version,
      uptimeS: Math.round((now() - startedAt) / 1000),
      sessions: sessions.size,
      maxSessions,
      totalSessions,
    };
  }

  function worker(mode) {
    const { shared, header } = load();
    return new Worker(new URL('./brainWorker.mjs', import.meta.url), { workerData: { shared, header, mode } });
  }

  function connect(ws) {
    if (sessions.size >= maxSessions) {
      ws.send(JSON.stringify({ type: 'busy', ...where() }));
      ws.close(1013, 'busy');
      return;
    }
    let data;
    try {
      data = load();
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', error: 'connectome_unavailable', detail: String(err.message ?? err) }));
      ws.close(1011, 'unavailable');
      return;
    }
    const w = worker('session');
    const session = { ws, worker: w, lastSeen: now() };
    sessions.add(session);
    totalSessions++;
    const { header } = data;
    ws.send(
      JSON.stringify({
        type: 'ready',
        n: header.n,
        nnz: data.nnz,
        header: { source: header.source, license: header.license, named: header.named, signs: header.signs, positions: header.positions },
        where: where(),
      }),
    );
    ws.send(data.init);
    w.on('message', (msg) => {
      if (ws.readyState !== ws.OPEN) return;
      if (msg.type === 'frame' && msg.packed) {
        const packed = msg.packed;
        delete msg.packed;
        if (ws.bufferedAmount < MAX_BUFFERED) {
          const buf = new Uint8Array(8 + packed.length);
          buf[0] = 3;
          new DataView(buf.buffer).setUint32(4, packed.length * 2, true);
          buf.set(packed, 8);
          ws.send(buf); // mostly zeros: permessage-deflate shrinks it a lot
        }
      }
      if (msg.type === 'frame') msg.where = { sessions: sessions.size, load: os.loadavg()[0] };
      ws.send(JSON.stringify(msg));
    });
    w.on('error', (err) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', error: 'brain_crashed', detail: String(err.message ?? err) }));
      ws.close(1011, 'brain crashed');
    });
    ws.on('message', (raw, isBinary) => {
      if (isBinary || raw.length > 4096) return;
      session.lastSeen = now();
      try {
        const msg = JSON.parse(String(raw));
        if (msg && typeof msg.type === 'string') w.postMessage(msg);
      } catch {
        /* ignore junk */
      }
    });
    const end = () => {
      if (!sessions.delete(session)) return;
      w.terminate();
    };
    ws.on('close', end);
    ws.on('error', end);
  }

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: { threshold: 2048, zlibDeflateOptions: { level: 1 }, serverNoContextTakeover: true, clientNoContextTakeover: true },
  });
  wss.on('connection', connect);
  const idle = setInterval(() => {
    for (const s of sessions) if (now() - s.lastSeen > IDLE_MS) s.ws.close(1000, 'idle');
  }, 10_000);
  idle.unref?.();

  return {
    /** Hook the WebSocket endpoint into an http.Server. */
    attach(server) {
      server.on('upgrade', (req, socket, head) => {
        const { pathname } = new URL(req.url, 'http://local');
        if (pathname !== '/api/brain') return socket.destroy();
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      });
    },
    info: where,
    /** Run the self-test in a worker (one at a time, cached for a minute). */
    async selfTest() {
      if (selfTest?.report && now() - selfTest.at < 60_000) return { ...selfTest.report, cached: true };
      if (selfTest?.pending) return selfTest.pending;
      const pending = new Promise((resolve, reject) => {
        const w = worker('selftest');
        w.once('message', (m) => {
          w.terminate();
          resolve(m.report);
        });
        w.once('error', reject);
      }).then((report) => {
        const full = { ...report, where: where(), ranAt: new Date(now()).toISOString() };
        selfTest = { at: now(), report: full };
        return full;
      });
      selfTest = { pending };
      try {
        return await pending;
      } catch (err) {
        selfTest = null;
        throw err;
      }
    },
    close() {
      clearInterval(idle);
      for (const s of sessions) s.ws.close(1001, 'shutting down');
      wss.close();
    },
  };
}
