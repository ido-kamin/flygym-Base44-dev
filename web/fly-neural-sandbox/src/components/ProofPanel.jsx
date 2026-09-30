import { useEffect, useRef, useState } from 'react';

const CODEX = (root) => `https://codex.flywire.ai/app/cell_details?root_id=${root}&data_version=783`;
const hz = (x) => `${Math.round(x ?? 0)} Hz`;

function Where({ where }) {
  if (!where) return <p className="text-[11px] text-neutral-500">Connecting to the brain…</p>;
  if (where.kind === 'server') {
    return (
      <div data-testid="where" className="rounded-lg bg-void px-2.5 py-2 text-[11px] leading-relaxed text-neutral-300">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-accent" />
          <span className="font-semibold text-white">Running on the Base44 server</span>
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-neutral-400">
          host {where.host} · {where.cpus} CPUs {where.cpuModel ? `(${where.cpuModel})` : ''} · {where.memoryGb} GB · Node {where.node}
        </div>
        <div className="font-mono text-[10px] text-neutral-400">
          {where.sessions ?? '?'} / {where.maxSessions} brains in use on this container
        </div>
      </div>
    );
  }
  return (
    <div data-testid="where" className="rounded-lg bg-void px-2.5 py-2 text-[11px] text-neutral-300">
      <span className="font-semibold text-white">Running in this browser</span>
      <span className="text-neutral-400"> — {where.reason ?? 'no server brain'} (same code, same connectome)</span>
    </div>
  );
}

/** Live spike raster of the named FlyWire neurons (each tick = one spike of that cell). */
function Raster({ getRaster, named }) {
  const ref = useRef(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      const src = getRaster();
      if (!c || !src) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
      if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const rows = named.length || 1;
      const rowH = h / rows;
      const left = 118;
      const span = 4000;
      const now = src.simMs;
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      named.forEach((n, i) => {
        const y = (i + 0.5) * rowH;
        if (i % 2 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.025)';
          ctx.fillRect(left, i * rowH, w - left, rowH);
        }
        ctx.fillStyle = '#a3a3a3';
        ctx.fillText(n.name, 4, y);
      });
      ctx.fillStyle = '#f5a524';
      for (const s of src.raster) {
        const x = left + (1 - (now - s.t) / span) * (w - left);
        if (x < left) continue;
        ctx.fillRect(x, s.k * rowH + 1.5, 1.2, Math.max(2, rowH - 3));
      }
      ctx.fillStyle = '#525252';
      ctx.fillText('−4 s', left + 2, h - 6);
      ctx.fillText('now', w - 22, h - 6);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getRaster, named]);
  return <canvas ref={ref} data-testid="raster" className="block h-64 w-full rounded-lg bg-void" />;
}

/**
 * "Is it real?": where the brain runs, the live causal chain from sensory
 * neurons to motor output, a spike raster of identified FlyWire neurons, and
 * a self-test of the published circuits on the server.
 */
