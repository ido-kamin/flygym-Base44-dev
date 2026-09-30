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
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col gap-3 overflow-y-auto border-l border-white/10 bg-[#060816] p-4 transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white">🔬 The Lab</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-neutral-400 hover:bg-white/10 hover:text-white" aria-label="Close lab">
            ✕
          </button>
        </div>

        {/* shrink-0: the DNA panel keeps its full height; the drawer scrolls instead */}
        <div className="flex shrink-0 flex-col [&>aside]:overflow-visible">{children}</div>

        {notes.length > 0 && (
          <section className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">📚 What your fly read</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {notes.map((n) => (
                <li key={n.url} className="text-xs">
                  <a href={n.url} target="_blank" rel="noreferrer" className="font-bold text-neutral-200 hover:underline">
                    {n.title}
                  </a>
                  <p className="text-[11px] text-neutral-500">{n.snippet}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-neutral-400">
          <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400">How it works</h3>
          <p>
            The body is <b className="text-neutral-200">NeuroMechFly v2</b> from FlyGym, walking with flygym&apos;s CPG and preprogrammed
            steps; its speed, turning and posture were measured by walking the same model in MuJoCo physics.
          </p>
          <p className="mt-1.5">
            The brain is the <b className="text-neutral-200">FlyWire v783 connectome</b>: 138,639 neurons and 2.7 million connections
            (5+ synapses), simulated as a leaky integrate-and-fire network with the published parameters of Shiu et al. (2024) in a
            Web Worker. Its photoreceptors see light, its looming detectors (LPLC2, LC4) see spiders, and sugar and odours are
            given as short stimulus trials. Its descending neurons move the body: the giant fiber (DNp01) triggers the escape jump,
            DNa02 steers, and brain motor neurons make it stop and feed.
          </p>
          <p className="mt-1.5">
            The 3D view shows {BRAIN_NEURONS.toLocaleString('en-US')} brain points (each lit by one FlyWire neuron of its region) and{' '}
            {VNC_NEURONS.toLocaleString('en-US')} nerve-cord points (MANC); positions are procedural, not FlyWire morphology. The
            personality genes run a 16-region model on top, and training uses dopamine-gated learning like the mushroom bodies.
          </p>
          <p className="mt-1.5">
            Connectome data: FlyWire Consortium (Dorkenwald et al. 2024, Schlegel et al. 2024), CC BY-NC 4.0 — non-commercial use.
            Model: Shiu et al., Nature 2024 (code MIT).
          </p>
          <p className="mt-1.5">The whole fly fits in a 10-character Base44 DNA string in the link, so shared links respawn the same fly.</p>
        </section>
      </aside>
    </div>
  );
}
