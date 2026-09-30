import { BRAIN_NEURONS, VNC_NEURONS } from '../lib/constants.js';

/**
 * Slide-over "Lab": everything technical lives here, off the main game screen:
 * the DNA bit matrix and genome, the fly's reading list, and the science notes.
 */
export default function LabDrawer({ open, onClose, notes, children }) {
  return (
    <div className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} />
      <aside
        data-testid="lab-drawer"
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col gap-3 overflow-y-auto border-l border-white/10 bg-[#060816] p-4 shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-[0.3em] text-white">🔬 The Lab</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close lab">
            ✕
          </button>
        </div>

        {/* shrink-0: the DNA panel keeps its full height; the drawer scrolls instead */}
        <div className="flex shrink-0 flex-col [&>aside]:overflow-visible">{children}</div>

        {notes.length > 0 && (
          <section className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">📚 What your fly read</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {notes.map((n) => (
                <li key={n.url} className="text-xs">
                  <a href={n.url} target="_blank" rel="noreferrer" className="font-bold text-cyan-200 hover:underline">
                    {n.title}
                  </a>
                  <p className="text-[11px] text-slate-500">{n.snippet}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
          <h3 className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">How it works</h3>
          <p>
            The body is <b className="text-slate-200">NeuroMechFly v2</b> from FlyGym, walking with flygym&apos;s CPG and preprogrammed
            steps; its speed, turning and posture were measured by walking the same model in MuJoCo physics.
          </p>
          <p className="mt-1.5">
            The brain shows {BRAIN_NEURONS.toLocaleString('en-US')} brain neurons (FlyWire) and {VNC_NEURONS.toLocaleString('en-US')} nerve-cord
            neurons (MANC), sized region by region from the published FlyWire annotations. Positions are procedural. Behaviour
            comes from a 16-region model of the Sensory → Intrinsic → Motor pathways, and training uses dopamine-gated learning
            like the fly&apos;s mushroom bodies.
          </p>
          <p className="mt-1.5">The whole fly fits in a 10-character Base44 DNA string in the link, so shared links respawn the same fly.</p>
        </section>
      </aside>
    </div>
  );
}
