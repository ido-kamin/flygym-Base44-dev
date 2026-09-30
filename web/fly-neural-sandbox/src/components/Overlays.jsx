const TONES = {
  info: 'border-cyan-300/50 text-cyan-50 shadow-[0_0_24px_-4px_rgba(34,211,238,0.8)]',
  ok: 'border-lime-300/60 text-lime-50 shadow-[0_0_24px_-4px_rgba(163,230,53,0.8)]',
  warn: 'border-rose-300/60 text-rose-50 shadow-[0_0_24px_-4px_rgba(244,63,94,0.8)]',
  dna: 'border-fuchsia-300/60 text-fuchsia-50 shadow-[0_0_24px_-4px_rgba(232,121,249,0.8)]',
};

export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div
      key={toast.id}
      role="status"
      className={`fixed bottom-6 left-1/2 z-50 max-w-[92vw] -translate-x-1/2 animate-toast-in rounded-xl border bg-black/80 px-4 py-2.5 text-center text-sm font-semibold backdrop-blur-xl ${TONES[toast.tone] ?? TONES.info}`}
    >
      {toast.text}
    </div>
  );
}

export function GameOverOverlay({ hud, onRestart, onMutateRetry, onCopy }) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/65 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-rose-400/50 bg-panel/90 p-6 text-center shadow-[0_0_60px_-10px_rgba(244,63,94,0.8)]">
        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-rose-300">Energy depleted</p>
        <h2 className="mt-2 text-4xl font-black tracking-tight text-white">STARVED</h2>
        <p className="mt-3 font-mono text-sm text-slate-300">
          Score <span className="font-bold text-amber-200">{hud.score}</span> · Gen {hud.generation}
        </p>
        <p className="mt-1 text-sm text-fuchsia-200">
          {hud.personality.emoji} {hud.personality.title}
        </p>
        <div className="mt-5 grid gap-2">
          <button
            type="button"
            onClick={onCopy}
            className="rounded-xl border border-cyan-300/60 bg-cyan-400/15 px-4 py-2.5 text-xs font-black uppercase tracking-[0.16em] text-cyan-50 hover:bg-cyan-400/25"
          >
            🧬 Share this DNA
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onRestart}
              className="rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-slate-200 hover:bg-white/10"
            >
              ↻ Retry
            </button>
            <button
              type="button"
              onClick={onMutateRetry}
              className="rounded-xl border border-fuchsia-400/60 bg-fuchsia-500/15 px-3 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-fuchsia-50 hover:bg-fuchsia-500/25"
            >
              ☢ Mutate & retry
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
