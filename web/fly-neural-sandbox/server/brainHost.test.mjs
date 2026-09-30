import net from 'node:net';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { createFlyServer } from './app.mjs';
import { createBrainHost } from './brainHost.mjs';

const connectomePath = fileURLToPath(new URL('../public/connectome/flywire783.bin.gz', import.meta.url));

describe('FlyWire brain on the server', () => {
  let host;
  let server;
  let port;
  beforeAll(async () => {
    host = createBrainHost({ connectomePath, maxSessions: 1 });
    ({ server } = createFlyServer({ distDir: '/nonexistent', brainHost: host, env: {} }));
    host.attach(server);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterAll(() => {
    host.close();
    server.close();
  });

  const open = () =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/brain`);
      const inbox = { json: [], binary: [] };
      ws.on('message', (data, isBinary) => (isBinary ? inbox.binary : inbox.json).push(isBinary ? data : JSON.parse(String(data))));
      ws.on('open', () => resolve({ ws, inbox }));
      ws.on('error', reject);
    });
  const until = async (fn, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('timeout');
  };

  it('streams one brain per visitor: ready, regions + positions, frames; controls move its neurons', async () => {
    const { ws, inbox } = await open();
    const ready = await until(() => inbox.json.find((m) => m.type === 'ready'));
    expect(ready.n).toBe(138639);
    expect(ready.where).toMatchObject({ kind: 'server', maxSessions: 1 });
    expect(ready.header.named.find((n) => n.type === 'DNp01')?.root).toMatch(/^7205/);
    const init = await until(() => inbox.binary.find((b) => b[0] === 1));
    expect(init.length).toBeGreaterThan(138639 * 7);
    ws.send(JSON.stringify({ type: 'control', name: 'walk', hz: 50 }));
    const walking = await until(() => inbox.json.filter((m) => m.type === 'frame').find((m) => m.groups.walk > 20));
    expect(walking.controls.walk).toBe(50);
    expect(await until(() => inbox.binary.find((b) => b[0] === 3))).toBeTruthy(); // per-neuron activity, 4 bits

    // the only slot is taken: a second visitor is told the server is busy
    const second = await open();
    const busy = await until(() => second.inbox.json.find((m) => m.type === 'busy'));
    expect(busy.sessions).toBe(1);
    second.ws.close();
    ws.close();
  }, 60000);

  it('runs the self-test on this server: every published circuit check passes', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/brain/selftest`);
    const report = await r.json();
    expect(report.where.kind).toBe('server');
    for (const c of report.checks) expect(c.pass, `${c.name}: ${c.measured}`).toBe(true);
    expect(report.checks.length).toBeGreaterThanOrEqual(6);
  }, 120000);

  it('survives malformed upgrade targets and refuses brains to other sites', async () => {
    // a raw upgrade to `//` used to throw in the upgrade listener and kill the server
    await new Promise((resolve) => {
      const sock = net.connect(port, '127.0.0.1', () =>
        sock.write('GET // HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'),
      );
      sock.on('close', resolve);
      sock.on('error', resolve);
    });
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    // a page on another site can't open (and hold) one of our brains
    const status = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/brain`, { origin: 'https://evil.example' });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('open', () => {
        ws.close();
        resolve('open');
      });
      ws.on('error', () => resolve('error'));
    });
    expect(status).toBe(403);
  }, 30000);
});

describe('server brain limits', () => {
  it('caps brains per visitor and drops message floods', async () => {
    const host = createBrainHost({ connectomePath, maxSessions: 3, perVisitor: 1 });
    const { server } = createFlyServer({ distDir: '/nonexistent', brainHost: host, env: {} });
    host.attach(server);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    const connect = (headers) =>
      new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/brain`, { headers });
        const json = [];
        ws.on('message', (d, bin) => !bin && json.push(JSON.parse(String(d))));
        ws.on('open', () => resolve({ ws, json }));
      });
    const wait = async (fn) => {
      for (let i = 0; i < 400 && !fn(); i++) await new Promise((r) => setTimeout(r, 50));
      return fn();
    };
    try {
      const a = await connect({ 'x-forwarded-for': '203.0.113.7', origin: 'https://3000-app.imported.base44-preview.app' });
      expect(await wait(() => a.json.find((m) => m.type === 'ready'))).toBeTruthy();
      const b = await connect({ 'x-forwarded-for': '203.0.113.7' });
      const busy = await wait(() => b.json.find((m) => m.type === 'busy'));
      expect(busy).toMatchObject({ perVisitor: true });
      // a flood of messages is dropped past the per-second budget; the brain keeps streaming
      for (let i = 0; i < 2000; i++) a.ws.send(JSON.stringify({ type: 'control', name: 'walk', hz: i % 2 ? 0 : 60 }));
      const n = a.json.length;
      expect(await wait(() => a.json.length > n + 10)).toBe(true);
      a.ws.close();
      b.ws.close();
    } finally {
      host.close();
      server.close();
    }
  }, 60000);
});
