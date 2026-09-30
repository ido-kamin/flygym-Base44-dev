// Protocol-level keepalive: browsers answer ping frames even when the page is paused.
export function startSocketHeartbeat(wss, intervalMs = 30_000) {
  const alive = new WeakSet();
  const connected = (ws) => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
  };
  wss.on('connection', connected);
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if (!alive.has(ws)) {
        ws.terminate(); // also releases the brain worker through its close listener
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, intervalMs);
  timer.unref?.();
  const stop = () => {
    clearInterval(timer);
    wss.off('connection', connected);
  };
  wss.once('close', stop);
  return stop;
}
