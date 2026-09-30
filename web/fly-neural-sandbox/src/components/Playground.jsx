/**
 * The 2D arena canvas; drawing is done imperatively by drawPlayground.js.
 * In the Vibecode theme the arena is framed as a browser the fly is driving.
 */
export default function Playground({ armed, mode, dna, onPointerDown, onPointerMove, onPointerLeave, children, ref }) {
  const vibe = mode === 'vibe';
  return (
    <section
      className={`relative flex min-h-[46vh] flex-1 flex-col overflow-hidden rounded-2xl border bg-void transition-colors lg:min-h-0 ${
        armed
          ? 'border-rose-400/70 shadow-[0_0_40px_-10px_rgba(244,63,94,0.8)]'
          : vibe
            ? 'border-[#3b7bff]/50 shadow-[0_0_40px_-14px_rgba(59,123,255,0.9)]'
            : 'border-lime-300/20 shadow-[0_0_40px_-20px_rgba(163,230,53,0.5)]'
      }`}
    >
      {vibe && (
        <div className="z-10 flex shrink-0 flex-col gap-1.5 border-b border-white/10 bg-[#0a0f24] px-3 pb-2 pt-2">
          <div className="flex items-end gap-1 font-mono text-[10px]">
            <span className="rounded-t-md border border-b-0 border-white/15 bg-void px-2.5 py-1 text-slate-100">🪰 FlyCoin.sol</span>
            <span className="rounded-t-md px-2.5 py-1 text-slate-500">base44 · new app</span>
            <span className="rounded-t-md px-2.5 py-1 text-slate-600">basescan</span>
            <span className="ml-auto text-[9px] uppercase tracking-widest text-[#8fb2ff]">driven by 6 legs</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">◀ ▶ ⟳</span>
            <div className="flex-1 truncate rounded-md border border-white/10 bg-black/50 px-2 py-1 font-mono text-[11px] text-slate-300">
              <span className="text-emerald-300">🔒 fly://</span>base44.app/build<span className="text-fuchsia-300">#dna={dna}</span>
            </div>
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={ref}
          className={`absolute inset-0 block h-full w-full ${armed ? 'cursor-crosshair' : 'cursor-copy'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
        />
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
          <span className={`text-[10px] font-black uppercase tracking-[0.3em] ${vibe ? 'text-[#8fb2ff]' : 'text-lime-200/90'}`}>
            {vibe ? 'Fly-driven browser' : 'Playground'}
          </span>
          <span className="font-mono text-[10px] text-slate-500">
            {armed ? 'click to drop a spider' : vibe ? 'click to drop a token' : 'click to drop sugar'} · M mutate · P predator · R
            restart
          </span>
        </div>
        {children}
      </div>
    </section>
  );
}
