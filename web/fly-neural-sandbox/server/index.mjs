// Entry point: `node server/index.mjs` (PORT defaults to 3000).
import { fileURLToPath } from 'node:url';

import { createFlyServer } from './app.mjs';
import { createBrainHost } from './brainHost.mjs';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.PORT || 3000);
// one FlyWire brain per visitor, in worker threads on this container
const brainHost = createBrainHost({
  connectomePath: fileURLToPath(new URL('../public/connectome/flywire783.bin.gz', import.meta.url)),
  maxSessions: process.env.FLY_BRAIN_SESSIONS ? Number(process.env.FLY_BRAIN_SESSIONS) : undefined,
});
const { server } = createFlyServer({ distDir, publicDir, brainHost });
brainHost.attach(server);
server.listen(port, '0.0.0.0', () => {
  console.log(
    `Fly Neural Sandbox on :${port} · brains: ${brainHost.info().maxSessions} on ${brainHost.info().cpus} CPUs · real Base44 apps ${process.env.BASE44_API_TOKEN ? 'ENABLED' : 'off (no BASE44_API_TOKEN)'}`,
  );
});
