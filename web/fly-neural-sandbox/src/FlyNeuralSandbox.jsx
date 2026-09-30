// Fly Neural Sandbox: the top-level game component.
//
// React owns lifecycle and UI only. The simulation (Game), the 3D brain
// (BrainRenderer), the 3D NeuroMechFly body (FlyBody3D) and the fly-driven
// browser view are plain objects kept in a ref and driven by one
// requestAnimationFrame loop; the HUD is refreshed from a snapshot ~10x per
// second, and the Base44 DNA (+ mission + name) is mirrored into the URL hash.

import { useCallback, useEffect, useRef, useState } from 'react';

import BodyView from './components/BodyView.jsx';
import BottomDock from './components/BottomDock.jsx';
import BrainView from './components/BrainView.jsx';
import { ClaimDeploymentModal } from './components/ClaimDeployment.jsx';
import DnaPanel from './components/DnaPanel.jsx';
import { FlyCodeTerminal, FlyStatus } from './components/FlyCodeTerminal.jsx';
import HatchScreen from './components/HatchScreen.jsx';
import LabDrawer from './components/LabDrawer.jsx';
import MissionStage from './components/MissionStage.jsx';
import { GameOverOverlay, Toast } from './components/Overlays.jsx';
import ShipModal from './components/ShipModal.jsx';
import TopBar from './components/TopBar.jsx';
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
import { C } from './lib/connectome.js';
import { createPlaygroundView } from './lib/drawPlayground.js';
import { FlyTerminal, statusFor } from './lib/flycode.js';
import { FlyBody3D } from './lib/flyBody3D.js';
import { Game, MISSIONS, PREDATOR_MAX } from './lib/game.js';
import { GENES, mulberry32, personality } from './lib/genome.js';
import { loadNeuroMechFly } from './lib/neuromechfly.js';
import { levelOf, loadProfile, MISSION_META, randomFlyName, saveProfile, XP } from './lib/progress.js';
import { nextQuery, searchWeb } from './lib/webSearch.js';

const HUD_INTERVAL = 0.1; // s
// history.replaceState is rate-limited by Safari (100 calls / 30 s): 2 Hz is safe
const HASH_INTERVAL = 0.5; // s
const DNA_HOLD_MS = 1400; // freeze a decoded fly briefly so the restored state is visible
const STATUS_MIN_MS = 2400; // keep a status line up at least this long
const TERMINAL_LINE_MS = 110; // at most ~9 log lines per second
const TRAIN_COOLDOWN_MS = 450;
const VNC_CLUSTERS = [C.T1, C.T2, C.T3];

