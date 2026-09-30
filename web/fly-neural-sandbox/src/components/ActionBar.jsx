const base =
  'flex items-center justify-center gap-2 rounded-xl border px-2.5 py-2.5 text-[11px] leading-tight font-black uppercase tracking-[0.08em] transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40';

export default function ActionBar({ armed, predators, maxPredators, onCopy, onMutate, onTogglePredator, onClear, onRestart }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <button
        type="button"
        onClick={onCopy}
        className={`${base} col-span-2 border-cyan-300/60 bg-cyan-400/10 text-cyan-100 shadow-[0_0_18px_-4px_rgba(34,211,238,0.8)] hover:bg-cyan-400/20 sm:col-span-1`}
      >
        🧬 Copy Viral DNA Link
      </button>
      <button
        type="button"
        onClick={onMutate}
        className={`${base} border-fuchsia-400/60 bg-fuchsia-500/10 text-fuchsia-100 shadow-[0_0_18px_-4px_rgba(232,121,249,0.8)] hover:bg-fuchsia-500/20`}
        title="Shift 1–2 connection weights (M)"
      >
        ☢ Mutate Brain DNA
      </button>
      <button
        type="button"
        onClick={onTogglePredator}
        aria-pressed={armed}
        className={`${base} ${
          armed
            ? 'border-rose-300 bg-rose-500/30 text-white shadow-[0_0_26px_-2px_rgba(244,63,94,0.95)]'
            : 'border-rose-400/60 bg-rose-500/10 text-rose-100 shadow-[0_0_18px_-4px_rgba(244,63,94,0.7)] hover:bg-rose-500/20'
        }`}
        title="Arm, then click the playground to drop spiders (P)"
      >
        🕷 {armed ? 'Click to drop…' : 'Spawn Predator'}
        <span className="font-mono text-[10px] opacity-70">
          {predators}/{maxPredators}
        </span>
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={predators === 0}
        className={`${base} border-white/15 bg-white/5 text-slate-300 hover:bg-white/10`}
      >
        ✕ Clear Predators
      </button>
      <button
        type="button"
        onClick={onRestart}
        className={`${base} border-white/15 bg-white/5 text-slate-300 hover:bg-white/10`}
        title="Same DNA, score 0, full energy (R)"
      >
        ↻ Restart
      </button>
    </div>
  );
}
