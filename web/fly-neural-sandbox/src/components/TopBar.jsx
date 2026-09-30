import { levelOf, levelProgress, MISSION_META } from '../lib/progress.js';
import { MODES } from './HomeScreen.jsx';

/** Missions reachable in the Build mode. */
export const BUILD_MISSIONS = ['build', 'search', 'vibe'];

/** Game header: the fly's identity + level, mission tabs, energy, actions. */
export default function TopBar({ hud, profile, mission, mode, onMode, onHome, onMission, onLab, onShare, copied }) {
  const level = levelOf(profile.xp);
  const progress = levelProgress(profile.xp);
  const energy = Math.max(0, Math.min(100, hud.energy));
  const low = energy < 25;

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-void/95 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-raised text-xl">🪰</div>
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-2">
              <span data-testid="fly-name-display" className="truncate text-[15px] font-semibold text-white">
                {profile.name}
              </span>
              <span className="shrink-0 rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-300">
                LV {level}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1 w-24 overflow-hidden rounded-full bg-white/10 sm:w-32" title={`${profile.xp} XP`}>
                <div className="h-full rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
              </div>
              <span className="truncate text-[11px] text-neutral-500">{hud.personality.title}</span>
            </div>
          </div>
        </div>

        <nav className="order-last flex w-full flex-wrap items-center gap-2 md:order-none md:w-auto" aria-label="Modes">
          <button
            type="button"
            onClick={onHome}
            data-testid="nav-home"
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-neutral-400 ring-1 ring-inset ring-white/10 hover:text-neutral-100"
          >
            Home
          </button>
          <div className="flex gap-0.5 rounded-lg bg-panel p-0.5">
            {Object.entries(MODES).map(([k, m]) => (
              <button
                key={k}
                type="button"
                onClick={() => onMode(k)}
                aria-pressed={mode === k}
                data-testid={`nav-${k}`}
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  mode === k ? 'bg-raised text-white ring-1 ring-white/10' : 'text-neutral-400 hover:text-neutral-100'
                }`}
              >
                <span className="mr-1">{m.icon}</span>
                {m.title}
              </button>
            ))}
          </div>
          {mode === 'build' && (
            <div className="flex gap-0.5" aria-label="Missions">
              {BUILD_MISSIONS.map((key) => {
                const m = MISSION_META[key];
                const on = mission === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onMission(key)}
                    aria-pressed={on}
                    data-testid={`tab-${key}`}
                    className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition ${on ? 'text-accent' : 'text-neutral-500 hover:text-neutral-200'}`}
                  >
                    {m.icon} {m.label}
                  </button>
                );
              })}
            </div>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-2 sm:flex" title="Energy">
            <span className="text-[11px] text-neutral-500">Energy</span>
            <div className={`h-1.5 w-24 overflow-hidden rounded-full bg-white/10 ${low ? 'animate-pulse-red' : ''}`}>
              <div
                className={`h-full rounded-full transition-[width] duration-200 ${low ? 'bg-rose-500' : 'bg-neutral-200'}`}
                style={{ width: `${energy}%` }}
              />
            </div>
          </div>
          <span className="font-mono text-sm font-semibold tabular-nums text-white" title="Score">
            <span className="mr-1 text-[11px] font-normal text-neutral-500">Score</span>
            {hud.score}
          </span>
          <button
            type="button"
            onClick={onShare}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-neutral-950 transition hover:brightness-110"
          >
            {copied ? 'Copied' : 'Share DNA'}
          </button>
          <button
            type="button"
            onClick={onLab}
            data-testid="open-lab"
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:bg-white/5"
          >
            Lab
          </button>
        </div>
      </div>
    </header>
  );
}
