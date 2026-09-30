import { useEffect, useRef, useState } from 'react';

const LINE_TONE = {
  header: 'text-neutral-500',
  code: 'text-neutral-300',
  stage: 'text-accent',
  warn: 'text-rose-300',
  success: 'text-white font-semibold',
};

const STATUS_TONE = {
  ok: 'border-accent/50 text-neutral-100',
  warn: 'border-rose-500/50 text-rose-50',
  dna: 'border-white/10 text-neutral-100',
  info: 'border-white/10 text-neutral-100',
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
      className="absolute bottom-3 left-3 z-10 w-[min(480px,calc(100%-24px))] overflow-hidden rounded-lg border border-white/10 bg-panel/95"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 border-b border-white/10 px-3 py-1.5 text-left"
        aria-expanded={open}
      >
        <span className="truncate font-mono text-[10px] font-bold text-neutral-400">flycode — {head.file}</span>
        <span className="ml-auto font-mono text-[10px] text-neutral-500">{open ? '▾' : '▸'}</span>
      </button>
      <div ref={scrollRef} className={`pointer-events-none overflow-hidden px-3 font-mono text-[10.5px] leading-[1.45] ${open ? 'h-24 py-2 sm:h-28' : 'h-0'}`}>
        <div className="text-neutral-500">
          {head.first} <span className="text-neutral-500">{head.note}</span>
        </div>
        {lines.map((l) => (
          <div key={l.id} className={`truncate whitespace-pre ${LINE_TONE[l.kind] ?? LINE_TONE.code}`}>
            {l.text}
          </div>
        ))}
        <div className="text-neutral-400">
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
        className={`max-w-full animate-toast-in-static rounded-lg border bg-panel/95 px-3 py-1.5 text-center text-[12px] font-medium ${STATUS_TONE[status.tone] ?? STATUS_TONE.info}`}
      >
        <span className="mr-1.5 font-mono text-[10px] uppercase tracking-widest text-neutral-400">fly status</span>
        {status.text}
      </div>
    </div>
  );
}
