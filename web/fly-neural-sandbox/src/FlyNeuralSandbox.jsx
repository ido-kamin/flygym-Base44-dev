// Fly Neural Sandbox: the top-level game component.
//
// React owns lifecycle and UI only. The simulation (Game), the 3D brain
// (BrainRenderer) and the 2D playground view are plain objects kept in a ref
// and driven by one requestAnimationFrame loop; the HUD is refreshed from a
// snapshot ~10x per second, and the Base44 DNA is mirrored into the URL hash.

import { useCallback, useEffect, useRef, useState } from 'react';

import ActionBar from './components/ActionBar.jsx';
import BodyView from './components/BodyView.jsx';
import BrainView from './components/BrainView.jsx';
import { ClaimDeploymentModal } from './components/ClaimDeployment.jsx';
import DnaPanel from './components/DnaPanel.jsx';
import { FlyCodeTerminal, FlyStatus } from './components/FlyCodeTerminal.jsx';
import { GameOverOverlay, Toast } from './components/Overlays.jsx';
import Playground from './components/Playground.jsx';
import TopHud from './components/TopHud.jsx';
import {
  bitsOf,
  decodeBase44,
  decodeFlyFromBase44,
  dnaHash,
  encodeBase44,
  extractDNA,
  HASH_KEY,
  packDNA,
  quantizePose,
  unpackDNA,
} from './lib/base44.js';
import { base44BuildUrl, flyAppPrompt } from './lib/base44App.js';
import { BrainRenderer } from './lib/brainRenderer.js';
import { BRAIN_NEURONS, VNC_NEURONS } from './lib/constants.js';
import { C } from './lib/connectome.js';
import { createPlaygroundView } from './lib/drawPlayground.js';
import { FlyTerminal, statusFor } from './lib/flycode.js';
import { FlyBody3D } from './lib/flyBody3D.js';
import { Game, PREDATOR_MAX } from './lib/game.js';
import { GENES, personality } from './lib/genome.js';
import { loadNeuroMechFly } from './lib/neuromechfly.js';

const HUD_INTERVAL = 0.1; // s
// history.replaceState is rate-limited by Safari (100 calls / 30 s): 2 Hz is safe
const HASH_INTERVAL = 0.5; // s
const DNA_HOLD_MS = 1400; // freeze a decoded fly briefly so the restored state is visible
const HIGH_SCORE_KEY = 'fly-neural-sandbox:high-score';
const STATUS_MIN_MS = 2400; // keep a status line up at least this long
const TERMINAL_LINE_MS = 110; // at most ~9 code lines per second

