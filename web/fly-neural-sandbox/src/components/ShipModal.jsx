import { useEffect, useMemo, useRef, useState } from 'react';

import { base44BuildUrl, flyAppPrompt } from '../lib/base44App.js';

const STATES = {
  idle: null,
  creating: 'Sending the fly’s blueprint to Base44…',
  building: 'Base44 is building the fly’s app…',
  deploying: 'Publishing it to the web…',
  live: 'Live!',
};

/**
 * The fly shipped an app: launch it for real on Base44 (server-side Platform
 * API, see server/app.mjs) or, when the server has no Base44 token, hand the
 * DNA-derived prompt to the Base44 builder.
 */
export default function ShipModal({ dna, weights, score, deployments, shareUrl, onClose, onCopyPrompt }) {
  const { title, prompt } = useMemo(() => flyAppPrompt(dna, weights, { score, deployments, url: shareUrl }), [dna, weights, score, deployments, shareUrl]);
  const [state, setState] = useState('idle');
  const [app, setApp] = useState(null);
  const [error, setError] = useState(null);
  const [fallback, setFallback] = useState(false);
  const [realApps, setRealApps] = useState(null); // null = checking
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  // does this server have a Base44 token? (static hosting has no /api at all)
  useEffect(() => {
    let alive = true;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((h) => {
        if (!alive) return;
        setRealApps(Boolean(h?.realApps));
        if (!h?.realApps) setFallback(true);
      })
      .catch(() => {
        if (alive) {
          setRealApps(false);
          setFallback(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const poll = (id) => {
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/fly-apps/${id}`);
        const data = await r.json();
        if (data.state === 'live') {
          setState('live');
          setApp((a) => ({ ...a, url: data.url }));
          return;
        }
        if (data.state === 'error') {
          setError(data.reason === 'paywall' ? 'The Base44 workspace is out of credits.' : 'The build failed on Base44.');
          setState('idle');
          return;
        }
        setState(data.state === 'deploying' ? 'deploying' : 'building');
        poll(id);
      } catch {
        poll(id);
      }
    }, 5000);
  };

  const launch = async () => {
    setError(null);
    setState('creating');
    try {
      const r = await fetch('/api/fly-apps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dna }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 201) {
        setApp({ id: data.id, name: data.name });
        setState('building');
        poll(data.id);
        return;
      }
      setState('idle');
      if (data.error === 'not_configured' || r.status === 404 || r.status === 405) {
        setFallback(true);
        return;
      }
      const why = {
        rate_limited: 'Easy, builder! One launch every 2 minutes per player.',
        busy: 'Lots of flies launching right now. Try again in a minute.',
        daily_cap: 'Today’s real launches are used up. Use the builder hand-off below.',
        no_credits: 'The Base44 workspace is out of credits.',
      }[data.error];
      setError(why ?? 'Could not launch right now.');
      setFallback(true);
    } catch {
      setState('idle');
      setFallback(true);
    }
  };

  const handoff = async () => {
    const win = window.open(base44BuildUrl(prompt), '_blank');
    if (win) win.opener = null;
    onCopyPrompt?.(prompt);
  };

  const busy = state === 'creating' || state === 'building' || state === 'deploying';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Ship the fly's app">
      <div data-testid="ship-modal" className="w-full max-w-lg rounded-3xl border border-fuchsia-300/60 bg-[#070a18] p-6 shadow-[0_0_70px_-10px_rgba(232,121,249,0.9)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-fuchsia-300">App shipped 🚀</p>
            <h2 className="mt-1 text-2xl font-black text-white">{title}</h2>
            <p className="mt-1 text-sm text-slate-400">Your fly finished every builder task. Here&apos;s what it designed:</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>

        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/60 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {prompt}
        </pre>

        {state === 'live' && app?.url ? (
          <a
            href={app.url}
            target="_blank"
            rel="noreferrer"
            data-testid="app-live-url"
            className="mt-4 block rounded-2xl border border-lime-300/70 bg-lime-400/15 px-4 py-3 text-center font-black text-lime-50 hover:bg-lime-400/25"
          >
            🌐 Open {app.name ?? 'the app'} ↗
            <span className="mt-0.5 block break-all font-mono text-[11px] font-normal text-lime-200">{app.url}</span>
          </a>
        ) : realApps === false ? null : (
          <button
            type="button"
            onClick={launch}
            disabled={busy}
            data-testid="launch-real"
            className="mt-4 w-full rounded-2xl border border-fuchsia-200/70 bg-gradient-to-r from-fuchsia-500/40 to-cyan-500/40 px-4 py-3.5 font-black uppercase tracking-[0.14em] text-white shadow-[0_0_30px_-8px_rgba(232,121,249,0.9)] transition hover:brightness-125 disabled:opacity-60"
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <span className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white" /> {STATES[state]}
              </span>
            ) : (
              '🚀 Launch it on Base44 for real'
            )}
          </button>
        )}

        {error && <p className="mt-3 rounded-xl border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">{error}</p>}

        {fallback && (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-300">
            <p>
              {realApps === false
                ? 'Build it on Base44 in one click (real one-tap launches switch on once the server has a Base44 token):'
                : 'Build it yourself in one click:'}
            </p>
            <button
              type="button"
              onClick={handoff}
              data-testid="handoff-base44"
              className="mt-2 w-full rounded-xl border border-cyan-300/60 bg-cyan-400/10 px-3 py-2 font-black uppercase tracking-wider text-cyan-50 hover:bg-cyan-400/20"
            >
              🛠 Open in the Base44 builder (prompt copied)
            </button>
          </div>
        )}
        <p className="mt-3 text-center text-[10px] text-slate-600">Real launches are rate-limited and built from the fly&apos;s DNA only.</p>
      </div>
    </div>
  );
}
