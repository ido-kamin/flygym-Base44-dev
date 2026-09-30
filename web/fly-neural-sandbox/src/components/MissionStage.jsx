import { MISSION_META } from '../lib/progress.js';

/**
 * The mission map: a top-down view of the arena in a small "FlyOS" browser
 * window whose address bar follows what the fly is doing.
 */
export default function MissionStage({ mission, hud, searchQuery, armed, onPointerDown, onPointerMove, onPointerLeave, children, ref }) {
  const m = MISSION_META[mission];
  let address = m.url;
  if (mission === 'search') address = searchQuery ? `${m.url}?q=${searchQuery}` : m.url;
  else if (mission === 'build') address = `${m.url}/fly-${hud.dna}`;
  else address = `${m.url}#dna=${hud.dna}`;

  return (
    <section
      className={`relative flex min-h-[46vh] flex-1 flex-col overflow-hidden rounded-xl border bg-void transition-colors lg:min-h-0 ${
        armed ? 'border-rose-500' : 'border-white/[0.07]'
      }`}
    >
      <div className="z-10 flex shrink-0 items-center gap-2 border-b border-white/[0.07] bg-panel px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-300">
          <span>{m.icon}</span> {m.tab}
        </span>
        <div data-testid="address-bar" className="min-w-0 flex-1 truncate rounded-md bg-void px-2.5 py-1 font-mono text-[11px] text-neutral-400">
          {address}
          {mission === 'search' && searchQuery && <span className="ml-0.5 animate-pulse text-accent">▍</span>}
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
