import { useEffect, useRef, useState } from 'react';

import { NEURON_COUNT } from '../lib/constants.js';

/** Animate an integer toward `value` (score ticker). */
function useCountUp(value, ms = 450) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return undefined;
    const t0 = performance.now();
    let raf = 0;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const v = Math.round(from + (value - from) * (1 - (1 - k) ** 3));
      shownRef.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

function Stat({ label, children, className = '' }) {
  return (
    <div className={`flex flex-col leading-none ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</span>
      {children}
    </div>
  );
}

export default function TopHud({ hud }) {
  const score = useCountUp(hud.score);
  const energy = Math.max(0, Math.min(100, hud.energy));
  const low = energy < 25;

  return (
    <header className="sticky top-0 z-30 border-b border-cyan-400/15 bg-void/80 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="relative grid size-9 place-items-center rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/10 shadow-[0_0_18px_rgba(232,121,249,0.45)]">
            <span className="text-lg">🪰</span>
          </div>
          <div className="leading-tight">
            <h1 className="bg-gradient-to-r from-cyan-300 via-fuchsia-300 to-orange-300 bg-clip-text text-sm font-black uppercase tracking-[0.25em] text-transparent">
              Fly Neural Sandbox
            </h1>
            <p className="font-mono text-[10px] text-slate-500">
              {NEURON_COUNT.toLocaleString('en-US')} neurons · {hud.fps} fps
            </p>
          </div>
        </div>

        <Stat label="Score">
          <span
            key={hud.score}
            className="inline-block origin-left animate-bump font-mono text-2xl font-black tabular-nums text-white drop-shadow-[0_0_10px_rgba(253,224,71,0.55)]"
          >
            {score.toString().padStart(4, '0')}
          </span>
        </Stat>

        <Stat label="High score">
          <span className="font-mono text-lg font-bold tabular-nums text-amber-200/80">
            {hud.high.toString().padStart(4, '0')}
          </span>
        </Stat>

        <Stat label="Energy" className="min-w-40 flex-1 sm:max-w-72">
          <div
            className={`mt-1.5 h-3 overflow-hidden rounded-full border border-white/10 bg-white/5 ${low ? 'animate-pulse-red' : ''}`}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-200 ${
                low
                  ? 'bg-gradient-to-r from-rose-600 to-rose-400'
                  : 'bg-gradient-to-r from-lime-400 via-emerald-400 to-cyan-400 shadow-[0_0_12px_rgba(163,230,53,0.6)]'
              }`}
              style={{ width: `${energy}%` }}
            />
          </div>
          <span className="mt-1 font-mono text-[10px] tabular-nums text-slate-400">{energy.toFixed(0)} / 100</span>
        </Stat>

        <Stat label="Generation">
          <span className="mt-0.5 inline-flex items-center gap-1.5 rounded-lg border border-violet-400/40 bg-violet-500/15 px-2 py-1 font-mono text-sm font-bold text-violet-200 shadow-[0_0_14px_rgba(167,139,250,0.35)]">
            GEN {hud.generation}
          </span>
        </Stat>

        <Stat label="Personality" className="ml-auto">
          <span className="mt-0.5 text-sm font-bold text-fuchsia-200">
            {hud.personality.emoji} {hud.personality.title}
          </span>
        </Stat>
      </div>
    </header>
  );
}