function hashParams(hash) {
  try {
    return new URLSearchParams(hash.replace(/^#/, ''));
  } catch {
    return new URLSearchParams();
  }
}

/** Mission from the hash (`mission=`, or the older `mode=vibe`). */
function readMission(hash) {
  const p = hashParams(hash);
  const m = p.get('mission');
  if (m && MISSIONS[m]) return m;
  return p.get('mode') === 'vibe' ? 'vibe' : null;
}

/** `#dna=...&mission=...&name=...`: a shared link opens the same fly, mission and name. */
function hashFor(engine, dna) {
  const extra = new URLSearchParams();
  if (engine.mission !== 'forage') extra.set('mission', engine.mission);
  if (engine.profile?.name) extra.set('name', engine.profile.name);
  const rest = extra.toString();
  return rest ? `${dnaHash(dna)}&${rest}` : dnaHash(dna);
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

function shareUrl(engine, dna) {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${hashFor(engine, dna)}`;
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

/** Pick the status line, holding each one for a minimum time. */
function updateStatus(engine, game, activity, now) {
  const recent = {};
  for (const [k, t] of Object.entries(engine.recent)) {
    if (now - t.at < 2600) recent[k] = t.value ?? true;
  }
  const next = statusFor(game, activity, recent);
  const cur = engine.status;
  if (!cur || next.text === cur.text) {
    engine.status = { ...next, at: cur?.at ?? now };
  } else if (recent.deployed || recent.shipped || now - cur.at > STATUS_MIN_MS) {
    engine.status = { ...next, at: now };
  }
}

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
 * Mission log: one line per leg step. Steps come from the 3D body's CPG (swing
 * onsets, so the log visibly matches the legs) or, before the body has loaded,
 * from the 2D gait phase. Throttled so the stream stays readable.
 */
function streamLog(engine, game, activity, now) {
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
  const [mission, setMissionState] = useState(() => readMission(window.location.hash) ?? 'build');
  const [profile, setProfile] = useState(() => {
    const p = loadProfile();
    const shared = hashParams(window.location.hash).get('name');
    return p ?? { name: shared?.slice(0, 32) || randomFlyName(), xp: 0, hatched: false };
  });
  const [hatchOpen, setHatchOpen] = useState(() => !loadProfile()?.hatched);
  const [labOpen, setLabOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [stats, setStats] = useState({ eaten: 0, reads: 0, trained: 0 });
  const [notes, setNotes] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const adoptingRef = useRef(Boolean(readDNAFromHash(window.location.hash).dna));

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

  // ---- engine lifecycle: one game, one brain, one body, one browser view, one loop ----
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
      high: 0,
      fps: 60,
      lastHash: '',
      holdUntil: boot.dna ? performance.now() + DNA_HOLD_MS : 0,
      changedGenes: [],
      changedUntil: 0,
      mission: readMission(window.location.hash) ?? 'build',
      profile: loadProfile() ?? { name: hashParams(window.location.hash).get('name')?.slice(0, 32) || randomFlyName(), xp: 0, hatched: false },
      terminal: new FlyTerminal(),
      status: null,
      recent: {},
      lastLineAt: 0,
      prevSwing: new Array(6).fill(false),
      prevGait: 0,
      stats: { eaten: 0, reads: 0, trained: 0 },
      lastRead: null,
      searching: false,
      rng: mulberry32((Math.random() * 2 ** 32) >>> 0),
      lastTrainAt: 0,
    };
    engineRef.current = engine;
    game.setMission(engine.mission);
    const dna0 = game.toDNA();
    engine.terminal.reset(dna0, unpackDNA(decodeBase44(dna0)));

    if (boot.dna) {
      engine.lastHash = boot.dna.dna;
      if (engine.profile.hatched) showToast(`🧬 Fly ${boot.dna.dna} loaded — ${personality(game.weights).title}`, 'dna');
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

    const gainXp = (amount) => {
      const before = levelOf(engine.profile.xp);
      engine.profile = { ...engine.profile, xp: engine.profile.xp + amount };
      const after = levelOf(engine.profile.xp);
      if (after > before) showToast(`⭐ ${engine.profile.name} reached level ${after}!`, 'dna');
    };

    const runSearch = async () => {
      if (engine.searching) return;
      engine.searching = true;
      const q = nextQuery(game.weights, game.eligibility, engine.lastRead, engine.rng);
      engine.recent.query = { at: performance.now(), value: q };
      setSearchQuery(q);
      try {
        const results = await searchWeb(q);
        if (!disposed && game.mission === 'search') {
          if (results.length) game.setSearchResults(q, results);
          else showToast(`No results for "${q}" — the fly will try again`, 'info');
        }
      } catch {
        if (!disposed) showToast('🔌 The fly lost its internet connection', 'warn');
      } finally {
        engine.searching = false;
      }
    };

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
        switch (ev.type) {
          case 'eat':
            engine.stats.eaten++;
            if (game.score > engine.high) engine.high = game.score;
            gainXp(XP.eat);
            break;
          case 'stage':
            engine.recent.stage = { at: now, value: ev.stage };
            gainXp(XP.stage);
            break;
          case 'wrongStage':
            engine.recent.wrong = { at: now };
            break;
          case 'hit':
            engine.recent.hit = { at: now };
            break;
          case 'deployed':
            engine.recent.deployed = { at: now };
            gainXp(XP.deployed);
            showToast('🚀 Success! Fly just deployed an ERC-20 token on Base using pure muscle memory.', 'ok');
            break;
          case 'shipped':
            engine.recent.shipped = { at: now };
            gainXp(XP.shipped);
            setShipOpen(true);
            break;
          case 'needSearch':
            runSearch();
            break;
          case 'read':
            engine.stats.reads++;
            engine.lastRead = ev.result;
            engine.recent.read = { at: now, value: ev.result.title };
            gainXp(XP.read);
            setNotes((n) => [ev.result, ...n.filter((x) => x.url !== ev.result.url)].slice(0, 12));
            break;
          case 'levelup':
            gainXp(XP.levelup);
            break;
          default:
            break;
        }
      }
      // the CPGs sit in the VNC: T1/T2/T3 burst with their legs' swing phases
      const shown = withVncRhythm(engine, game.network.a);
      brain.frame(dt, shown, game.weights, elapsed);
      engine.body?.frame(dt, game, brain.act);
      view.draw(game, dt);
      streamLog(engine, game, brain.act, now);

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
        setStats({ ...engine.stats });
        setProfile((p) => (p.xp === engine.profile.xp && p.name === engine.profile.name ? p : engine.profile));
      }
      hashClock += dt;
      if (hashClock >= HASH_INTERVAL) {
        hashClock = 0;
        writeHash(engine, game.toDNA());
        if (engine.profile.hatched) saveProfile(engine.profile);
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
        game.setMission(engine.mission);
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

  const onMission = useCallback(
    (m) => {
      const e = engineRef.current;
      setMissionState(m);
      setSearchQuery('');
      if (!e) return;
      e.mission = m;
      e.game.setMission(m);
      writeHash(e, e.game.toDNA(), true);
      showToast(`${MISSION_META[m].icon} Mission: ${MISSION_META[m].label}`, 'dna');
      refresh();
    },
    [refresh, showToast],
  );

  const onHatch = useCallback(
    ({ name, mission: m, weights }) => {
      const e = engineRef.current;
      setHatchOpen(false);
      if (!e) return;
      if (weights) e.game.reset((Math.random() * 2 ** 32) >>> 0, weights, 0);
      e.profile = { ...e.profile, name, hatched: true };
      saveProfile(e.profile);
      setProfile(e.profile);
      e.brain.consume([{ type: 'levelup', generation: 1 }]);
      onMission(m);
      showToast(`🐣 ${name} hatched! ${MISSION_META[m].icon} First mission: ${MISSION_META[m].label}`, 'ok');
    },
    [onMission, showToast],
  );

  const onCopy = useCallback(async () => {
    const e = engineRef.current;
    if (!e) return;
    const dna = e.game.toDNA();
    writeHash(e, dna, true);
    const text = `Look at my Super Fly ${e.profile.name}! Score: ${e.game.score}. Can you beat its DNA? ${shareUrl(e, dna)}`;
    const ok = await copyText(text);
    setCopied(ok);
    showToast(ok ? `🧬 Viral DNA copied — ${dna}` : `Copy blocked — share this: ${shareUrl(e, dna)}`, ok ? 'ok' : 'warn');
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

  const train = useCallback(
    (reward) => {
      const e = engineRef.current;
      if (!e || e.game.over) return;
      const now = performance.now();
      if (now - e.lastTrainAt < TRAIN_COOLDOWN_MS) return;
      e.lastTrainAt = now;
      const changes = e.game.train(reward);
      e.stats.trained++;
      e.recent[reward > 0 ? 'trainedGood' : 'trainedBad'] = { at: now };
      e.profile = { ...e.profile, xp: e.profile.xp + XP.trained };
      if (changes.length) {
        e.changedGenes = changes.map((c) => c.gene);
        e.changedUntil = now + 1600;
        showToast(
          `🧠 Learned! ${changes.map((c) => `${GENES[c.gene].name} ${c.delta > 0 ? '↑' : '↓'}`).join(', ')} · now ${personality(e.game.weights).title}`,
          reward > 0 ? 'ok' : 'warn',
        );
      }
      refresh();
    },
    [refresh, showToast],
  );
  const onGood = useCallback(() => train(1), [train]);
  const onBad = useCallback(() => train(-1), [train]);

  const onRestart = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    e.game.restart();
    e.game.setMission(e.mission);
    e.holdUntil = 0;
    refresh();
  }, [refresh]);

  const onMutateRetry = useCallback(() => {
    onMutate();
    onRestart();
  }, [onMutate, onRestart]);

  const onTogglePredator = useCallback(() => setArmed((a) => !a), []);

  const onBuildBase44 = useCallback(async () => {
    const e = engineRef.current;
    if (!e) return;
    const dna = e.game.toDNA();
    const { title, prompt } = flyAppPrompt(dna, e.game.weights, {
      score: e.game.score,
      deployments: e.game.deployments,
      url: shareUrl(e, dna),
    });
    // open first, inside the click gesture, so the popup is not blocked
    const win = window.open(base44BuildUrl(prompt), '_blank');
    if (win) win.opener = null;
    const copiedPrompt = await copyText(prompt);
    showToast(`🛠 "${title}" → Base44 builder${copiedPrompt ? ' · prompt copied, paste it if not prefilled' : ''}`, 'dna');
  }, [showToast]);

  const onCopyPrompt = useCallback(
    async (prompt) => {
      const ok = await copyText(prompt);
      if (ok) showToast('📋 Prompt copied — paste it into the Base44 builder if it is not prefilled', 'dna');
    },
    [showToast],
  );

  const onPlaygroundDown = useCallback(
    (ev) => {
      const e = engineRef.current;
      if (!e || e.game.over) return;
      const p = e.view.clientToWorld(ev.clientX, ev.clientY);
      if (!p) return;
      if (armedRef.current) {
        if (!e.game.addPredator(p.x, p.y)) showToast(`Max ${PREDATOR_MAX} spiders — that's plenty`, 'warn');
      } else if (!e.game.addSugar(p.x, p.y)) {
        showToast('The arena is full already', 'info');
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

  useEffect(() => {
    engineRef.current?.body?.setPlayback(playback);
  }, [playback, bodyStatus]);

  // keyboard shortcuts (ignored while typing a name)
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.target instanceof HTMLInputElement) return;
      const k = ev.key.toLowerCase();
      if (k === 'm') onMutate();
      else if (k === 'p') onTogglePredator();
      else if (k === 'r') onRestart();
      else if (k === 'g') onGood();
      else if (k === 'b') onBad();
      else if (k === 'l') setLabOpen((o) => !o);
      else if (['1', '2', '3', '4'].includes(k)) onMission(Object.keys(MISSION_META)[Number(k) - 1]);
      else if (k === 'escape') {
        setArmed(false);
        setLabOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onMutate, onRestart, onTogglePredator, onGood, onBad, onMission]);

  const share = hud && engineRef.current ? shareUrl(engineRef.current, hud.dna) : '';

  return (
    <div className="min-h-screen bg-void bg-[radial-gradient(ellipse_at_top_left,rgba(34,211,238,0.10),transparent_45%),radial-gradient(ellipse_at_bottom_right,rgba(232,121,249,0.10),transparent_45%)] text-slate-200 lg:flex lg:h-screen lg:flex-col">
      {hud && (
        <TopBar
          hud={hud}
          profile={profile}
          mission={mission}
          onMission={onMission}
          onLab={() => setLabOpen(true)}
          onShare={onCopy}
          copied={copied}
        />
      )}

      <main className="grid flex-1 gap-3 p-3 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(300px,27vw)]">
        <div className="flex min-h-0 flex-col gap-3">
          <MissionStage
            ref={canvasRef}
            mission={mission}
            hud={hud ?? { dna: '' }}
            searchQuery={searchQuery}
            armed={armed}
            onPointerDown={onPlaygroundDown}
            onPointerMove={onPlaygroundMove}
            onPointerLeave={onPlaygroundLeave}
          >
            {hud && (
              <>
                <FlyStatus status={hud.status} />
                <FlyCodeTerminal dna={hud.dna} weights={hud.weights} lines={hud.terminal} mission={mission} />
              </>
            )}
            {hud?.over && <GameOverOverlay hud={hud} onRestart={onRestart} onMutateRetry={onMutateRetry} onCopy={onCopy} />}
          </MissionStage>
          {hud && (
            <BottomDock
              hud={hud}
              mission={mission}
              stats={stats}
              armed={armed}
              onGood={onGood}
              onBad={onBad}
              onTogglePredator={onTogglePredator}
              onMutate={onMutate}
              onRestart={onRestart}
              onShip={() => setShipOpen(true)}
            />
          )}
        </div>

        <aside className="grid min-h-0 gap-3 lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
          <BodyView ref={bodyHostRef} status={bodyStatus} playback={playback} onPlayback={setPlayback} />
          <BrainView ref={brainHostRef} activity={hud?.activity ?? []} pick={pick} holding={hud?.holding} />
        </aside>
      </main>

      <LabDrawer open={labOpen} onClose={() => setLabOpen(false)} notes={notes}>
        {hud && (
          <DnaPanel hud={hud} mode={mission === 'vibe' ? 'vibe' : 'sugar'} onCopy={onCopy} copied={copied} onBuild={onBuildBase44}>
            {mission === 'vibe' && (
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
      </LabDrawer>

      {claimOpen && hud && <ClaimDeploymentModal dna={hud.dna} score={hud.score} onClose={() => setClaimOpen(false)} />}
      {shipOpen && hud && (
        <ShipModal
          dna={hud.dna}
          weights={hud.weights}
          score={hud.score}
          deployments={hud.deployments}
          shareUrl={share}
          onClose={() => setShipOpen(false)}
          onCopyPrompt={onCopyPrompt}
        />
      )}
      {hatchOpen && hud && (
        <HatchScreen
          defaultName={profile.name}
          adopting={adoptingRef.current}
          dna={hud.dna}
          defaultMission={mission}
          onHatch={onHatch}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}
