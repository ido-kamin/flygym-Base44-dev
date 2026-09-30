import { useState } from 'react';

import { CLUSTERS } from '../lib/connectome.js';

const CLASS_LABEL = {
  sensory: { text: 'Sensory', dot: 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' },
  intrinsic: { text: 'Intrinsic', dot: 'bg-fuchsia-400 shadow-[0_0_8px_#e879f9]' },
  motor: { text: 'Motor', dot: 'bg-orange-400 shadow-[0_0_8px_#fb923c]' },
};

/**
 * Host for the Three.js canvas (created imperatively by BrainRenderer) plus
 * the legend and a hover tooltip naming the nearest neuropil.
 */
export default function BrainView({ activity, pick, holding, ref }) {
  const [hover, setHover] = useState(null);

  const onMove = (e) => setHover(pick ? pick(e.clientX, e.clientY) : null);

  const cluster = hover ? CLUSTERS[hover.cluster] : null;

  return (
    <section className="relative min-h-[46vh] overflow-hidden rounded-2xl border border-cyan-400/20 bg-void shadow-[0_0_60px_-20px_rgba(34,211,238,0.5)] lg:min-h-0">
      <div ref={ref} className="absolute inset-0 cursor-grab active:cursor-grabbing" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />

      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-200/90">Connectome · live</span>
        <span className="font-mono text-[10px] text-slate-500">drag to orbit · scroll to zoom</span>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 rounded-lg border border-white/10 bg-black/50 px-2.5 py-1.5 backdrop-blur">
        {Object.entries(CLASS_LABEL).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
            <span className={`size-2 rounded-full ${v.dot}`} />
            {v.text}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-lime-200">
          <span className="size-2 rounded-full bg-lime-300 shadow-[0_0_8px_#bef264]" />
          Reward
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-rose-200">
          <span className="size-2 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
          Fear
        </span>
      </div>

      {holding && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
          <span className="rounded-xl border border-fuchsia-300/50 bg-black/60 px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] text-fuchsia-100 shadow-[0_0_30px_rgba(232,121,249,0.6)]">
            Decoding DNA…
          </span>
        </div>
      )}

      {cluster && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+12px)] whitespace-nowrap rounded-lg border border-white/15 bg-black/75 px-2.5 py-1.5 text-[11px] backdrop-blur"
          style={{ left: hover.x, top: hover.y }}
        >
          <div className="font-bold text-white">{cluster.name}</div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-slate-400">
            <span className={`size-1.5 rounded-full ${CLASS_LABEL[cluster.cls].dot}`} />
            {CLASS_LABEL[cluster.cls].text} · activity {Math.round(Math.min(1, activity[hover.cluster]) * 100)}%
          </div>
        </div>
      )}
    </section>
  );
}