export default function ProofPanel({ real, getRaster, motor, onSelfTest }) {
  const [test, setTest] = useState(null);
  const g = real?.groups;
  const named = real?.named ?? [];
  const run = async () => {
    setTest({ running: true });
    try {
      setTest(await onSelfTest());
    } catch (err) {
      setTest({ error: String(err.message ?? err) });
    }
  };
  const turnDeg = motor ? Math.round((motor.turnRate * 180) / Math.PI) : 0;
  return (
    <div data-testid="proof-panel" className="flex flex-col gap-2.5 text-[11px]">
      <Where where={real?.where} />
      {real?.stats && (
        <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px] text-neutral-400">
          <div className="rounded-md bg-void px-2 py-1.5">
            <div className="text-sm font-semibold tabular-nums text-white">{Math.round(real.stats.totalSpikes / 1000).toLocaleString('en-US')}k</div>
            spikes computed
          </div>
          <div className="rounded-md bg-void px-2 py-1.5">
            <div className="text-sm font-semibold tabular-nums text-white">{(real.stats.simMs / 1000).toFixed(1)} s</div>
            brain time
          </div>
          <div className="rounded-md bg-void px-2 py-1.5">
            <div className="text-sm font-semibold tabular-nums text-white">{Math.round((real.stats.cpuShare ?? 0) * 100)}%</div>
            of one CPU core
          </div>
        </div>
      )}

      {g && (
        <div data-testid="causal-chain" className="rounded-lg bg-void px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-neutral-300">
          <div className="mb-1 font-sans text-[11px] font-semibold text-white">Live: neurons → body</div>
          <div>
            <span className="text-neutral-500">DNp09 walk </span>
            {hz(g.walk)} <span className="text-neutral-500">→ walk command</span> {Math.round(Math.min(1, (g.walk ?? 0) / 60) * 100)}%
          </div>
          <div>
            <span className="text-neutral-500">DNa02 L/R </span>
            {hz(g.steerL)} / {hz(g.steerR)} <span className="text-neutral-500">→ turn command</span>{' '}
            {motor ? (Math.abs(motor.turnCmd) < 0.05 ? 'straight' : `${Math.round(Math.abs(motor.turnCmd) * 100)}% ${motor.turnCmd < 0 ? 'left' : 'right'}`) : '—'}
          </div>
          <div>
            <span className="text-neutral-500">DNp01 L/R </span>
            {hz(g.escapeL)} / {hz(g.escapeR)} <span className="text-neutral-500">→</span> {Math.max(g.escapeL, g.escapeR) > 40 ? 'ESCAPE JUMP' : 'no escape'}
          </div>
          <div>
            <span className="text-neutral-500">motor neurons </span>
            {hz(g.feed)} <span className="text-neutral-500">→</span> {g.feed > 5 ? 'feeding' : 'not feeding'}
          </div>
          <div className="mt-1 border-t border-white/[0.06] pt-1">
            <span className="text-neutral-500">body </span>
            {motor ? motor.speedMm.toFixed(1) : '0.0'} mm/s, {turnDeg > 0 ? `${turnDeg}°/s right` : turnDeg < 0 ? `${-turnDeg}°/s left` : 'straight'}
            <span className="text-neutral-500">
              {motor?.escaping ? ' · escape jump (DNp01 motor program)' : motor?.mode === 'neurons' ? ' · neurons only' : ' · autopilot + neurons'}
            </span>
          </div>
          <div className="mt-1 text-neutral-500">
            drive onto DNp09: hunger {motor?.hungerHz ?? 0} Hz{motor?.exploreHz ? ` + yours ${motor.exploreHz} Hz` : ''} · every neuron fires spontaneously at{' '}
            {real.stats?.background ?? 0} Hz{motor?.taste ? ' · proboscis on sugar' : ''}
          </div>
          <div className="mt-1 text-neutral-500">
            inputs: photoreceptors {hz(g.vision)} · LPLC2/LC4 {hz(g.looming)} · sugar GRNs {hz(g.sugar)} · Kenyon cells {g.kc?.toFixed(2)} Hz
          </div>
        </div>
      )}

      {named.length > 0 && (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[11px] font-semibold text-white">Spikes of identified FlyWire neurons</span>
            <span className="text-[10px] text-neutral-500">each tick = one spike</span>
          </div>
          <Raster getRaster={getRaster} named={named} />
          <details className="mt-1 text-[10px] text-neutral-500">
            <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">FlyWire IDs (open each cell in FlyWire Codex)</summary>
            <ul className="mt-1 grid gap-0.5">
              {named.map((n) => (
                <li key={n.idx} className="flex justify-between gap-2">
                  <span>
                    {n.name} <span className="text-neutral-600">{n.type}</span>
                  </span>
                  <a href={CODEX(n.root)} target="_blank" rel="noreferrer" className="font-mono text-neutral-300 hover:text-accent">
                    {n.root}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      <div className="rounded-lg bg-void px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-white">Self-test on the server</span>
          <button
            type="button"
            onClick={run}
            disabled={test?.running}
            data-testid="run-selftest"
            className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-neutral-950 hover:brightness-110 disabled:opacity-50"
          >
            {test?.running ? 'Running…' : 'Run experiments'}
          </button>
        </div>
        <p className="mt-1 text-[10px] text-neutral-500">Fresh brains, the published stimuli, nothing scripted: the numbers are what the neurons did.</p>
        {test?.error && <p className="mt-1 text-rose-300">{test.error}</p>}
        {test?.checks && (
          <ul data-testid="selftest-results" className="mt-1.5 grid gap-1">
            {test.checks.map((c) => (
              <li key={c.name} className="leading-snug">
                <span className={c.pass ? 'text-accent' : 'text-rose-400'}>{c.pass ? 'PASS' : 'FAIL'}</span>{' '}
                <span className="text-neutral-200">{c.name}</span>
                <div className="font-mono text-[10px] text-neutral-400">
                  {c.measured} <span className="text-neutral-600">(expect {c.expect})</span>
                </div>
              </li>
            ))}
            <li className="font-mono text-[10px] text-neutral-500">
              {(test.simMs / 1000).toFixed(1)} s of brain time, {Math.round(test.spikes / 1000)}k spikes in {(test.wallMs / 1000).toFixed(1)} s on {test.where?.host ?? 'the server'}
              {test.cached ? ' (cached)' : ''}
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
