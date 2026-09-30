import { LESIONS } from '../lib/brainSession.js';

const chip = 'rounded-md px-2 py-1 text-[11px] font-medium transition';

/**
 * Drive the fly through its neurons: the controls stimulate real FlyWire
 * descending neurons (like optogenetics), and lesions silence them.
 */
export default function NeuralControls({ mode, onMode, explore, onExplore, onSteer, onReward, lesions, onLesion, ready }) {
  const hold = (side) => ({
    onPointerDown: (e) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      onSteer(side, true);
    },
    onPointerUp: () => onSteer(side, false),
    onPointerCancel: () => onSteer(side, false),
    onPointerLeave: () => onSteer(side, false),
  });
  return (
    <section data-testid="neural-controls" className="rounded-xl border border-white/[0.07] bg-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-white">Drive its neurons</h3>
        <div className="flex gap-0.5 rounded-md bg-void p-0.5" role="group" aria-label="Movement source">
          {[
            ['neurons', 'Neurons only'],
            ['assist', 'Autopilot'],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={mode === k}
              data-testid={`mode-${k}`}
              onClick={() => onMode(k)}
              className={`${chip} ${mode === k ? 'bg-raised text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-neutral-500">
        {mode === 'neurons'
          ? 'Every step, turn and jump comes from FlyWire descending neurons. You stimulate them, like optogenetics.'
          : 'The genome model steers to food and tasks; the FlyWire brain still fires the escapes and feeding.'}
      </p>

      <label className="mt-2 flex items-center gap-2 text-[11px] text-neutral-300">
        <span className="w-24 shrink-0">
          Explore <span className="text-neutral-500">DNp09</span>
        </span>
        <input
          type="range"
          min="0"
          max="80"
          step="5"
          value={explore}
          onChange={(e) => onExplore(Number(e.target.value))}
          className="h-1 flex-1 accent-[#f5a524]"
          aria-label="Explore drive: walk command neurons DNp09, Hz"
          data-testid="explore"
          disabled={!ready}
        />
        <span className="w-12 text-right font-mono tabular-nums text-neutral-400">{explore} Hz</span>
      </label>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <button type="button" {...hold('L')} disabled={!ready} data-testid="steer-left" className={`${chip} border border-white/10 bg-white/[0.04] py-2 text-white hover:bg-white/[0.08] active:bg-accent active:text-neutral-950 disabled:opacity-40`} title="Hold (A / ←): stimulate left DNa02">
          ◀ Left <span className="block text-[10px] text-neutral-500">DNa02 L</span>
        </button>
        <button type="button" onClick={onReward} disabled={!ready} data-testid="reward" className={`${chip} border border-white/10 bg-white/[0.04] py-2 text-white hover:bg-white/[0.08] active:bg-accent active:text-neutral-950 disabled:opacity-40`} title="E: dopamine pulse to PAM neurons (reward, drives learning)">
          Reward <span className="block text-[10px] text-neutral-500">PAM dopamine</span>
        </button>
        <button type="button" {...hold('R')} disabled={!ready} data-testid="steer-right" className={`${chip} border border-white/10 bg-white/[0.04] py-2 text-white hover:bg-white/[0.08] active:bg-accent active:text-neutral-950 disabled:opacity-40`} title="Hold (D / →): stimulate right DNa02">
          Right ▶ <span className="block text-[10px] text-neutral-500">DNa02 R</span>
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] text-neutral-500">Silence:</span>
        {Object.entries(LESIONS).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={Boolean(lesions[k])}
            data-testid={`lesion-${k}`}
            onClick={() => onLesion(k, !lesions[k])}
            disabled={!ready}
            className={`${chip} ${lesions[k] ? 'bg-rose-500 text-white' : 'text-neutral-400 ring-1 ring-inset ring-white/10 hover:text-neutral-200'} disabled:opacity-40`}
            title={`Silence ${label}`}
          >
            {label.split(' ')[0] === 'Brain' ? 'Motor neurons' : label.replace(/ DN.*$/, '')}
          </button>
        ))}
      </div>
    </section>
  );
}
