import { ALPHABET, BIT_FIELDS } from '../lib/base44.js';
import { CLUSTERS } from '../lib/connectome.js';
import { GENES } from '../lib/genome.js';

const FIELD_STYLE = {
  weights: { on: 'bg-accent', off: 'bg-accent/10', label: 'text-accent' },
  score: { on: 'bg-neutral-200', off: 'bg-neutral-200/10', label: 'text-neutral-200' },
  pose: { on: 'bg-sky-400', off: 'bg-sky-400/10', label: 'text-sky-300' },
};

const ROWS = [
  { label: 'weights', from: 0 },
  { label: 'weights', from: 12 },
  { label: 'score', from: 24 },
  { label: 'x·y·θ', from: 36 },
];

const CLASS_BAR = {
  sensory: 'bg-sky-400',
  intrinsic: 'bg-white/5',
  motor: 'bg-accent',
};

function Section({ title, children, right }) {
  return (
    <section className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function DnaPanel({ hud, mode, onCopy, copied, onBuild, children }) {
  const vibe = mode === 'vibe';
  const chars = [...hud.dna];
  const headingDeg = Math.round(hud.pose.heading * 22.5);

  return (
    <aside className="relative flex min-h-0 flex-col gap-3 overflow-hidden rounded-2xl border border-white/10 bg-panel p-3 backdrop-blur-xl lg:overflow-y-auto">

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-200">
            {vibe ? "Fly's Compiled Bytecode" : 'Viral DNA'}
          </h2>
          <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-neutral-400">
            {vibe ? 'PROOF OF COMPILATION · BASE44' : 'BASE44 · 48 BIT'}
          </span>
        </div>

        <div
          data-testid="dna-string"
          data-dna={hud.dna}
          className="mt-2 flex items-baseline justify-between rounded-xl border border-white/10 bg-black/50 px-3 py-3 font-mono text-[26px] font-semibold tracking-wider text-neutral-200 sm:text-[30px]"
        >
          {chars.map((ch, i) => (
            <span
              key={`${i}-${ch}`}
              className={`inline-block animate-dna-flash ${i === chars.length - 1 ? 'text-neutral-500' : ''}`}
              title={i === chars.length - 1 ? 'checksum' : undefined}
            >
              {ch}
            </span>
          ))}
        </div>
        <p className="mt-1.5 truncate font-mono text-[10px] text-neutral-500">
          #dna=<span className="text-neutral-300">{hud.dna}</span>
          <span className="text-neutral-600"> · 9 digits + checksum</span>
        </p>

        <button
          type="button"
          onClick={onCopy}
          className="group mt-3 w-full rounded-xl border border-accent bg-accent px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:brightness-110 active:scale-[0.98]"
        >
          {copied ? '✓ Link copied' : '🧬 Copy Viral DNA Link'}
        </button>

        <button
          type="button"
          onClick={onBuild}
          data-testid="build-base44"
          className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-neutral-200 transition hover:bg-white/5 active:scale-[0.98]"
          title="Turns this fly's DNA into an app prompt and opens the Base44 builder"
        >
          🛠 Build this fly&apos;s app on Base44
        </button>
        {children}
        {vibe && (
          <p className="mt-2 font-mono text-[10px] text-neutral-500">
            pipeline {hud.pipeline * 20}% · deployments <span className="text-[#8fb2ff]">{hud.deployments}</span> (simulated)
          </p>
        )}
      </div>

      <Section title="Bit matrix" right={<span className="font-mono text-[9px] text-neutral-500">MSB → LSB</span>}>
        <div className="flex flex-col gap-1">
          {ROWS.map((row) => (
            <div key={row.from} className="flex items-center gap-2">
              <span className={`w-12 shrink-0 font-mono text-[9px] uppercase ${FIELD_STYLE[BIT_FIELDS[row.from]].label}`}>{row.label}</span>
              <div className="grid flex-1 grid-cols-12 gap-[3px]">
                {hud.bits.slice(row.from, row.from + 12).map((on, k) => {
                  const style = FIELD_STYLE[BIT_FIELDS[row.from + k]];
                  return (
                    <span
                      key={k}
                      className={`h-3 rounded-[3px] transition-colors duration-150 ${on ? style.on : style.off}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2 font-mono text-[10px]">
          <div className="rounded-md bg-black/40 px-2 py-1">
            <div className="text-neutral-500">grid x</div>
            <div className="text-neutral-200">{hud.pose.gx.toString(16).toUpperCase()}</div>
          </div>
          <div className="rounded-md bg-black/40 px-2 py-1">
            <div className="text-neutral-500">grid y</div>
            <div className="text-neutral-200">{hud.pose.gy.toString(16).toUpperCase()}</div>
          </div>
          <div className="rounded-md bg-black/40 px-2 py-1">
            <div className="text-neutral-500">head</div>
            <div className="text-neutral-200">{headingDeg}°</div>
          </div>
          <div className="rounded-md bg-black/40 px-2 py-1">
            <div className="text-neutral-500">score</div>
            <div className="text-amber-200">{hud.score}</div>
          </div>
        </div>
      </Section>

      <Section title="Connectome genome" right={<span className="font-mono text-[9px] text-neutral-500">6 × 4 bit</span>}>
        <ul className="flex flex-col gap-2">
          {GENES.map((g, i) => {
            const w = hud.weights[i];
            const changed = hud.changedGenes.includes(i);
            return (
              <li key={g.key} title={g.desc} className={`rounded-md px-1 ${changed ? 'animate-dna-flash bg-white/5' : ''}`}>
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="font-semibold text-neutral-200">{g.name}</span>
                  <span className="font-mono text-[10px] text-neutral-500">
                    {g.path} · <span className="text-neutral-200">{w.toString(16).toUpperCase()}</span>
                  </span>
                </div>
                <div className="mt-1 flex gap-[2px]">
                  {Array.from({ length: 15 }, (_, k) => (
                    <span
                      key={k}
                      className={`h-1.5 flex-1 rounded-sm ${k < w ? 'bg-accent' : 'bg-white/5'}`}
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[10px] leading-snug text-neutral-500">{hud.personality.tagline}</p>
      </Section>

      <Section title="Cluster activity">
        <div className="grid grid-cols-4 gap-1.5">
          {CLUSTERS.map((c, i) => {
            const a = Math.min(1, hud.activity[i]);
            return (
              <div key={c.key} className="rounded-md bg-black/40 px-1.5 py-1" title={c.name}>
                <div className="flex justify-between font-mono text-[9px]">
                  <span className="text-neutral-400">{c.key}</span>
                  <span className="text-neutral-500">{Math.round(a * 99)}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5">
                  <div className={`h-full rounded-full ${CLASS_BAR[c.cls]}`} style={{ width: `${a * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <p className="px-1 font-mono text-[9px] leading-relaxed break-all text-neutral-600">alphabet: {ALPHABET}</p>
    </aside>
  );
}
