// Web Worker fallback: runs the FlyWire brain (brainSession.js) in the visitor's
// browser when the Base44 server has no free brain slot (or can't be reached).
//
// in:  {type:'init', buffer}   gunzipped connectome file (transferred)
//      anything else           forwarded to BrainSession.handle
// out: {type:'ready', n, nnz, cluster, positions, header, where}
//      BrainSession frames / experiment results

import { parseConnectome } from './lifBrain.js';
import { BrainSession } from './brainSession.js';

let session = null;

function init(buffer) {
  const conn = parseConnectome(buffer);
  const cluster = conn.cluster.slice();
  const positions = conn.positions ? conn.positions.slice() : null;
  postMessage(
    {
      type: 'ready',
      n: conn.n,
      nnz: conn.nnz,
      cluster,
      positions,
      header: { source: conn.header.source, license: conn.header.license, named: conn.header.named, signs: conn.header.signs },
      where: { kind: 'browser', host: 'this browser', cpus: navigator.hardwareConcurrency ?? null },
    },
    [cluster.buffer, ...(positions ? [positions.buffer] : [])],
  );
  session = new BrainSession(conn, {
    post: (msg) => postMessage(msg, msg.activity ? [msg.activity.buffer] : []),
  });
  session.start();
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') init(msg.buffer);
  else session?.handle(msg);
};
