import { questFor } from '../lib/progress.js';

const btn =
  'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40';

/** Quest progress, training buttons and abilities: the game's control deck. */
export default function BottomDock({ hud, mission, stats, armed, onGood, onBad, onTogglePredator, onMutate, onRestart, onShip }) {
  const q = questFor(mission, { pipeline: hud.pipeline, deployments: hud.deployments, ...stats });
  const total = q.steps ? q.steps.length : q.total;

  return (
    <div className="grid gap-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
      <section data-testid="quest" className="rounded-xl border border-white/[0.07] bg-panel p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-white">{q.title}</h3>
          <span className="shrink-0 font-mono text-[10px] text-neutral-500">{q.reward}</span>
        </div>
        {q.steps ? (
          <ol className="mt-2 flex flex-wrap gap-1">
            {q.steps.map((s, i) => (
              <li
                key={s}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                  i < q.done
                    ? 'bg-white/[0.06] text-neutral-400 line-through decoration-neutral-600'
                    : i === q.done
                      ? 'bg-accent text-neutral-950'
                      : 'text-neutral-500 ring-1 ring-inset ring-white/[0.07]'
                }`}
              >
                {s}
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(q.done / total) * 100}%` }} />
            </div>
            <span className="font-mono text-[10px] text-neutral-400">
              {q.done}/{total}
            </span>
          </div>
        )}
        <p className="mt-1.5 text-[11px] text-neutral-500">{q.hint}</p>
        {mission === 'build' && hud.deployments > 0 && (
          <button
            type="button"
            onClick={onShip}
            data-testid="launch-app"
            className="mt-2 w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-neutral-950 transition hover:brightness-110"
          >
            Launch the fly&apos;s app on Base44
          </button>
        )}
      </section>

      <section className="rounded-xl border border-white/[0.07] bg-panel p-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold text-white">Train your fly</h3>
          <span className="font-mono text-[10px] text-neutral-500">{stats.trained} sessions</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={onGood} data-testid="train-good" className={`${btn} border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]`} title="Reward (G)">
            🍬 Good fly
          </button>
          <button type="button" onClick={onBad} data-testid="train-bad" className={`${btn} border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]`} title="Punish (B)">
            ✋ No
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-neutral-500">
          Dopamine strengthens whatever its brain was just doing. Train it and its DNA changes.
        </p>
      </section>

      <section className="grid grid-cols-3 gap-2 lg:w-36 lg:grid-cols-1">
        <button
          type="button"
          onClick={onTogglePredator}
          aria-pressed={armed}
          className={`${btn} ${armed ? 'border-rose-500 bg-rose-500 text-white' : 'border-white/10 bg-panel text-neutral-200 hover:bg-white/[0.06]'}`}
          title="Drop spiders (P)"
        >
          🕷 {armed ? 'Click the floor' : 'Spider'}
        </button>
        <button type="button" onClick={onMutate} className={`${btn} border-white/10 bg-panel text-neutral-200 hover:bg-white/[0.06]`} title="Mutate DNA (M)">
          Mutate
        </button>
        <button type="button" onClick={onRestart} className={`${btn} border-white/10 bg-panel text-neutral-200 hover:bg-white/[0.06]`} title="Restart (R)">
          Restart
        </button>
      </section>
    </div>
  );
}
