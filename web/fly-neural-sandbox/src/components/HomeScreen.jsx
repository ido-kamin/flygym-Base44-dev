import { levelOf } from '../lib/progress.js';

export const MODES = {
  sandbox: {
    title: 'Sandbox',
    icon: '🧪',
    blurb: 'Play with its brain. Drop sugar, spiders and odours; stimulate or silence any neuron group; watch 138,639 neurons respond.',
    cta: 'Open the sandbox',
  },
  train: {
    title: 'Training',
    icon: '🎓',
    blurb: 'Teach it. Pair odours with reward or punishment dopamine, run the classic mushroom-body experiment, and see the memory change its behaviour.',
    cta: 'Start training',
  },
  build: {
    title: 'Build apps',
    icon: '🛠',
    blurb: 'Put it to work. It walks a Base44 builder and ships a real app, searches the web, or vibecodes a token on Base.',
    cta: 'Start building',
  },
};

/**
 * Home: pick a mode. The fly and its brain keep running behind this screen.
 */
export default function HomeScreen({ profile, real, onMode, current }) {
  const where = real?.where;
  const stats = real?.stats;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm" data-testid="home-screen">
      <div className="w-full max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-neutral-400">Welcome back</p>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              {profile.name} <span className="align-middle text-sm font-medium text-neutral-400">LV {levelOf(profile.xp)}</span>
            </h1>
          </div>
          <div className="rounded-lg border border-white/10 bg-panel px-3 py-2 font-mono text-[11px] text-neutral-400" data-testid="home-brain-status">
            {real?.status === 'ready' ? (
              <>
                <span className="text-accent">●</span> brain live {where?.kind === 'server' ? `on the Base44 server (${where.host})` : 'in this browser'}
                {stats ? ` · ${Math.round(stats.spikesPerSec / 1000)}k spikes/s · ${stats.rtf.toFixed(2)}× real time` : ''}
              </>
            ) : (
              'connecting to its brain…'
            )}
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {Object.entries(MODES).map(([k, m]) => (
            <button
              key={k}
              type="button"
              onClick={() => onMode(k)}
              data-testid={`home-${k}`}
              className={`group flex flex-col rounded-2xl border bg-panel p-5 text-left transition hover:border-accent ${current === k ? 'border-accent' : 'border-white/10'}`}
            >
              <span className="text-3xl">{m.icon}</span>
              <span className="mt-3 text-lg font-semibold text-white">{m.title}</span>
              <span className="mt-1 flex-1 text-[13px] leading-snug text-neutral-400">{m.blurb}</span>
              <span className="mt-4 inline-flex w-fit rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-neutral-950 group-hover:brightness-110">{m.cta}</span>
            </button>
          ))}
        </div>
        <p className="mt-4 text-center text-[11px] text-neutral-500">
          The fly moves only by its FlyWire brain in every mode (switch to Autopilot in the controls for missions). Press H for home.
        </p>
      </div>
    </div>
  );
}
