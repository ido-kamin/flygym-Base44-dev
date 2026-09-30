// Node worker thread: one visitor's FlyWire brain (BrainSession), or the
// self-test, running on the Base44 server. The connectome arrays are shared
// (SharedArrayBuffer) between all workers; each brain has its own state and
// its own copy of the weights (learning changes them).

import { parentPort, workerData } from 'node:worker_threads';

import { BrainSession } from '../src/lib/brainSession.js';
import { runSelfTest } from '../src/lib/selfTest.js';

const { shared, header, mode } = workerData;
const conn = {
  header,
  n: header.n,
  nnz: shared.post.length,
  offsets: shared.offsets,
  post: shared.post,
  weight: shared.weight,
  cluster: shared.cluster,
  side: shared.side,
  positions: null,
};

if (mode === 'selftest') {
  const report = runSelfTest(conn, { wmv: shared.wmv });
  parentPort.postMessage({ type: 'selftest', report });
} else {
  let frames = 0;
  const session = new BrainSession(conn, {
    wmv: shared.wmv,
    post: (msg) => {
      if (msg.type !== 'frame') return parentPort.postMessage(msg);
      // per-neuron activity, 4 bits per neuron, 5 times a second (every 4th frame)
      const { activity, ...rest } = msg;
      if (frames++ % 4 === 0) {
        const packed = new Uint8Array((activity.length + 1) >> 1);
        for (let i = 0, j = 0; i < activity.length; i += 2, j++) packed[j] = (activity[i] >> 4) | (activity[i + 1] & 0xf0);
        rest.packed = packed;
        parentPort.postMessage(rest, [packed.buffer]);
      } else {
        parentPort.postMessage(rest);
      }
    },
  });
  parentPort.on('message', (msg) => session.handle(msg));
  session.start();
}
