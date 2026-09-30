import { useState } from 'react';

import { personality } from '../lib/genome.js';
import { MISSION_META, randomFlyName } from '../lib/progress.js';

/** Starter genomes (6 x 4-bit genes: sugar, threat, dopamine, steering, drive, chaos). */
export const STARTERS = [
  { key: 'scout', egg: '🥚', label: 'Scout', weights: [10, 8, 8, 9, 8, 4] },
  { key: 'speedster', egg: '🔥', label: 'Speedster', weights: [10, 6, 8, 8, 14, 5] },
  { key: 'genius', egg: '💎', label: 'Brainy', weights: [13, 7, 12, 11, 8, 3] },
];

const MISSION_BLURB = {
  forage: 'Feed it sugar, dodge spiders, watch the dopamine fly.',
  build: 'It walks a Base44 builder and ships a real app.',
  search: 'It googles things with its antennae and reads the web.',
  vibe: 'It vibecodes a meme token on Base. Satire included.',
};

/**
 * First screen: name the fly, pick a starter brain and a mission.
 * `adopting` = opened from a shared DNA link (the genome is already set).
 */
export default function HatchScreen({ defaultName, adopting, dna, defaultMission, onHatch }) {
  const [name, setName] = useState(defaultName || randomFlyName());
  const [starter, setStarter] = useState(STARTERS[0].key);
  const [mission, setMission] = useState(defaultMission || 'build');

  const submit = (e) => {
    e.preventDefault();
    const pick = STARTERS.find((s) => s.key === starter);
    onHatch({ name: name.trim() || randomFlyName(), mission, weights: adopting ? null : pick.weights });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-md">
      <form
        onSubmit={submit}
        data-testid="hatch-screen"
        className="w-full max-w-2xl rounded-3xl border border-fuchsia-300/40 bg-[#070a18]/95 p-6 shadow-[0_0_80px_-10px_rgba(232,121,249,0.7)] sm:p-8"
      >
        <div className="text-center">
          <div className="mx-auto grid size-16 animate-bump place-items-center rounded-2xl border border-fuchsia-300/50 bg-fuchsia-500/15 text-4xl shadow-[0_0_30px_rgba(232,121,249,0.6)]">
            🪰
          </div>
          <h1 className="mt-4 bg-gradient-to-r from-cyan-200 via-fuchsia-200 to-orange-200 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
            {adopting ? 'Adopt this fly' : 'Hatch your fly'}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            {adopting ? (
              <>
                Someone shared fly <span className="font-mono text-fuchsia-200">{dna}</span> with you. Same brain, same
                personality: can you beat its score?
              </>
            ) : (
              'A real fruit-fly body with 161,555 simulated neurons. Train it, send it on missions, share its DNA.'
            )}
          </p>
        </div>

        <label className="mt-6 block">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Name</span>
          <div className="mt-1.5 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 32))}
              data-testid="fly-name"
              className="flex-1 rounded-xl border border-white/15 bg-black/50 px-4 py-3 text-lg font-bold text-white outline-none focus:border-fuchsia-300"
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
            <legend className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Starter brain</legend>
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
                    className={`rounded-2xl border p-3 text-left transition ${
                      on ? 'border-fuchsia-300 bg-fuchsia-500/15 shadow-[0_0_24px_-6px_rgba(232,121,249,0.9)]' : 'border-white/10 bg-white/[0.03] hover:border-white/30'
                    }`}
                  >
                    <div className="text-2xl">{s.egg}</div>
                    <div className="mt-1 text-sm font-black text-white">{s.label}</div>
                    <div className="text-[11px] leading-snug text-slate-400">
                      {p.emoji} {p.title}
                    </div>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <fieldset className="mt-5">
          <legend className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">First mission</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {Object.entries(MISSION_META).map(([key, m]) => {
              const on = mission === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMission(key)}
                  aria-pressed={on}
                  data-testid={`mission-${key}`}
                  className={`rounded-2xl border p-3 text-left transition ${on ? 'bg-white/10' : 'border-white/10 bg-white/[0.03] hover:border-white/30'}`}
                  style={on ? { borderColor: m.color, boxShadow: `0 0 24px -6px ${m.color}` } : undefined}
                >
                  <div className="text-sm font-black text-white">
                    {m.icon} {m.label}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-slate-400">{MISSION_BLURB[key]}</div>
                </button>
              );
            })}
          </div>
        </fieldset>

        <button
          type="submit"
          data-testid="hatch"
          className="mt-6 w-full rounded-2xl border border-fuchsia-200/70 bg-gradient-to-r from-cyan-500/40 via-fuchsia-500/40 to-orange-500/40 px-6 py-4 text-lg font-black uppercase tracking-[0.2em] text-white shadow-[0_0_40px_-8px_rgba(232,121,249,0.9)] transition hover:brightness-125 active:scale-[0.98]"
        >
          {adopting ? '🧬 Adopt & play' : '🐣 Hatch!'}
        </button>
      </form>
    </div>
  );
}
