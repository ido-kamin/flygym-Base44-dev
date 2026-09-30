import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startSocketHeartbeat } from './socketHeartbeat.mjs';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const wss = new EventEmitter();
  wss.clients = new Set();
  const stop = startSocketHeartbeat(wss);
  const ws = new EventEmitter();
  Object.assign(ws, { OPEN: 1, readyState: 1, ping: vi.fn(), terminate: vi.fn() });
  wss.clients.add(ws);
  wss.emit('connection', ws);
  return { wss, ws, stop };
}

describe('brain socket heartbeat', () => {
  it('keeps responsive connections alive without application messages', () => {
    const { ws, stop } = setup();
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(30_000);
      ws.emit('pong');
    }
    expect(ws.ping).toHaveBeenCalledTimes(4);
    expect(ws.terminate).not.toHaveBeenCalled();
    stop();
  });

  it('terminates a connection that misses its pong', () => {
    const { ws, stop } = setup();
    vi.advanceTimersByTime(60_000);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    stop();
  });

  it('skips closing sockets and stops when the host closes', () => {
    const { wss, ws } = setup();
    ws.readyState = 2;
    vi.advanceTimersByTime(30_000);
    expect(ws.ping).not.toHaveBeenCalled();
    expect(ws.terminate).not.toHaveBeenCalled();
    wss.emit('close');
    ws.readyState = 1;
    vi.advanceTimersByTime(60_000);
    expect(ws.ping).not.toHaveBeenCalled();
    expect(wss.listenerCount('connection')).toBe(0);
  });
});
