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
import { startSocketHeartbeat } from './socketHeartbeat.mjs';

const IDLE_MS = 120_000; // a brain with no message from its page for this long is stopped
const MAX_BUFFERED = 2_000_000; // skip activity frames for slow connections
const PER_VISITOR = 2; // brains one visitor (address) may hold at once
const MSG_PER_S = 200; // page -> brain messages a socket may send per second (the page sends ~25)

/** The visitor's address: the rightmost X-Forwarded-For hop (added by the proxy), else the socket peer. */
function visitorOf(req) {
  const hops = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (hops.length) return hops[hops.length - 1];
  const peer = req.socket?.remoteAddress ?? '';
  // behind a proxy that adds no X-Forwarded-For every visitor shares its address: don't cap that
  return /^(::1|127\.|::ffff:127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.|f[cd])/i.test(peer) ? null : peer;
}

// Base44's own hosting domains: the preview proxy may not forward the page's Host
const BASE44_HOSTS = /(^|\.)base44(-preview)?\.app$/;

/**
 * Only pages served from this host, Base44 hosting or PUBLIC_URL may open a brain: blocks other
 * sites from using visitors' browsers to hold our brains. Clients that send no Origin (not browsers) pass.
 */
function originAllowed(req, publicUrl) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let host;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const allowed = [req.headers.host, ...String(req.headers['x-forwarded-host'] ?? '').split(',')]
    .map((h) => String(h ?? '').trim().toLowerCase())
    .filter(Boolean);
  if (publicUrl) {
    try {
      allowed.push(new URL(publicUrl).host.toLowerCase());
    } catch {
      /* ignore a malformed PUBLIC_URL */
    }
  }
  return allowed.includes(host) || BASE44_HOSTS.test(host.replace(/:\d+$/, ''));
}

function toShared(typed) {
  const out = new typed.constructor(new SharedArrayBuffer(typed.byteLength));
  out.set(typed);
  return out;
}

/**
 * @param {{connectomePath:string, maxSessions?:number, perVisitor?:number, publicUrl?:string, now?:()=>number}} opts
 */
export function createBrainHost({
  connectomePath,
  maxSessions = Math.max(1, os.cpus().length - 1),
  perVisitor = PER_VISITOR,
  publicUrl = process.env.PUBLIC_URL,
  now = () => Date.now(),
}) {
  let loaded = null;
  const sessions = new Set();
  const startedAt = now();
  let totalSessions = 0;
  let selfTest = null; // {at, report} | {pending: Promise}
  const rejected = new Set(); // origins already logged

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

  function connect(ws, req) {
    const visitor = req ? visitorOf(req) : null;
    const mine = visitor ? [...sessions].filter((s) => s.visitor === visitor).length : 0;
    if (sessions.size >= maxSessions || mine >= perVisitor) {
      ws.send(JSON.stringify({ type: 'busy', ...where(), perVisitor: mine >= perVisitor }));
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
    const session = { ws, worker: w, visitor, lastSeen: now(), windowStart: now(), count: 0 };
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
      const t = now();
      session.lastSeen = t;
      if (t - session.windowStart >= 1000) {
        session.windowStart = t;
        session.count = 0;
      }
      if (++session.count > MSG_PER_S) return; // flood: drop
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
  const stopHeartbeat = startSocketHeartbeat(wss);
  wss.on('connection', connect);
  const idle = setInterval(() => {
    for (const s of sessions) if (now() - s.lastSeen > IDLE_MS) s.ws.close(1000, 'idle');
  }, 10_000);
  idle.unref?.();

  return {
    /** Hook the WebSocket endpoint into an http.Server. */
    attach(server) {
      server.on('upgrade', (req, socket, head) => {
        let pathname;
        try {
          ({ pathname } = new URL(req.url, 'http://local'));
        } catch {
          return socket.destroy();
        }
        if (pathname !== '/api/brain') return socket.destroy();
        if (!originAllowed(req, publicUrl)) {
          if (!rejected.has(req.headers.origin) && rejected.size < 100) {
            rejected.add(req.headers.origin);
            console.warn(`brain: refused WebSocket from origin ${req.headers.origin} (host ${req.headers.host})`);
          }
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
          return;
        }
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
      stopHeartbeat();
      clearInterval(idle);
      for (const s of sessions) s.ws.close(1001, 'shutting down');
      wss.close();
    },
  };
}
