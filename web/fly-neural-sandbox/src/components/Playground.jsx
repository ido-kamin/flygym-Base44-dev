/** The 2D arena canvas; drawing is done imperatively by drawPlayground.js. */
export default function Playground({ armed, onPointerDown, onPointerMove, onPointerLeave, children, ref }) {
  return (
    <section
      className={`relative min-h-[42vh] flex-1 overflow-hidden rounded-2xl border bg-void transition-colors lg:min-h-0 ${
        armed ? 'border-rose-400/70 shadow-[0_0_40px_-10px_rgba(244,63,94,0.8)]' : 'border-lime-300/20 shadow-[0_0_40px_-20px_rgba(163,230,53,0.5)]'
      }`}
    >
      <canvas
        ref={ref}
        className={`absolute inset-0 block h-full w-full ${armed ? 'cursor-crosshair' : 'cursor-copy'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      />
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-lime-200/90">Playground</span>
        <span className="font-mono text-[10px] text-slate-500">
          {armed ? 'click to drop a spider' : 'click to drop sugar'} · M mutate · P predator · R restart
        </span>
      </div>
      {children}
    </section>
  );
}
