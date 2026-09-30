import { useMemo, useState } from 'react';

import { unpackDNA, decodeBase44 } from '../lib/base44.js';
import { deployFlyCoin, enabledNetworks, flyCoinDeployment } from '../lib/baseDeploy.js';
import { compileFlyContract } from '../lib/flycode.js';

const STAGES = {
  connect: 'Connecting wallet…',
  network: 'Switching to Base…',
  sign: 'Confirm the deployment in your wallet…',
  mining: 'Waiting for the transaction to be mined…',
};

/** "Claim Fly's Deployment": deploy this fly's FlyCoin from the visitor's wallet. */
export function ClaimDeploymentModal({ dna, score, onClose }) {
  const networks = enabledNetworks();
  const [networkKey, setNetworkKey] = useState(networks[0].key);
  const [agreed, setAgreed] = useState(false);
  const [stage, setStage] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const network = networks.find((n) => n.key === networkKey);

  // freeze the DNA the modal was opened with: the live fly keeps moving
  const [frozen] = useState({ dna, score });
  const deployment = useMemo(() => flyCoinDeployment(frozen.dna, frozen.score), [frozen]);
  const source = useMemo(() => compileFlyContract(frozen.dna, unpackDNA(decodeBase44(frozen.dna))), [frozen]);

  const deploy = async () => {
    setError(null);
    setResult(null);
    try {
      const res = await deployFlyCoin(window.ethereum, deployment, network, setStage);
      setResult(res);
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setStage(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Claim Fly's Deployment">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#3b7bff]/60 bg-panel p-5 shadow-[0_0_60px_-10px_rgba(59,123,255,0.9)]">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-[#8fb2ff]">Claim Fly&apos;s Deployment</p>
            <h2 className="mt-1 font-mono text-xl font-black text-white">{deployment.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>

        <dl className="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px]">
          <div className="rounded-lg bg-black/40 px-2 py-1.5">
            <dt className="text-slate-500">symbol</dt>
            <dd className="text-white">{deployment.symbol}</dd>
          </div>
          <div className="rounded-lg bg-black/40 px-2 py-1.5">
            <dt className="text-slate-500">supply</dt>
            <dd className="text-white">{deployment.supplyDisplay}</dd>
          </div>
          <div className="rounded-lg bg-black/40 px-2 py-1.5">
            <dt className="text-slate-500">on-chain dna</dt>
            <dd className="text-fuchsia-200">{frozen.dna}</dd>
          </div>
        </dl>

        <pre className="mt-3 max-h-36 overflow-auto rounded-lg border border-white/10 bg-black/60 p-2.5 font-mono text-[10px] leading-snug text-emerald-200/90">
          {source.join('\n')}
          {'\n    // …ERC-20 (contracts/FlyCoin.sol), '}
          {deployment.compiler}
          {'\n}'}
        </pre>

        <label className="mt-3 block text-[11px] font-semibold text-slate-300">
          Network
          <select
            value={networkKey}
            onChange={(e) => setNetworkKey(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/60 px-2 py-2 font-mono text-xs text-white"
          >
            {networks.map((n) => (
              <option key={n.key} value={n.key}>
                {n.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 flex items-start gap-2 text-[11px] leading-snug text-slate-400">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
          <span>
            I understand this deploys a novelty token from <b>my own wallet</b>, pays gas myself
            {network.testnet ? ' (testnet ETH, no monetary value)' : ' in real ETH'}, and that the token has no value, no sale, and
            no affiliation with Base44, Base or Coinbase. Needs a regular wallet account; smart-contract wallets cannot deploy
            directly.
          </span>
        </label>

        <button
          type="button"
          disabled={!agreed || !!stage}
          onClick={deploy}
          data-testid="deploy-flycoin"
          className="mt-4 w-full rounded-xl border border-[#3b7bff] bg-[#0052ff]/30 px-4 py-3 text-sm font-black uppercase tracking-[0.16em] text-white shadow-[0_0_24px_-4px_rgba(0,82,255,0.9)] transition hover:bg-[#0052ff]/45 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {stage ? STAGES[stage] : `🚀 Deploy on ${network.params.chainName}`}
        </button>

        {error && <p className="mt-3 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{error}</p>}
        {result && (
          <div data-testid="deploy-result" className="mt-3 rounded-lg border border-lime-300/40 bg-lime-400/10 px-3 py-2 text-xs text-lime-50">
            <p className="font-bold">Deployed! FlyCoin {frozen.dna} lives at</p>
            <a className="break-all font-mono text-lime-200 underline" href={result.addressUrl} target="_blank" rel="noreferrer">
              {result.address}
            </a>
            <p className="mt-1">
              <a className="underline" href={result.txUrl} target="_blank" rel="noreferrer">
                View transaction
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
