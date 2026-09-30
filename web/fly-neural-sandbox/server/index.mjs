// Entry point: `node server/index.mjs` (PORT defaults to 3000).
import { fileURLToPath } from 'node:url';

import { createFlyServer } from './app.mjs';
import { createBrainHost } from './brainHost.mjs';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.PORT || 3000);

function sessionsFromEnv(value) {
  if (value === undefined || value === '') return undefined;
  const n = Math.floor(Number(value));
  if (Number.isFinite(n) && n >= 0) return n;
  console.warn(`FLY_BRAIN_SESSIONS=${JSON.stringify(value)} is not a number; using the default`);
  return undefined;
}
// one FlyWire brain per visitor, in worker threads on this container
const brainHost = createBrainHost({
  connectomePath: fileURLToPath(new URL('../public/connectome/flywire783.bin.gz', import.meta.url)),
  maxSessions: sessionsFromEnv(process.env.FLY_BRAIN_SESSIONS),
});
const { server } = createFlyServer({ distDir, publicDir, brainHost });
brainHost.attach(server);
server.listen(port, '0.0.0.0', () => {
  console.log(
    `Fly Neural Sandbox on :${port} · brains: ${brainHost.info().maxSessions} on ${brainHost.info().cpus} CPUs · real Base44 apps ${process.env.BASE44_API_TOKEN ? 'ENABLED' : 'off (no BASE44_API_TOKEN)'}`,
  );
});
