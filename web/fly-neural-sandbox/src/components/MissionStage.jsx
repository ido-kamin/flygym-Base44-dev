import { MISSION_META } from '../lib/progress.js';

/**
 * The fly-driven browser: every mission plays inside a "FlyOS" browser window
 * whose tab and address bar follow what the fly is doing.
 */
export default function MissionStage({ mission, hud, searchQuery, armed, onPointerDown, onPointerMove, onPointerLeave, children, ref }) {
  const m = MISSION_META[mission];
  let address = m.url;
  if (mission === 'search') address = searchQuery ? `${m.url}?q=${searchQuery}` : m.url;
  else if (mission === 'build') address = `${m.url}/fly-${hud.dna}`;
  else address = `${m.url}#dna=${hud.dna}`;

  return (
    <section
      className="relative flex min-h-[52vh] flex-1 flex-col overflow-hidden rounded-3xl border bg-void transition-colors lg:min-h-0"
      style={{ borderColor: armed ? '#fb7185' : `${m.color}88`, boxShadow: `0 0 50px -18px ${armed ? '#fb7185' : m.color}` }}
    >
      <div className="z-10 flex shrink-0 flex-col gap-1.5 border-b border-white/10 bg-[#0a0f24] px-3 pb-2 pt-2">
        <div className="flex items-end gap-1 font-mono text-[11px]">
          <span className="flex items-center gap-1.5 rounded-t-lg border border-b-0 border-white/15 bg-void px-3 py-1 text-slate-100">
            <span>{m.icon}</span> {m.tab}
          </span>
          <span className="hidden rounded-t-lg px-3 py-1 text-slate-500 sm:inline">🧠 brain.fly</span>
          <span className="ml-auto flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: m.color }}>
            <span className="size-1.5 animate-pulse rounded-full" style={{ background: m.color }} /> driven by 6 legs
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="select-none text-slate-500">◀ ▶ ⟳</span>
          <div data-testid="address-bar" className="flex-1 truncate rounded-lg border border-white/10 bg-black/50 px-2.5 py-1 font-mono text-[11px] text-slate-300">
            <span className="text-emerald-300">🔒 </span>
            {address}
            {mission === 'search' && searchQuery && <span className="ml-0.5 animate-pulse text-cyan-300">▍</span>}
          </div>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={ref}
          className={`absolute inset-0 block h-full w-full ${armed ? 'cursor-crosshair' : 'cursor-pointer'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
        />
        {children}
      </div>
    </section>
  );
}
