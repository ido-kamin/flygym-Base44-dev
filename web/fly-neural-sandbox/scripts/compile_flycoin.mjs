// Compile contracts/FlyCoin.sol with solc-js and write the bytecode + ABI the
// app deploys (src/lib/flycoin.artifact.json). Run after editing the contract:
//   node scripts/compile_flycoin.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const solc = require('solc');

const source = readFileSync(new URL('../contracts/FlyCoin.sol', import.meta.url), 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'FlyCoin.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun',
    outputSelection: { '*': { FlyCoin: ['abi', 'evm.bytecode.object', 'evm.methodIdentifiers'] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
const c = out.contracts['FlyCoin.sol'].FlyCoin;
const artifact = {
  contract: 'FlyCoin',
  compiler: `solc ${solc.version()}`,
  optimizer: input.settings.optimizer,
  evmVersion: input.settings.evmVersion,
  abi: c.abi,
  methodIdentifiers: c.evm.methodIdentifiers,
  bytecode: `0x${c.evm.bytecode.object}`,
};
writeFileSync(new URL('../src/lib/flycoin.artifact.json', import.meta.url), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`FlyCoin compiled with ${artifact.compiler}: ${(c.evm.bytecode.object.length / 2).toLocaleString()} bytes`);
