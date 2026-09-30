// Entry point: `node server/index.mjs` (PORT defaults to 3000).
import { fileURLToPath } from 'node:url';

import { createFlyServer } from './app.mjs';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.PORT || 3000);
const { server } = createFlyServer({ distDir, publicDir });
server.listen(port, '0.0.0.0', () => {
  console.log(
    `Fly Neural Sandbox on :${port} · real Base44 apps ${process.env.BASE44_API_TOKEN ? 'ENABLED' : 'off (no BASE44_API_TOKEN)'}`,
  );
});
