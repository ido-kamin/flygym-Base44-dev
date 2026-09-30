import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { runAlone } from '../../scripts/autonomy.mjs';
import { parseConnectome } from './lifBrain.js';

const raw = gunzipSync(readFileSync(new URL('../../public/connectome/flywire783.bin.gz', import.meta.url)));
const conn = parseConnectome(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

describe('the fly alone (neurons only, no player input)', () => {
  it('walks, turns both ways, and escapes a spider, all from its live brain', () => {
    const log = runAlone(conn, { seconds: 16, seed: 3 });
    expect(log.distance * 0.044).toBeGreaterThan(30); // mm walked, driven by hunger onto DNp09
    expect(log.left).toBeGreaterThan(0.3); // spontaneous DNa02 fluctuations turn it both ways
    expect(log.right).toBeGreaterThan(0.3);
    expect(log.neuronsFired / log.n).toBeGreaterThan(0.9); // the whole brain is live
    expect(log.escapes).toBeGreaterThan(log.escapesBeforeSpider); // the spider made it take off
  }, 180000);
});
