import { useEffect, useRef } from 'react';

const LINE_TONE = {
  header: 'text-sky-300/80',
  code: 'text-emerald-300/90',
  stage: 'text-amber-200',
  warn: 'text-rose-300',
  success: 'text-[#8fb2ff] font-bold',
};

const STATUS_TONE = {
  ok: 'border-lime-300/50 text-lime-100',
  warn: 'border-rose-400/50 text-rose-100',
  dna: 'border-fuchsia-300/50 text-fuchsia-100',
  info: 'border-sky-300/40 text-sky-100',
};

/** Floating "FlyCode" terminal: pseudo-Solidity streamed by the fly's leg steps. */
export function FlyCodeTerminal({ dna, weights, lines }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  const genes = weights.map((w) => w.toString(16).toUpperCase()).join('');

  return (
    <div
      data-testid="flycode-terminal"
      className="pointer-events-none absolute bottom-3 left-3 z-10 w-[min(560px,calc(100%-24px))] overflow-hidden rounded-xl border border-emerald-300/30 bg-black/80 shadow-[0_0_30px_-8px_rgba(52,211,153,0.6)] backdrop-blur"
    >
      <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-1.5">
        <span className="size-2 rounded-full bg-rose-400" />
        <span className="size-2 rounded-full bg-amber-300" />
        <span className="size-2 rounded-full bg-emerald-400" />
        <span className="ml-2 font-mono text-[10px] font-bold text-slate-400">flycode — ~/contracts/FlyCoin_{dna}.sol</span>
      </div>
      <div ref={scrollRef} className="h-32 overflow-hidden px-3 py-2 font-mono text-[10.5px] leading-[1.45] sm:h-36">
        <div className="text-sky-300/80">
          contract FlyCoin_{dna} {'{'} <span className="text-slate-500">// genes 0x{genes}</span>
        </div>
        {lines.map((l) => (
          <div key={l.id} className={`truncate whitespace-pre ${LINE_TONE[l.kind] ?? LINE_TONE.code}`}>
            {l.text}
          </div>
        ))}
        <div className="text-emerald-300">
          <span className="animate-pulse">▋</span>
        </div>
      </div>
    </div>
  );
}

/** Sarcastic status HUD driven by brain state. */
export function FlyStatus({ status }) {
  if (!status) return null;
  return (
    <div className="pointer-events-none absolute inset-x-3 top-12 z-10 flex justify-center">
      <div
        key={status.text}
        data-testid="fly-status"
        className={`max-w-full animate-toast-in-static rounded-xl border bg-black/75 px-3 py-1.5 text-center text-[12px] font-semibold backdrop-blur ${STATUS_TONE[status.tone] ?? STATUS_TONE.info}`}
      >
        <span className="mr-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-400">fly status</span>
        {status.text}
      </div>
    </div>
  );
}