function readModeFromHash(hash) {
  try {
    return new URLSearchParams(hash.replace(/^#/, '')).get('mode') === 'vibe' ? 'vibe' : 'sugar';
  } catch {
    return 'sugar';
  }
}

/** `#dna=...` plus the theme, so a shared link opens in the same mode. */
function hashFor(engine, dna) {
  return engine.mode === 'vibe' ? `${dnaHash(dna)}&mode=vibe` : dnaHash(dna);
}

function readHighScore() {
  try {
    return Number(window.localStorage.getItem(HIGH_SCORE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeHighScore(v) {
  try {
    window.localStorage.setItem(HIGH_SCORE_KEY, String(v));
  } catch {
    /* storage unavailable (private mode); the high score is just not kept */
  }
}

/** Decode `#dna=...` from the current URL. */
function readDNAFromHash(hash) {
  if (!hash || !hash.includes(`${HASH_KEY}=`)) return { dna: null, error: null };
  try {
    return { dna: decodeFlyFromBase44(extractDNA(hash)), error: null };
  } catch (error) {
    return { dna: null, error };
  }
}

function writeHash(engine, dna, force = false) {
  if (dna === engine.lastHash && !force) return;
  engine.lastHash = dna;
  try {
    window.history.replaceState(window.history.state, '', hashFor(engine, dna));
  } catch {
    /* rate-limited; the next write catches up */
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // insecure context or permission denied: legacy fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Everything the HUD shows, derived from the live game in one pass. */
function snapshot(game, engine) {
  const pose = quantizePose(game.fly.x, game.fly.y, game.fly.theta);
  const value = packDNA({ weights: game.weights, score: game.score, ...pose });
  return {
    dna: encodeBase44(value),
    bits: bitsOf(value),
    pose,
    score: game.score,
    high: engine.high,
    energy: game.energy,
    generation: game.generation,
    weights: game.weights.slice(),
    personality: personality(game.weights),
    activity: Array.from(game.network.a),
    over: game.over,
    predators: game.predators.length,
    fps: engine.fps,
    changedGenes: engine.changedUntil > performance.now() ? engine.changedGenes : [],
    holding: engine.holdUntil > performance.now(),
    pipeline: game.pipeline,
    deployments: game.deployments,
    terminal: engine.terminal.lines.slice(-12),
    status: engine.status,
  };
}

const VNC_CLUSTERS = [C.T1, C.T2, C.T3];

/**
 * Activity shown in 3D: the connectome's rates, with each VNC neuromere's
 * rhythmic motor burst added while its legs are in swing (from the body CPG).
 */
function withVncRhythm(engine, activity) {
  const out = (engine.shownActivity ??= new Float32Array(activity.length));
  out.set(activity);
  const rhythm = engine.body?.rhythm;
  if (rhythm) {
    VNC_CLUSTERS.forEach((c, k) => {
      out[c] = activity[c] * (0.6 + 0.4 * rhythm[k]) + 0.45 * rhythm[k];
    });
  }
  return out;
}

/**
 * FlyCode terminal: one line per leg step. Steps come from the 3D body's CPG
 * (swing onsets, so the code visibly matches the legs) or, before the body has
 * loaded, from the 2D gait phase. Throttled so the stream stays readable.
 */
function streamFlyCode(engine, game, activity, now) {
  let leg = -1;
  const body = engine.body;
  if (body) {
    for (let i = 0; i < 6; i++) {
      if (body.swing[i] && !engine.prevSwing[i]) leg = i;
      engine.prevSwing[i] = body.swing[i];
    }
  } else {
    const g = Math.floor(game.fly.gait * 2);
    if (g !== engine.prevGait) leg = g % 6;
    engine.prevGait = g;
  }
  if (leg >= 0 && now - engine.lastLineAt > TERMINAL_LINE_MS && !game.over) {
    engine.lastLineAt = now;
    engine.terminal.step(leg, game, activity);
  }
}

/** Pick the sarcastic status line, holding each one for a minimum time. */
function updateStatus(engine, game, activity, now) {
  const recent = {};
  for (const [k, t] of Object.entries(engine.recent)) {
    if (now - t.at < 2600) recent[k] = t.value ?? true;
  }
  const next = statusFor(game, activity, recent);
  const cur = engine.status;
  if (!cur || next.text === cur.text) {
    engine.status = { ...next, at: cur?.at ?? now };
  } else if (recent.deployed || now - cur.at > STATUS_MIN_MS) {
    engine.status = { ...next, at: now };
  }
}

export default function FlyNeuralSandbox() {
  const brainHostRef = useRef(null);
  const bodyHostRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const armedRef = useRef(false);
  const [hud, setHud] = useState(null);
  const [armed, setArmed] = useState(false);
  const [toast, setToast] = useState(null);
  const [copied, setCopied] = useState(false);
  const [bodyStatus, setBodyStatus] = useState('loading');
  const [playback, setPlayback] = useState(0.25);
  const [mode, setMode] = useState(() => readModeFromHash(window.location.hash));
  const [claimOpen, setClaimOpen] = useState(false);

  const showToast = useCallback((text, tone = 'info') => {
    setToast({ id: `${Date.now()}-${Math.random()}`, text, tone });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    armedRef.current = armed;
  }, [armed]);

  // ---- engine lifecycle: one game, one brain, one playground, one loop ----
  useEffect(() => {
    const boot = readDNAFromHash(window.location.hash);
    const game = boot.dna ? new Game({ dna: boot.dna }) : new Game({ seed: (Math.random() * 2 ** 32) >>> 0 });
    const brain = new BrainRenderer(brainHostRef.current);
    const view = createPlaygroundView(canvasRef.current);
    const engine = {
      game,
      brain,
      view,
      body: null,
      high: readHighScore(),
      fps: 60,
      lastHash: '',
      holdUntil: boot.dna ? performance.now() + DNA_HOLD_MS : 0,
      changedGenes: [],
      changedUntil: 0,
      mode: readModeFromHash(window.location.hash),
      terminal: new FlyTerminal(),
      status: null,
      recent: {},
      lastLineAt: 0,
      prevSwing: new Array(6).fill(false),
      prevGait: 0,
    };
    engineRef.current = engine;
    view.setMode(engine.mode);
    const dna0 = game.toDNA();
    engine.terminal.reset(dna0, unpackDNA(decodeBase44(dna0)));

    if (boot.dna) {
      // the restored fly re-encodes to exactly the link it came from
      engine.lastHash = boot.dna.dna;
      showToast(`🧬 DNA ${boot.dna.dna} decoded — ${personality(game.weights).title} restored`, 'dna');
    } else if (boot.error) {
      showToast('⚠ Corrupted DNA link — spawned a fresh fly', 'warn');
    }
    setHud(snapshot(game, engine));

    // hook for automated checks (Playwright); read-only by convention
    window.__flySandbox = { game, brain, neurons: brain.pointCount, engine };

    // the NeuroMechFly body streams in after the brain (~1 MB of meshes)
    let disposed = false;
    loadNeuroMechFly(import.meta.env.BASE_URL)
      .then((asset) => {
        if (disposed) return;
        engine.body = new FlyBody3D(bodyHostRef.current, asset);
        setBodyStatus('ready');
      })
      .catch((err) => {
        console.error('NeuroMechFly body failed to load', err);
        if (!disposed) setBodyStatus('error');
      });

    let raf = 0;
    let last = performance.now();
    let hudClock = 0;
    // write the hash on the first frame, not at mount: under StrictMode's dev
    // double-mount the second pass would otherwise "decode" this fly's own DNA
    let hashClock = HASH_INTERVAL;
    let fpsFrames = 0;
    let fpsClock = 0;

    const tick = (now) => {
      const elapsed = Math.max(0, (now - last) / 1000);
      // clamp the simulated step so a stalled tab resumes in slow motion, not a teleport
      const dt = Math.min(0.1, elapsed);
      last = now;

      if (now >= engine.holdUntil) game.advance(dt);
      const events = game.drainEvents();
      brain.consume(events);
      view.consume(events);
      for (const ev of events) {
        engine.terminal.event(ev);
        if (ev.type === 'deployed') engine.recent.deployed = { at: now };
        else if (ev.type === 'stage') engine.recent.stage = { at: now, value: ev.stage };
        else if (ev.type === 'wrongStage') engine.recent.wrong = { at: now };
        else if (ev.type === 'hit') engine.recent.hit = { at: now };
        if (ev.type === 'deployed' && engine.mode === 'vibe') {
          showToast('🚀 Success! Fly just deployed an ERC-20 token on Base using pure muscle memory.', 'ok');
        }
        if (ev.type === 'eat' && game.score > engine.high) {
          engine.high = game.score;
          writeHighScore(engine.high);
        } else if (ev.type === 'levelup') {
          showToast(`✨ Generation ${ev.generation} reached`, 'dna');
        }
      }
      // the CPGs sit in the VNC: T1/T2/T3 burst with their legs' swing phases
      const shown = withVncRhythm(engine, game.network.a);
      brain.frame(dt, shown, game.weights, elapsed);
      engine.body?.frame(dt, game, brain.act);
      view.draw(game, dt);
      if (engine.mode === 'vibe') streamFlyCode(engine, game, brain.act, now);

      fpsFrames++;
      fpsClock += elapsed;
      if (fpsClock >= 0.5) {
        engine.fps = Math.round(fpsFrames / fpsClock);
        fpsFrames = 0;
        fpsClock = 0;
      }
      hudClock += dt;
      if (hudClock >= HUD_INTERVAL) {
        hudClock = 0;
        updateStatus(engine, game, brain.act, now);
        setHud(snapshot(game, engine));
      }
      hashClock += dt;
      if (hashClock >= HASH_INTERVAL) {
        hashClock = 0;
        writeHash(engine, game.toDNA());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // a pasted / edited link while the page is open
    const onHashChange = () => {
      const raw = extractDNA(window.location.hash);
      if (!raw || raw === engine.lastHash) return;
      try {
        const dna = decodeFlyFromBase44(raw);
        game.loadDNA(dna);
        engine.terminal.reset(raw, dna);
        engine.lastHash = raw;
        engine.holdUntil = performance.now() + DNA_HOLD_MS;
        brain.consume([{ type: 'restart' }]);
        showToast(`🧬 DNA ${raw} loaded — ${personality(game.weights).title}`, 'dna');
      } catch {
        showToast('⚠ That DNA is corrupted (checksum failed)', 'warn');
        writeHash(engine, game.toDNA());
      }
    };
    window.addEventListener('hashchange', onHashChange);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('hashchange', onHashChange);
      engine.body?.dispose();
      brain.dispose();
      view.dispose();
      engineRef.current = null;
      delete window.__flySandbox;
    };
  }, [showToast]);

  // ---- actions ----
  const refresh = useCallback(() => {
    const e = engineRef.current;
    if (e) setHud(snapshot(e.game, e));
  }, []);

  const onCopy = useCallback(async () => {
    const e = engineRef.current;
    if (!e) return;
    const dna = e.game.toDNA();
    writeHash(e, dna);
    const { origin, pathname, search } = window.location;
    const url = `${origin}${pathname}${search}${hashFor(e, dna)}`;
    const text = `Look at my Super Fly! Score: ${e.game.score}. Can you beat its DNA? ${url}`;
    const ok = await copyText(text);
    setCopied(ok);
    showToast(ok ? `🧬 Viral DNA copied — ${dna}` : `Copy blocked — share this: ${url}`, ok ? 'ok' : 'warn');
  }, [showToast]);

  const onMutate = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const before = e.game.weights.slice();
    const changed = e.game.mutate();
    e.changedGenes = changed;
    e.changedUntil = performance.now() + 1600;
    const diff = changed
      .map((i) => `${GENES[i].name} ${before[i].toString(16).toUpperCase()}→${e.game.weights[i].toString(16).toUpperCase()}`)
      .join(', ');
    showToast(`☢ Mutation: ${diff} · now ${personality(e.game.weights).title}`, 'dna');
    refresh();
  }, [refresh, showToast]);

  const onRestart = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    e.game.restart();
    e.holdUntil = 0;
    refresh();
  }, [refresh]);

  const onMutateRetry = useCallback(() => {
    onMutate();
    onRestart();
  }, [onMutate, onRestart]);

  const onClear = useCallback(() => {
    engineRef.current?.game.clearPredators();
    refresh();
  }, [refresh]);

  const onTogglePredator = useCallback(() => setArmed((a) => !a), []);

  const onMode = useCallback((m) => {
    setMode(m);
    const e = engineRef.current;
    if (!e) return;
    e.mode = m;
    e.view.setMode(m);
    writeHash(e, e.game.toDNA(), true);
  }, []);

  const onBuildBase44 = useCallback(async () => {
    const e = engineRef.current;
    if (!e) return;
    const dna = e.game.toDNA();
    const { origin, pathname, search } = window.location;
    const { title, prompt } = flyAppPrompt(dna, e.game.weights, {
      score: e.game.score,
      deployments: e.game.deployments,
      url: `${origin}${pathname}${search}${hashFor(e, dna)}`,
    });
    // open first, inside the click gesture, so the popup is not blocked
    const win = window.open(base44BuildUrl(prompt), '_blank');
    if (win) win.opener = null;
    const copiedPrompt = await copyText(prompt);
    showToast(
      `🛠 "${title}" → Base44 builder${win ? '' : ' (popup blocked)'}${copiedPrompt ? ' · prompt copied, paste it if not prefilled' : ''}`,
      'dna',
    );
  }, [showToast]);

  const onPlaygroundDown = useCallback(
    (ev) => {
      const e = engineRef.current;
      if (!e || e.game.over) return;
      const p = e.view.clientToWorld(ev.clientX, ev.clientY);
      if (!p) return;
      if (armedRef.current) {
        if (!e.game.addPredator(p.x, p.y)) showToast(`Max ${PREDATOR_MAX} predators — clear some first`, 'warn');
      } else if (!e.game.addSugar(p.x, p.y)) {
        showToast('The arena is full of sugar already', 'info');
      }
      refresh();
    },
    [refresh, showToast],
  );

  const onPlaygroundMove = useCallback((ev) => {
    const e = engineRef.current;
    if (!e) return;
    const p = e.view.clientToWorld(ev.clientX, ev.clientY);
    e.view.setCursor(p ? { ...p, armed: armedRef.current } : null);
  }, []);

  const onPlaygroundLeave = useCallback(() => engineRef.current?.view.setCursor(null), []);

  useEffect(() => {
    engineRef.current?.body?.setPlayback(playback);
  }, [playback, bodyStatus]);

  const pick = useCallback((x, y) => engineRef.current?.brain.pick(x, y) ?? null, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.target instanceof HTMLInputElement) return;
      const k = ev.key.toLowerCase();
      if (k === 'm') onMutate();
      else if (k === 'p') onTogglePredator();
      else if (k === 'r') onRestart();
      else if (k === 'escape') setArmed(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onMutate, onRestart, onTogglePredator]);

  return (
    <div className="min-h-screen bg-void bg-[radial-gradient(ellipse_at_top_left,rgba(34,211,238,0.08),transparent_45%),radial-gradient(ellipse_at_bottom_right,rgba(232,121,249,0.08),transparent_45%)] text-slate-200 lg:flex lg:h-screen lg:flex-col">
      {hud && <TopHud hud={hud} mode={mode} onMode={onMode} />}

      <main className="grid flex-1 gap-3 p-3 lg:min-h-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(300px,340px)]">
        <div className="grid min-h-0 gap-3 lg:grid-rows-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <BrainView ref={brainHostRef} activity={hud?.activity ?? []} pick={pick} holding={hud?.holding} />
          <BodyView ref={bodyHostRef} status={bodyStatus} playback={playback} onPlayback={setPlayback} />
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Playground
            ref={canvasRef}
            armed={armed}
            onPointerDown={onPlaygroundDown}
            onPointerMove={onPlaygroundMove}
            onPointerLeave={onPlaygroundLeave}
            mode={mode}
            dna={hud?.dna}
          >
            {mode === 'vibe' && hud && (
              <>
                <FlyStatus status={hud.status} />
                <FlyCodeTerminal dna={hud.dna} weights={hud.weights} lines={hud.terminal} />
              </>
            )}
            {hud?.over && <GameOverOverlay hud={hud} onRestart={onRestart} onMutateRetry={onMutateRetry} onCopy={onCopy} />}
          </Playground>
          <ActionBar
            armed={armed}
            predators={hud?.predators ?? 0}
            maxPredators={PREDATOR_MAX}
            onCopy={onCopy}
            onMutate={onMutate}
            onTogglePredator={onTogglePredator}
            onClear={onClear}
            onRestart={onRestart}
          />
        </div>

        {hud && (
          <DnaPanel hud={hud} mode={mode} onCopy={onCopy} copied={copied} onBuild={onBuildBase44}>
            {mode === 'vibe' && (
              <button
                type="button"
                onClick={() => setClaimOpen(true)}
                data-testid="claim-deployment"
                className="mt-2 w-full rounded-xl border border-[#3b7bff]/70 bg-[#0052ff]/20 px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-white shadow-[0_0_20px_-6px_rgba(0,82,255,0.9)] transition hover:bg-[#0052ff]/35 active:scale-[0.98]"
              >
                ⛓ Claim Fly&apos;s Deployment
              </button>
            )}
          </DnaPanel>
        )}
        {claimOpen && hud && <ClaimDeploymentModal dna={hud.dna} score={hud.score} onClose={() => setClaimOpen(false)} />}
      </main>

      <footer className="px-4 pb-3 text-center text-[10px] leading-relaxed text-slate-600">
        {BRAIN_NEURONS.toLocaleString('en-US')} brain neurons (FlyWire) + {VNC_NEURONS.toLocaleString('en-US')} nerve-cord neurons
        (MANC), sized region by region from the published FlyWire annotations and placed procedurally on real neuropil
        layouts, not FlyWire morphology. Behaviour comes from a 16-cluster rate model of the Sensory → Intrinsic → Motor
        pathways. The body is NeuroMechFly v2 from FlyGym, walking with flygym&apos;s CPG and preprogrammed steps, with
        speed, turning and posture calibrated in MuJoCo physics.
      </footer>

      <Toast toast={toast} />
    </div>
  );
}
