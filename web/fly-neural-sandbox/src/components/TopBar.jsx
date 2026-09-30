import { levelOf, levelProgress, MISSION_META } from '../lib/progress.js';

/** Game header: the fly's identity + level, mission tabs, energy, actions. */
export default function TopBar({ hud, profile, mission, onMission, onLab, onShare, copied }) {
  const level = levelOf(profile.xp);
  const progress = levelProgress(profile.xp);
  const energy = Math.max(0, Math.min(100, hud.energy));
  const low = energy < 25;

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-void/85 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-2xl border border-fuchsia-300/50 bg-fuchsia-500/15 text-2xl shadow-[0_0_20px_rgba(232,121,249,0.5)]">
            🪰
          </div>
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-2">
              <span data-testid="fly-name-display" className="truncate text-base font-black text-white">
                {profile.name}
              </span>
              <span className="shrink-0 rounded-lg bg-violet-500/25 px-1.5 py-0.5 font-mono text-[11px] font-black text-violet-100">
                LV {level}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10 sm:w-36" title={`${profile.xp} XP`}>
                <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-300" style={{ width: `${progress * 100}%` }} />
              </div>
              <span className="font-mono text-[10px] text-slate-400">
                {hud.personality.emoji} {hud.personality.title}
              </span>
            </div>
          </div>
        </div>

        <nav className="order-last flex w-full gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-1 md:order-none md:w-auto" aria-label="Missions">
          {Object.entries(MISSION_META).map(([key, m]) => {
            const on = mission === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onMission(key)}
                aria-pressed={on}
                data-testid={`tab-${key}`}
                className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-black transition ${on ? 'text-white' : 'text-slate-400 hover:text-slate-100'}`}
                style={on ? { background: `${m.color}33`, boxShadow: `0 0 16px -4px ${m.color}` } : undefined}
              >
                {m.icon} {m.label}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-2 sm:flex" title="Energy">
            <span className="text-sm">⚡</span>
            <div className={`h-2.5 w-24 overflow-hidden rounded-full border border-white/10 bg-white/5 ${low ? 'animate-pulse-red' : ''}`}>
              <div
                className={`h-full rounded-full transition-[width] duration-200 ${low ? 'bg-rose-500' : 'bg-gradient-to-r from-lime-400 to-cyan-400'}`}
                style={{ width: `${energy}%` }}
              />
            </div>
          </div>
          <span className="rounded-xl bg-amber-300/15 px-2.5 py-1 font-mono text-sm font-black tabular-nums text-amber-200" title="Score">
            ⭐ {hud.score}
          </span>
          <button
            type="button"
            onClick={onShare}
            className="rounded-xl border border-cyan-300/50 bg-cyan-400/10 px-3 py-1.5 text-xs font-black text-cyan-50 hover:bg-cyan-400/20"
          >
            {copied ? '✓ Copied' : '🧬 Share'}
          </button>
          <button
            type="button"
            onClick={onLab}
            data-testid="open-lab"
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-black text-slate-200 hover:bg-white/10"
          >
            🔬 Lab
          </button>
        </div>
      </div>
    </header>
  );
}
