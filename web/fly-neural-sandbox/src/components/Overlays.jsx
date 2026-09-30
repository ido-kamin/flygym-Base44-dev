const TONES = {
  info: 'border-white/10 text-neutral-100',
  ok: 'border-accent/60 text-neutral-100',
  warn: 'border-rose-500/60 text-rose-50',
  dna: 'border-white/15 text-neutral-100',
};

export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div
      key={toast.id}
      role="status"
      className={`fixed bottom-6 left-1/2 z-50 max-w-[92vw] -translate-x-1/2 animate-toast-in rounded-xl border bg-panel px-4 py-2.5 text-center text-sm font-medium ${TONES[toast.tone] ?? TONES.info}`}
    >
      {toast.text}
    </div>
  );
}

export function GameOverOverlay({ hud, onRestart, onMutateRetry, onCopy }) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/65 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-panel p-6 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-300">Energy depleted</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Starved</h2>
        <p className="mt-3 font-mono text-sm text-neutral-300">
          Score <span className="font-bold text-white">{hud.score}</span> · Gen {hud.generation}
        </p>
        <p className="mt-1 text-sm text-neutral-300">
          {hud.personality.emoji} {hud.personality.title}
        </p>
        <div className="mt-5 grid gap-2">
          <button
            type="button"
            onClick={onCopy}
            className="rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold text-neutral-950 hover:brightness-110"
          >
            Share this DNA
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onRestart}
              className="rounded-lg border border-white/10 px-3 py-2.5 text-xs font-medium text-neutral-200 hover:bg-white/5"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={onMutateRetry}
              className="rounded-lg border border-white/10 px-3 py-2.5 text-xs font-medium text-neutral-200 hover:bg-white/5"
            >
              Mutate & retry
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
