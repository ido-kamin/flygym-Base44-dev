import { CONTROLS, LESIONS, ODOR_INFO } from '../lib/brainSession.js';

const STIMULI = [
  ['Senses', ['stimLightL', 'stimLightR', 'stimLoomL', 'stimLoomR', 'stimSmellL', 'stimSmellR', 'stimSugar', 'stimBitter', 'stimTouch']],
  ['Commands', ['walk', 'steerL', 'steerR', 'stimEscape', 'stimGroom']],
  ['Dopamine', ['reward', 'punish']],
];

function Slider({ name, hz, onChange, disabled }) {
  return (
    <label className="grid grid-cols-[1fr_6rem_2.5rem] items-center gap-2 text-[11px] text-neutral-300">
      <span className="truncate" title={CONTROLS[name].ref ?? ''}>
        {CONTROLS[name].label}
      </span>
      <input
        type="range"
        min="0"
        max="150"
        step="5"
        value={hz}
        disabled={disabled}
        onChange={(e) => onChange(name, Number(e.target.value))}
        className="h-1 accent-[#f5a524]"
        aria-label={`${CONTROLS[name].label}, Hz`}
        data-testid={`stim-${name}`}
      />
      <span className="text-right font-mono tabular-nums text-neutral-500">{hz}</span>
    </label>
  );
}

function Valence({ label, memory }) {
  const v = memory?.valence ?? 0;
  const pct = Math.max(-1, Math.min(1, v / 0.6));
  return (
    <div className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-2 text-[11px]">
      <span className="text-neutral-200">{label}</span>
      <div className="relative h-2 rounded-full bg-white/10">
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
        <div
          className={`absolute inset-y-0 rounded-full ${pct >= 0 ? 'bg-accent' : 'bg-rose-500'}`}
          style={pct >= 0 ? { left: '50%', width: `${pct * 50}%` } : { right: '50%', width: `${-pct * 50}%` }}
        />
      </div>
      <span className="text-right font-mono text-[10px] text-neutral-400">{Math.abs(v) < 0.02 ? 'neutral' : v > 0 ? 'approach' : 'avoid'}</span>
    </div>
  );
}

/**
 * Free play with the fly's brain: stimulate any neuron group, silence any
 * group, set how much the whole brain fires on its own, and teach it odours
 * with reward or punishment dopamine. Everything acts on the live brain.
 */
export default function SandboxPanel({ ready, controls, onControl, lesions, onLesion, background, onBackground, memory, onTeach, onForget, tool, onTool, inSandbox, onEnter }) {
  return (
    <div data-testid="sandbox-panel" className="flex flex-col gap-3 text-[11px] text-neutral-300">
      {!inSandbox && (
        <button type="button" onClick={onEnter} data-testid="enter-sandbox" className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-neutral-950 hover:brightness-110">
          Open the Sandbox arena (the fly can’t starve, drop odours)
        </button>
      )}

      <section>
        <h4 className="mb-1 text-[11px] font-semibold text-white">Click the floor to drop</h4>
        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Floor tool">
          {[
            ['sugar', 'Sugar'],
            ['spider', 'Spider'],
            ['odorA', 'Odour A'],
            ['odorB', 'Odour B'],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={tool === k}
              data-testid={`tool-${k}`}
              disabled={!inSandbox && k.startsWith('odor')}
              onClick={() => onTool(k)}
              className={`rounded-md px-2 py-1.5 font-medium transition disabled:opacity-40 ${tool === k ? 'bg-accent text-neutral-950' : 'text-neutral-300 ring-1 ring-inset ring-white/10 hover:bg-white/5'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-lg bg-void px-2.5 py-2">
        <div className="flex items-baseline justify-between">
          <h4 className="text-[11px] font-semibold text-white">Teach it</h4>
          <button type="button" onClick={onForget} disabled={!ready} data-testid="forget" className="text-[10px] text-neutral-500 hover:text-neutral-200">
            forget everything
          </button>
        </div>
        <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">
          Pair an odour with reward (PAM) or punishment (PPL1) dopamine. Its mushroom body rewires; then drop that odour in the arena and
          watch it approach or avoid it.
        </p>
        <div className="mt-2 grid gap-1.5">
          {['A', 'B'].map((o) => (
            <div key={o} className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
              <Valence label={`Odour ${o}`} memory={memory?.[o]} />
              <button type="button" disabled={!ready} onClick={() => onTeach('train', o)} data-testid={`teach-reward-${o}`} className="rounded-md bg-white/[0.06] px-2 py-1 text-white hover:bg-white/10 disabled:opacity-40" title={`${ODOR_INFO[o].glomerulus} (${ODOR_INFO[o].ligand}) + reward`}>
                + reward
              </button>
              <button type="button" disabled={!ready} onClick={() => onTeach('punish', o)} data-testid={`teach-punish-${o}`} className="rounded-md bg-white/[0.06] px-2 py-1 text-white hover:bg-white/10 disabled:opacity-40" title={`${ODOR_INFO[o].glomerulus} (${ODOR_INFO[o].ligand}) + punishment`}>
                + punish
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <label className="grid grid-cols-[1fr_6rem_2.5rem] items-center gap-2">
          <span className="font-semibold text-white">Spontaneous activity</span>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={background}
            disabled={!ready}
            onChange={(e) => onBackground(Number(e.target.value))}
            className="h-1 accent-[#f5a524]"
            aria-label="Spontaneous firing of every neuron, Hz"
            data-testid="background"
          />
          <span className="text-right font-mono tabular-nums text-neutral-500">{background.toFixed(1)}</span>
        </label>
        <p className="mt-0.5 text-[10px] text-neutral-500">Hz per neuron, all 138,639 of them. At 0 the brain is silent until something happens.</p>
      </section>

      {STIMULI.map(([title, names]) => (
        <section key={title}>
          <h4 className="mb-1 text-[11px] font-semibold text-white">Stimulate · {title}</h4>
          <div className="grid gap-1">
            {names.map((n) => (
              <Slider key={n} name={n} hz={controls[n] ?? 0} onChange={onControl} disabled={!ready} />
            ))}
          </div>
        </section>
      ))}

      <section>
        <h4 className="mb-1 text-[11px] font-semibold text-white">Silence (lesion)</h4>
        <div className="flex flex-wrap gap-1">
          {Object.entries(LESIONS).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={Boolean(lesions[k])}
              onClick={() => onLesion(k, !lesions[k])}
              disabled={!ready}
              className={`rounded-md px-2 py-1 transition ${lesions[k] ? 'bg-rose-500 text-white' : 'text-neutral-400 ring-1 ring-inset ring-white/10 hover:text-neutral-200'} disabled:opacity-40`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
