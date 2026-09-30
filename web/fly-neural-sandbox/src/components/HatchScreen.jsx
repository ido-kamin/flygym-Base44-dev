import { useState } from 'react';

import { personality } from '../lib/genome.js';
import { randomFlyName } from '../lib/progress.js';

/** Starter genomes (6 x 4-bit genes: sugar, threat, dopamine, steering, drive, chaos). */
export const STARTERS = [
  { key: 'scout', egg: '🥚', label: 'Scout', weights: [10, 8, 8, 9, 8, 4] },
  { key: 'speedster', egg: '🔥', label: 'Speedster', weights: [10, 6, 8, 8, 14, 5] },
  { key: 'genius', egg: '💎', label: 'Brainy', weights: [13, 7, 12, 11, 8, 3] },
];

/**
 * First screen: name the fly and pick a starter brain (the Home screen comes next).
 * `adopting` = opened from a shared DNA link (the genome is already set).
 */
export default function HatchScreen({ defaultName, adopting, dna, onHatch }) {
  const [name, setName] = useState(defaultName || randomFlyName());
  const [starter, setStarter] = useState(STARTERS[0].key);

  const submit = (e) => {
    e.preventDefault();
    const pick = STARTERS.find((s) => s.key === starter);
    onHatch({ name: name.trim() || randomFlyName(), weights: adopting ? null : pick.weights });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        data-testid="hatch-screen"
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-panel p-6 sm:p-8"
      >
        <div className="text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-xl bg-raised text-3xl">
            🪰
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {adopting ? 'Adopt this fly' : 'Hatch your fly'}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-neutral-400">
            {adopting ? (
              <>
                Someone shared fly <span className="font-mono text-accent">{dna}</span> with you. Same brain, same
                personality: can you beat its score?
              </>
            ) : (
              'A real fruit-fly body driven by the whole FlyWire brain: 138,639 neurons, spiking live. Train it, send it on missions, share its DNA.'
            )}
          </p>
        </div>

        <label className="mt-6 block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Name</span>
          <div className="mt-1.5 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 32))}
              data-testid="fly-name"
              className="flex-1 rounded-xl border border-white/10 bg-void px-4 py-3 text-lg font-bold text-white outline-none focus:border-accent"
              aria-label="Fly name"
            />
            <button
              type="button"
              onClick={() => setName(randomFlyName())}
              className="rounded-xl border border-white/15 bg-white/5 px-4 text-xl hover:bg-white/10"
              aria-label="Random name"
              title="Random name"
            >
              🎲
            </button>
          </div>
        </label>

        {!adopting && (
          <fieldset className="mt-5">
            <legend className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Starter brain</legend>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {STARTERS.map((s) => {
                const p = personality(s.weights);
                const on = starter === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStarter(s.key)}
                    aria-pressed={on}
                    className={`rounded-xl border p-3 text-left transition ${
                      on ? 'border-accent bg-accent/10' : 'border-white/10 bg-white/[0.02] hover:border-white/25'
                    }`}
                  >
                    <div className="text-2xl">{s.egg}</div>
                    <div className="mt-1 text-sm font-semibold text-white">{s.label}</div>
                    <div className="text-[11px] leading-snug text-neutral-400">
                      {p.emoji} {p.title}
                    </div>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <button
          type="submit"
          data-testid="hatch"
          className="mt-6 w-full rounded-xl bg-accent px-6 py-3.5 text-base font-semibold text-neutral-950 transition hover:brightness-110 active:scale-[0.99]"
        >
          {adopting ? 'Adopt & play' : 'Hatch'}
        </button>
      </form>
    </div>
  );
}
