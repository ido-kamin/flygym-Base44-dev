import { useState } from 'react';

import { CLUSTERS } from '../lib/connectome.js';

const CLASS_LABEL = {
  sensory: { text: 'Sensory', dot: 'bg-sky-400' },
  intrinsic: { text: 'Central', dot: 'bg-violet-400' },
  motor: { text: 'Motor', dot: 'bg-accent' },
};

const TRIAL_TEXT = {
  testA: 'Learning test · smelling odour A',
  testB: 'Learning test · smelling odour B',
  trainA: 'Training · odour A + dopamine',
  trainB: 'Training · odour B + dopamine',
  sugar: 'Tasting sugar · sugar GRNs at 200 Hz',
  smellL: 'Smelling food · left antenna ORNs',
  smellR: 'Smelling food · right antenna ORNs',
};

const fmt = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${Math.round(x / 1e3)}k` : `${Math.round(x)}`);

function Readout({ label, cell, l, r, max = 200 }) {
  const bar = (v) => (
    <div className="h-1 w-14 overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
    </div>
  );
  return (
    <div className="grid grid-cols-[5.5rem_auto_auto] items-center gap-x-2 gap-y-0.5">
      <span className="truncate text-neutral-300">
        {label} <span className="text-neutral-500">{cell}</span>
      </span>
      {bar(l)}
      {r === undefined ? <span className="tabular-nums text-neutral-400">{Math.round(l)} Hz</span> : bar(r)}
    </div>
  );
}

/**
 * Host for the Three.js brain (created imperatively by BrainRenderer): the
 * real FlyWire connectome's live state, its descending-neuron readouts, and a
 * hover tooltip naming the nearest neuropil.
 */
export default function BrainView({ activity, pick, holding, real, ref }) {
  const [hover, setHover] = useState(null);
  const onMove = (e) => setHover(pick ? pick(e.clientX, e.clientY) : null);
  const cluster = hover ? CLUSTERS[hover.cluster] : null;
  const stats = real?.stats;
  const g = real?.groups;

  return (
    <section className="relative min-h-[44vh] overflow-hidden rounded-xl border border-white/[0.07] bg-void lg:min-h-0">
      <div ref={ref} className="absolute inset-0 cursor-grab active:cursor-grabbing" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />

      <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-24px)] flex-col gap-1">
        <span className="text-[11px] font-medium text-neutral-400">
          Whole brain · FlyWire v783 · every point is a real neuron at its real position
          {real?.where ? (real.where.kind === 'server' ? ' · simulated on the Base44 server' : ' · simulated in this browser') : ''}
        </span>
        {real?.status === 'ready' && stats ? (
          <div data-testid="brain-stats" className="flex flex-wrap items-baseline gap-x-3 font-mono text-[11px] text-neutral-400">
            <span>
              <span className="text-base font-semibold tabular-nums text-white">{fmt(stats.spikesPerSec)}</span> spikes/s
            </span>
            <span>
              <span className="tabular-nums text-neutral-200">{stats.active.toLocaleString('en-US')}</span> active
            </span>
            <span>
              <span className="tabular-nums text-neutral-200">{stats.rtf.toFixed(2)}×</span> real time
            </span>
          </div>
        ) : real?.status === 'error' ? (
          <span className="text-[11px] text-rose-300">Connectome failed to load · showing the 16-region model</span>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-neutral-400" data-testid="brain-loading">
            <div className="h-1 w-28 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(real?.progress ?? 0) * 100}%` }} />
            </div>
            {real?.transport?.kind === 'browser'
              ? `Loading 138,639 neurons into this browser (${real.transport.reason})`
              : 'Connecting to the brain on the Base44 server…'}
          </div>
        )}
        {stats?.trial && (
          <span data-testid="brain-trial" className="mt-1 self-start rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-neutral-950">
            {TRIAL_TEXT[stats.trial] ?? stats.trial}
          </span>
        )}
      </div>

      {g && (
        <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col gap-1 rounded-lg border border-white/10 bg-panel/90 px-2.5 py-2 font-mono text-[10px]">
          <div className="grid grid-cols-[5.5rem_auto_auto] gap-x-2 text-neutral-500">
            <span>Descending</span>
            <span>left</span>
            <span>right</span>
          </div>
          <Readout label="Escape" cell="DNp01" l={g.escapeL} r={g.escapeR} />
          <Readout label="Steer" cell="DNa02" l={g.steerL} r={g.steerR} max={120} />
          <Readout label="Feeding" cell="MNs" l={g.feed} max={30} />
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-3 text-[11px] text-neutral-400">
        {Object.entries(CLASS_LABEL).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`size-1.5 rounded-full ${v.dot}`} />
            {v.text}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-[#ffcc85]" />
          Spiking
        </span>
      </div>

      {holding && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
          <span className="rounded-lg border border-white/10 bg-panel px-4 py-2 font-mono text-xs text-neutral-200">Decoding DNA…</span>
        </div>
      )}

      {cluster && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+12px)] whitespace-nowrap rounded-lg border border-white/10 bg-panel px-2.5 py-1.5 text-[11px]"
          style={{ left: hover.x, top: hover.y }}
        >
          <div className="font-semibold text-white">{cluster.name}</div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-neutral-400">
            <span className={`size-1.5 rounded-full ${CLASS_LABEL[cluster.cls].dot}`} />
            {CLASS_LABEL[cluster.cls].text} · activity {Math.round(Math.min(1, activity[hover.cluster] ?? 0) * 100)}%
          </div>
        </div>
      )}
    </section>
  );
}
