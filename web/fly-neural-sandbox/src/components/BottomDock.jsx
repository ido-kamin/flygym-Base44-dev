import { questFor } from '../lib/progress.js';

const btn =
  'flex items-center justify-center gap-1.5 rounded-2xl border px-3 py-2.5 text-xs font-black uppercase tracking-wide transition active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40';

/** Quest progress, training buttons and abilities: the game's control deck. */
export default function BottomDock({ hud, mission, stats, armed, onGood, onBad, onTogglePredator, onMutate, onRestart, onShip }) {
  const q = questFor(mission, { pipeline: hud.pipeline, deployments: hud.deployments, ...stats });
  const total = q.steps ? q.steps.length : q.total;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
      <section data-testid="quest" className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-black text-white">🎯 {q.title}</h3>
          <span className="shrink-0 font-mono text-[10px] text-amber-200">{q.reward}</span>
        </div>
        {q.steps ? (
          <ol className="mt-2 flex flex-wrap gap-1.5">
            {q.steps.map((s, i) => (
              <li
                key={s}
                className={`rounded-lg border px-2 py-1 font-mono text-[10px] font-bold ${
                  i < q.done
                    ? 'border-lime-300/60 bg-lime-400/20 text-lime-100'
                    : i === q.done
                      ? 'animate-pulse border-fuchsia-300/70 bg-fuchsia-500/15 text-fuchsia-100'
                      : 'border-white/10 text-slate-500'
                }`}
              >
                {i < q.done ? '✓ ' : ''}
                {s}
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-lime-300" style={{ width: `${(q.done / total) * 100}%` }} />
            </div>
            <span className="font-mono text-[10px] text-slate-300">
              {q.done}/{total}
            </span>
          </div>
        )}
        <p className="mt-1.5 text-[11px] text-slate-500">{q.hint}</p>
        {mission === 'build' && hud.deployments > 0 && (
          <button
            type="button"
            onClick={onShip}
            data-testid="launch-app"
            className="mt-2 w-full rounded-xl border border-fuchsia-300/70 bg-fuchsia-500/20 px-3 py-2 text-xs font-black uppercase tracking-wider text-white shadow-[0_0_20px_-6px_rgba(232,121,249,0.9)] hover:bg-fuchsia-500/30"
          >
            🚀 Launch the fly&apos;s app on Base44
          </button>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-black text-white">🧠 Train your fly</h3>
          <span className="font-mono text-[10px] text-slate-500">{stats.trained} sessions</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={onGood} data-testid="train-good" className={`${btn} border-lime-300/60 bg-lime-400/15 text-lime-50 hover:bg-lime-400/25`} title="Reward (G)">
            🍬 Good fly!
          </button>
          <button type="button" onClick={onBad} data-testid="train-bad" className={`${btn} border-rose-400/60 bg-rose-500/15 text-rose-50 hover:bg-rose-500/25`} title="Punish (B)">
            ⚡ No!
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
          Dopamine strengthens whatever its brain was just doing. Train it and its DNA changes.
        </p>
      </section>

      <section className="grid grid-cols-3 gap-2 lg:w-44 lg:grid-cols-1">
        <button
          type="button"
          onClick={onTogglePredator}
          aria-pressed={armed}
          className={`${btn} ${armed ? 'border-rose-300 bg-rose-500/30 text-white' : 'border-rose-400/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20'}`}
          title="Drop spiders (P)"
        >
          🕷 {armed ? 'Click!' : 'Spider'}
        </button>
        <button type="button" onClick={onMutate} className={`${btn} border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-100 hover:bg-fuchsia-500/20`} title="Mutate DNA (M)">
          ☢ Mutate
        </button>
        <button type="button" onClick={onRestart} className={`${btn} border-white/15 bg-white/5 text-slate-200 hover:bg-white/10`} title="Restart (R)">
          ↻ Restart
        </button>
      </section>
    </div>
  );
}
