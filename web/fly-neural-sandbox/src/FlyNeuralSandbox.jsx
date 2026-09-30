// Fly Neural Sandbox: the top-level game component.
//
// React owns lifecycle and UI only. The simulation (Game), the 3D brain
// (BrainRenderer) and the 2D playground view are plain objects kept in a ref
// and driven by one requestAnimationFrame loop; the HUD is refreshed from a
// snapshot ~10x per second, and the Base44 DNA is mirrored into the URL hash.

import { useCallback, useEffect, useRef, useState } from 'react';

import ActionBar from './components/ActionBar.jsx';
import BrainView from './components/BrainView.jsx';
import DnaPanel from './components/DnaPanel.jsx';
import { GameOverOverlay, Toast } from './components/Overlays.jsx';
import Playground from './components/Playground.jsx';
import TopHud from './components/TopHud.jsx';
import {
  bitsOf,
  decodeFlyFromBase44,
  dnaHash,
  encodeBase44,
  extractDNA,
  HASH_KEY,
  packDNA,
  quantizePose,
} from './lib/base44.js';
import { BrainRenderer } from './lib/brainRenderer.js';
import { NEURON_COUNT } from './lib/constants.js';
import { createPlaygroundView } from './lib/drawPlayground.js';
import { Game, PREDATOR_MAX } from './lib/game.js';
import { GENES, personality } from './lib/genome.js';

const HUD_INTERVAL = 0.1; // s
// history.replaceState is rate-limited by Safari (100 calls / 30 s): 2 Hz is safe
const HASH_INTERVAL = 0.5; // s
const DNA_HOLD_MS = 1400; // freeze a decoded fly briefly so the restored state is visible
const HIGH_SCORE_KEY = 'fly-neural-sandbox:high-score';

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

function writeHash(engine, dna) {
  if (dna === engine.lastHash) return;
  engine.lastHash = dna;
  try {
    window.history.replaceState(window.history.state, '', dnaHash(dna));
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
  };
}

export default function FlyNeuralSandbox() {
  const brainHostRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const armedRef = useRef(false);
  const [hud, setHud] = useState(null);
  const [armed, setArmed] = useState(false);
  const [toast, setToast] = useState(null);
  const [copied, setCopied] = useState(false);

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
      high: readHighScore(),
      fps: 60,
      lastHash: '',
      holdUntil: boot.dna ? performance.now() + DNA_HOLD_MS : 0,
      changedGenes: [],
      changedUntil: 0,
    };
    engineRef.current = engine;

    if (boot.dna) {
      // the restored fly re-encodes to exactly the link it came from
      engine.lastHash = boot.dna.dna;
      showToast(`🧬 DNA ${boot.dna.dna} decoded — ${personality(game.weights).title} restored`, 'dna');
    } else if (boot.error) {
      showToast('⚠ Corrupted DNA link — spawned a fresh fly', 'warn');
    }
    setHud(snapshot(game, engine));

    // hook for automated checks (Playwright); read-only by convention
    window.__flySandbox = { game, brain, neurons: brain.pointCount };

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
        if (ev.type === 'eat' && game.score > engine.high) {
          engine.high = game.score;
          writeHighScore(engine.high);
        } else if (ev.type === 'levelup') {
          showToast(`✨ Generation ${ev.generation} reached`, 'dna');
        }
      }
      brain.frame(dt, game.network.a, game.weights, elapsed);
      view.draw(game, dt);

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
      cancelAnimationFrame(raf);
      window.removeEventListener('hashchange', onHashChange);
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
    const url = `${origin}${pathname}${search}${dnaHash(dna)}`;
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
      {hud && <TopHud hud={hud} />}

      <main className="grid flex-1 gap-3 p-3 lg:min-h-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(300px,340px)]">
        <BrainView ref={brainHostRef} activity={hud?.activity ?? []} pick={pick} holding={hud?.holding} />

        <div className="flex min-h-0 flex-col gap-3">
          <Playground
            ref={canvasRef}
            armed={armed}
            onPointerDown={onPlaygroundDown}
            onPointerMove={onPlaygroundMove}
            onPointerLeave={onPlaygroundLeave}
          >
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

        {hud && <DnaPanel hud={hud} onCopy={onCopy} copied={copied} />}
      </main>

      <footer className="px-4 pb-3 text-center text-[10px] leading-relaxed text-slate-600">
        {NEURON_COUNT.toLocaleString('en-US')} neurons (the FlyWire whole-brain count) placed procedurally on real neuropil
        layouts — an artistic, anatomically inspired model, not FlyWire morphology. Behaviour is driven by a 16-cluster rate
        model of the Sensory → Intrinsic → Motor connectome. Inspired by FlyWire and NeuroMechFly / FlyGym.
      </footer>

      <Toast toast={toast} />
    </div>
  );
}
