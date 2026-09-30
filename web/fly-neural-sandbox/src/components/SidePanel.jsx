const TABS = [
  ['sandbox', 'Sandbox'],
  ['proof', 'Is it real?'],
  ['learn', 'Learning'],
  ['map', 'Mission map'],
];

/**
 * Tabs under the brain. Inactive panes stay mounted and sized (invisible),
 * so the mission map's canvas keeps drawing.
 */
export default function SidePanel({ tab, onTab, panes }) {
  return (
    <section className="relative flex min-h-[60vh] flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-panel lg:min-h-0">
      <div className="flex shrink-0 gap-0.5 border-b border-white/[0.07] p-1" role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            data-testid={`tab-panel-${k}`}
            onClick={() => onTab(k)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${tab === k ? 'bg-raised text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        {TABS.map(([k]) => (
          <div
            key={k}
            role="tabpanel"
            aria-hidden={tab !== k}
            className={`absolute inset-0 flex flex-col ${k === 'map' ? '' : 'overflow-y-auto p-3'} ${tab === k ? '' : 'pointer-events-none invisible'}`}
          >
            {panes[k]}
          </div>
        ))}
      </div>
    </section>
  );
}
