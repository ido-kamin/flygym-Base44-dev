import { useState } from 'react';

import { ODOR_INFO } from '../lib/brainSession.js';

const STEPS = [
  ['test', 'A'],
  ['test', 'B'],
  ['train', 'A'],
  ['train', 'A'],
  ['train', 'A'],
  ['test', 'A'],
  ['test', 'B'],
];

function Bar({ label, baseline, now }) {
  const max = Math.max(baseline ?? 0, now ?? 0, 1);
  const pct = baseline ? Math.round((1 - now / baseline) * 100) : null;
  return (
    <div className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2 font-mono text-[10px] text-neutral-400">
      <span className="font-sans text-[11px] text-neutral-200">{label}</span>
      <div className="flex flex-col gap-0.5">
        <div className="h-1.5 rounded-full bg-white/15" style={{ width: `${((baseline ?? 0) / max) * 100}%` }} title="before training" />
        <div className="h-1.5 rounded-full bg-accent" style={{ width: `${((now ?? 0) / max) * 100}%` }} title="now" />
      </div>
      <span className="text-right tabular-nums">{pct === null ? '—' : pct > 0 ? `−${pct}%` : `+${-pct}%`}</span>
    </div>
  );
}

/**
 * The mushroom-body learning experiment, run live on the fly's own brain:
 * present an odour, pair it with dopamine, and watch the KC->MBON synapses
 * that carry that odour weaken while a control odour stays put.
 */
export default function LearningPanel({ results, onExperiment, ready, stats }) {
  const [auto, setAuto] = useState(false);
  const last = {};
  const base = {};
  for (const r of results) {
    if (r.action === 'test') last[r.odor] = r.drive;
    if (r.baseline) base[r.odor] = r.baseline;
  }
  const runAll = async () => {
    setAuto(true);
    try {
      for (const [action, odor] of STEPS) await onExperiment(action, odor);
    } finally {
      setAuto(false);
    }
  };
  return (
    <div data-testid="learning-panel" className="flex flex-col gap-2.5 text-[11px] text-neutral-300">
      <p className="leading-snug text-neutral-400">
        The fly learns in its <b className="text-neutral-200">mushroom body</b>: dopamine (PAM neurons) weakens the Kenyon cell → MBON synapses of
        whatever it is smelling. Each odour is a real glomerulus of receptor neurons; the memory is read out as that odour&apos;s KC→MBON drive.
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {['A', 'B'].map((o) => (
          <div key={o} className="rounded-lg bg-void px-2 py-1.5">
            <div className="font-semibold text-white">Odour {o}</div>
            <div className="text-[10px] text-neutral-500">
              glomerulus {ODOR_INFO[o].glomerulus} · {ODOR_INFO[o].ligand}
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1">
              <button type="button" disabled={!ready || auto} onClick={() => onExperiment('test', o)} data-testid={`test-${o}`} className="rounded-md px-2 py-1 text-[11px] text-neutral-200 ring-1 ring-inset ring-white/10 hover:bg-white/5 disabled:opacity-40">
                Smell
              </button>
              <button type="button" disabled={!ready || auto} onClick={() => onExperiment('train', o)} data-testid={`train-${o}`} className="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] text-white hover:bg-white/10 disabled:opacity-40">
                + Reward
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={runAll} disabled={!ready || auto} data-testid="run-learning" className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-neutral-950 hover:brightness-110 disabled:opacity-50">
        {auto ? 'Running the experiment…' : 'Run the full experiment: test A, B · train A ×3 · test A, B'}
      </button>

      <div className="flex flex-col gap-1.5 rounded-lg bg-void px-2.5 py-2">
        <div className="flex justify-between text-[10px] text-neutral-500">
          <span>KC→MBON drive: before (grey) · now (amber)</span>
          <span>change</span>
        </div>
        <Bar label="Odour A" baseline={base.A} now={last.A} />
        <Bar label="Odour B" baseline={base.B} now={last.B} />
        <div className="font-mono text-[10px] text-neutral-500">
          {stats ? `${stats.learnedSynapses.toLocaleString('en-US')} synapse updates · mean strength ${(stats.synapseStrength * 100).toFixed(1)}%` : '—'}
        </div>
      </div>

      {results.length > 0 && (
        <ol data-testid="learning-log" className="flex max-h-32 flex-col gap-0.5 overflow-y-auto font-mono text-[10px] text-neutral-400">
          {results
            .slice()
            .reverse()
            .map((r, i) => (
              <li key={`${results.length - i}`}>
                {r.action === 'train' ? 'train' : 'smell'} {r.odor}: {r.kcs} Kenyon cells fired · drive {Math.round(r.drive).toLocaleString('en-US')}
                {r.action === 'train' ? ` · ${r.changed} synapses weakened` : ''}
              </li>
            ))}
        </ol>
      )}
    </div>
  );
}
