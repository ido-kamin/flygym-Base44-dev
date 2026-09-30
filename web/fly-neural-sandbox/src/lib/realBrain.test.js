import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RealBrain } from './realBrain.js';

// A page that can't get a server brain falls back to one brain in the browser, never two.
describe('RealBrain transport fallback', () => {
  let sockets;
  let workers;
  let fetches;
  const saved = {};
  beforeEach(() => {
    sockets = [];
    workers = [];
    fetches = 0;
    for (const k of ['WebSocket', 'Worker', 'fetch', 'document', 'location']) saved[k] = globalThis[k];
    globalThis.document = { hidden: false, baseURI: 'http://localhost/', addEventListener() {}, removeEventListener() {} };
    globalThis.location = { protocol: 'http:', host: 'localhost', href: 'http://localhost/' };
    globalThis.WebSocket = class {
      constructor() {
        this.readyState = 0;
        sockets.push(this);
      }
      send() {}
      close() {
        this.readyState = 3;
        queueMicrotask(() => this.onclose?.());
      }
    };
    globalThis.Worker = class {
      constructor() {
        this.terminated = false;
        workers.push(this);
      }
      postMessage() {}
      terminate() {
        this.terminated = true;
      }
    };
    globalThis.fetch = async () => {
      fetches++;
      const bytes = new Uint8Array([1, 2, 3, 4]);
      return {
        ok: true,
        headers: { get: () => '4' },
        body: new ReadableStream({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
      };
    };
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) globalThis[k] = v;
  });

  it.each([
    ['busy', (ws) => ws.onmessage({ data: JSON.stringify({ type: 'busy', maxSessions: 3 }) })],
    ['error', (ws) => ws.onmessage({ data: JSON.stringify({ type: 'error', error: 'connectome_unavailable' }) })],
    ['unreachable', (ws) => (ws.onerror(), ws.onclose())],
  ])('%s: one local brain, terminated on dispose', async (_name, fail) => {
    const transports = [];
    const rb = new RealBrain({ onTransport: (t) => transports.push(t) });
    expect(sockets).toHaveLength(1);
    fail(sockets[0]);
    await vi.waitFor(() => expect(workers.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50)); // let any stray close event land
    expect(fetches).toBe(1);
    expect(workers).toHaveLength(1);
    expect(transports).toHaveLength(1);
    rb.dispose();
    expect(workers[0].terminated).toBe(true);
  });
});
