const BEHAVIOUR = {
  explore: { text: 'Exploring', note: 'walking on its own', dot: 'bg-neutral-300' },
  walk: { text: 'Walking', note: 'DNp09 is firing', dot: 'bg-neutral-300' },
  forage: { text: 'Foraging', note: 'hungry — following the scent', dot: 'bg-accent' },
  flee: { text: 'Escaping', note: 'giant fiber fired — jump!', dot: 'bg-rose-500' },
  feed: { text: 'Feeding', note: 'proboscis on the sugar', dot: 'bg-accent' },
  groom: { text: 'Grooming', note: 'cleaning its antennae', dot: 'bg-sky-400' },
  stand: { text: 'Standing', note: 'its walk neurons are quiet', dot: 'bg-neutral-500' },
};

const SPEEDS = [
  [0.25, '¼×'],
  [0.5, '½×'],
  [1, '1×'],
];

/**
 * The world: host for the NeuroMechFly arena renderer (created imperatively
 * by FlyBody3D) plus what the fly is doing and the time-scale control.
 */
export default function BodyView({ ref, status, playback, onPlayback, behaviour, byBrain, motorMode, armed }) {
  // neurons only: walking is DNp09's doing, not the fly's autopilot
  const b = (motorMode === 'neurons' && behaviour === 'explore' ? BEHAVIOUR.walk : BEHAVIOUR[behaviour]) ?? BEHAVIOUR.explore;
  return (
    <section
      className={`relative min-h-[56vh] flex-1 overflow-hidden rounded-xl border bg-void lg:min-h-0 ${armed ? 'border-rose-500' : 'border-white/[0.07]'}`}
    >
      <div ref={ref} data-testid="world-view" className={`absolute inset-0 ${armed ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`} />

      <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-2">
        <span className="text-[11px] font-medium text-neutral-400">NeuroMechFly v2 · FlyGym body</span>
        <div data-testid="behaviour" className="flex items-center gap-2 rounded-lg border border-white/10 bg-panel/90 px-3 py-1.5">
          <span className={`size-2 rounded-full ${b.dot} ${behaviour === 'flee' ? 'animate-ping' : ''}`} />
          <span className="text-sm font-semibold text-white">{b.text}</span>
          <span className="hidden text-xs text-neutral-400 sm:inline">{b.note}</span>
          {byBrain && (
            <span className="ml-1 hidden rounded bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-neutral-300 sm:inline">
              {motorMode === 'neurons' ? 'neurons only' : 'FlyWire brain + autopilot'}
            </span>
          )}
        </div>
      </div>

      <div className="absolute right-3 top-3 flex gap-0.5 rounded-lg border border-white/10 bg-panel/90 p-0.5" role="group" aria-label="Time scale">
        {SPEEDS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => onPlayback(v)}
            aria-pressed={playback === v}
            className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-medium transition ${
              playback === v ? 'bg-raised text-white' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-500">
        <span>{armed ? 'Click the floor to drop a spider' : 'Click the floor to drop sugar'}</span>
        <span>Steer with A / D (DNa02) · E = dopamine reward</span>
        <span>Drag to orbit · scroll to zoom</span>
        <span>Legs glow with VNC T1 / T2 / T3</span>
      </div>

      {status !== 'ready' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="rounded-lg border border-white/10 bg-panel px-3 py-1.5 text-xs text-neutral-300">
            {status === 'error' ? 'NeuroMechFly body failed to load' : 'Loading NeuroMechFly body…'}
          </span>
        </div>
      )}
    </section>
  );
}
