/** Host for the NeuroMechFly body renderer (created imperatively by FlyBody3D). */
export default function BodyView({ ref, status, playback, onPlayback }) {
  return (
    <section className="relative min-h-[38vh] overflow-hidden rounded-2xl border border-orange-400/25 bg-void shadow-[0_0_50px_-20px_rgba(251,146,60,0.55)] lg:min-h-0">
      <div ref={ref} className="absolute inset-0 cursor-grab active:cursor-grabbing" />

      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-orange-200/90">Body · NeuroMechFly v2</span>
        <span className="font-mono text-[10px] text-slate-500">
          flygym CPG 12 Hz · tripod gait · 42 actuated DoFs
        </span>
      </div>

      <div className="absolute right-3 top-3 flex gap-1 rounded-lg border border-white/10 bg-black/50 p-0.5 backdrop-blur">
        {[
          [0.25, '¼× slow-mo'],
          [1, '1× real time'],
        ].map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => onPlayback(v)}
            className={`rounded-md px-2 py-1 font-mono text-[10px] font-bold transition ${
              playback === v ? 'bg-orange-400/25 text-orange-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-slate-400">
        <span>
          <span className="text-orange-300">legs</span> glow with VNC T1 / T2 / T3
        </span>
        <span>
          <span className="text-cyan-300">eyes · antennae</span> with optic / antennal lobes
        </span>
        <span>
          <span className="text-amber-100">flash</span> = leg in swing
        </span>
      </div>

      {status !== 'ready' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 font-mono text-[11px] text-slate-300">
            {status === 'error' ? 'NeuroMechFly body failed to load' : 'Loading NeuroMechFly body…'}
          </span>
        </div>
      )}
    </section>
  );
}
