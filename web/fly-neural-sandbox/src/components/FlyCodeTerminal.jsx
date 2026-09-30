import { useEffect, useRef, useState } from 'react';

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

const HEADERS = {
  vibe: (dna, genes) => ({ file: `~/contracts/FlyCoin_${dna}.sol`, first: `contract FlyCoin_${dna} {`, note: `// genes 0x${genes}` }),
  build: (dna, genes) => ({ file: `base44 · fly-${dna}`, first: `$ base44 create --from-dna ${dna}`, note: `# genes 0x${genes}` }),
  search: (dna) => ({ file: `fly://search · ${dna}`, first: '$ fly search --curious', note: '# antennae online' }),
  forage: (dna, genes) => ({ file: `brain.log · ${dna}`, first: '$ fly forage', note: `# genes 0x${genes}` }),
};

/** Floating mission log, streamed one line per leg step (see flycode.js). */
export function FlyCodeTerminal({ dna, weights, lines, mission = 'vibe' }) {
  const scrollRef = useRef(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  const genes = weights.map((w) => w.toString(16).toUpperCase()).join('');
  const head = (HEADERS[mission] ?? HEADERS.vibe)(dna, genes);

  return (
    <div
      data-testid="flycode-terminal"
      className="absolute bottom-3 left-3 z-10 w-[min(480px,calc(100%-24px))] overflow-hidden rounded-xl border border-emerald-300/30 bg-black/75 shadow-[0_0_30px_-8px_rgba(52,211,153,0.6)] backdrop-blur"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 border-b border-white/10 px-3 py-1.5 text-left"
        aria-expanded={open}
      >
        <span className="size-2 rounded-full bg-rose-400" />
        <span className="size-2 rounded-full bg-amber-300" />
        <span className="size-2 rounded-full bg-emerald-400" />
        <span className="ml-2 truncate font-mono text-[10px] font-bold text-slate-400">flycode — {head.file}</span>
        <span className="ml-auto font-mono text-[10px] text-slate-500">{open ? '▾' : '▸'}</span>
      </button>
      <div ref={scrollRef} className={`pointer-events-none overflow-hidden px-3 font-mono text-[10.5px] leading-[1.45] ${open ? 'h-24 py-2 sm:h-28' : 'h-0'}`}>
        <div className="text-sky-300/80">
          {head.first} <span className="text-slate-500">{head.note}</span>
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
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[min(520px,calc(100%-24px))]">
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
