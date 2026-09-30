// Fly Neural Sandbox: the top-level game component.
//
// React owns lifecycle and UI only. The simulation (Game), the 3D brain
// (BrainRenderer), the NeuroMechFly world (FlyBody3D), the mission map and the
// real FlyWire brain (RealBrain, a whole-brain LIF model in a Web Worker) are
// plain objects kept in a ref and driven by one requestAnimationFrame loop; the
// HUD is refreshed from a snapshot ~10x per second, and the Base44 DNA
// (+ mission + name) is mirrored into the URL hash.

import { useCallback, useEffect, useRef, useState } from 'react';

import BodyView from './components/BodyView.jsx';
import BottomDock from './components/BottomDock.jsx';
import BrainView from './components/BrainView.jsx';
import { ClaimDeploymentModal } from './components/ClaimDeployment.jsx';
import DnaPanel from './components/DnaPanel.jsx';
import { FlyCodeTerminal, FlyStatus } from './components/FlyCodeTerminal.jsx';
import HatchScreen from './components/HatchScreen.jsx';
import HomeScreen from './components/HomeScreen.jsx';
import SandboxPanel from './components/SandboxPanel.jsx';
import LabDrawer from './components/LabDrawer.jsx';
import LearningPanel from './components/LearningPanel.jsx';
import NeuralControls from './components/NeuralControls.jsx';
import ProofPanel from './components/ProofPanel.jsx';
import SidePanel from './components/SidePanel.jsx';
import MissionStage from './components/MissionStage.jsx';
import { GameOverOverlay, Toast } from './components/Overlays.jsx';
import ShipModal from './components/ShipModal.jsx';
import TopBar, { BUILD_MISSIONS } from './components/TopBar.jsx';
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
import { FlyBody3D, MM_PER_UNIT } from './lib/flyBody3D.js';
import { Game, MAX_SPEED, MAX_TURN, MISSIONS, PREDATOR_MAX } from './lib/game.js';
import { GENES, mulberry32, personality } from './lib/genome.js';
import { loadNeuroMechFly } from './lib/neuromechfly.js';
import { levelOf, loadProfile, MISSION_META, randomFlyName, saveProfile, XP } from './lib/progress.js';
import { RealBrain } from './lib/realBrain.js';
import { nextQuery, searchWeb } from './lib/webSearch.js';

const HUD_INTERVAL = 0.1; // s
// history.replaceState is rate-limited by Safari (100 calls / 30 s): 2 Hz is safe
const HASH_INTERVAL = 0.5; // s
const DNA_HOLD_MS = 1400; // freeze a decoded fly briefly so the restored state is visible
const STATUS_MIN_MS = 2400; // keep a status line up at least this long
const TERMINAL_LINE_MS = 110; // at most ~9 log lines per second
const TRAIN_COOLDOWN_MS = 450;
const VNC_CLUSTERS = [C.T1, C.T2, C.T3];
const SENSE_INTERVAL = 0.05; // s, senses -> real brain at 20 Hz
const REAL_HZ_FULL = 12; // a region's mean rate (Hz) shown as fully active
const STEER_HZ = 80; // DNa02 stimulation while a steer control is held
const REWARD_MS = 400; // PAM dopamine pulse
const EXPERIMENT_TIMEOUT_MS = 20000;

/** The three modes and the mission each one plays. */
function modeOf(mission) {
  if (mission === 'sandbox') return 'sandbox';
  if (mission === 'forage') return 'train';
  return 'build';
}

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
    behaviour: game.behaviour,
    byBrain: Boolean(game.brainMotor),
    motorMode: game.motorMode,
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
  // brain regions: the real connectome's mean firing rates, once it runs
  const clusters = engine.real?.frame?.clusters;
  if (clusters) {
    for (let c = 0; c < C.T1; c++) out[c] = Math.max(0.3 * activity[c], Math.min(1.5, clusters[c] / REAL_HZ_FULL));
  }
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
  const toolRef = useRef('sugar');
  const [hud, setHud] = useState(null);
  // what a click on the floor drops: sugar | spider | odorA | odorB
  const [tool, setTool] = useState('sugar');
  const armed = tool === 'spider';
  const [toast, setToast] = useState(null);
  const [copied, setCopied] = useState(false);
  const [bodyStatus, setBodyStatus] = useState('loading');
  const [playback, setPlayback] = useState(1);
  const [real, setReal] = useState({ status: 'loading', progress: 0 });
  const [motorMode, setMotorMode] = useState('neurons');
  const [explore, setExplore] = useState(0);
  const [lesions, setLesions] = useState({});
  const [sideTab, setSideTab] = useState(() => {
    const m = readMission(window.location.hash);
    return m === 'sandbox' ? 'sandbox' : m === 'forage' ? 'learn' : 'proof';
  });
  const [experiments, setExperiments] = useState([]);
  const [motor, setMotor] = useState(null);
  const [mission, setMissionState] = useState(() => readMission(window.location.hash) ?? 'build');
  const [profile, setProfile] = useState(() => {
    const p = loadProfile();
    const shared = hashParams(window.location.hash).get('name');
    return p ?? { name: shared?.slice(0, 32) || randomFlyName(), xp: 0, hatched: false };
  });
  const [hatchOpen, setHatchOpen] = useState(() => !loadProfile()?.hatched);
  // Home: on every visit (unless a shared link names a mission), after hatching, and from the nav
  const [homeOpen, setHomeOpen] = useState(() => Boolean(loadProfile()?.hatched) && !readMission(window.location.hash));
  const [stimuli, setStimuli] = useState({});
  const [background, setBackgroundState] = useState(0.5);
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
    toolRef.current = tool;
  }, [tool]);

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
      real: null,
      senseClock: 0,
      timeScale: 1,
      experimentWaiters: [],
    };
    engineRef.current = engine;
    game.setMission(engine.mission);
    game.motorMode = 'neurons';
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
    const onFloorClick = (x, y) => {
      if (game.over) return;
      const t = toolRef.current;
      if ((t === 'odorA' || t === 'odorB') && game.mission === 'sandbox') {
        game.addOdor(x, y, t === 'odorA' ? 'A' : 'B');
        return;
      }
      if (t === 'spider') {
        if (!game.addPredator(x, y)) showToast(`Max ${PREDATOR_MAX} spiders — that's plenty`, 'warn');
      } else if (!game.addSugar(x, y)) {
        showToast('The arena is full already', 'info');
      }
    };
    loadNeuroMechFly(import.meta.env.BASE_URL)
      .then((asset) => {
        if (disposed) return;
        engine.body = new FlyBody3D(bodyHostRef.current, asset, { onFloorClick });
        engine.body.setPlayback(engine.timeScale);
        setBodyStatus('ready');
      })
      .catch((err) => {
        console.error('NeuroMechFly body failed to load', err);
        if (!disposed) setBodyStatus('error');
      });

    // the real FlyWire brain: on the Base44 server (one per visitor), else in this browser
    let lastProgress = 0;
    engine.real = new RealBrain({
      baseUrl: import.meta.env.BASE_URL,
      onTransport: (t) => {
        if (!disposed) setReal((r) => ({ ...r, transport: t }));
      },
      onProgress: (p) => {
        if (!disposed && p - lastProgress > 0.02) {
          lastProgress = p;
          setReal((r) => ({ ...r, status: 'loading', progress: p }));
        }
      },
      onReady: (m) => {
        if (disposed) return;
        brain.setConnectome(m.cluster, m.positions);
        setReal((r) => ({ ...r, status: 'ready', progress: 1, n: m.n, nnz: m.nnz, where: m.where, named: m.header?.named ?? [] }));
        engine.real.control('walk', engine.explore ?? 0);
      },
      onFrame: (m, activity) => {
        if (activity) brain.setSpikes(activity);
      },
      onExperiment: (m) => {
        if (disposed) return;
        setExperiments((list) => [...list, m].slice(-40));
        engine.experimentWaiters.shift()?.(m);
      },
      onError: (err) => {
        console.warn('FlyWire connectome unavailable, using the 16-region model', err);
        if (!disposed) setReal((r) => ({ ...r, status: 'error', progress: 0 }));
      },
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
    let realClock = 0;
    let hudClock = 0;
    // write the hash on the first frame, not at mount: under StrictMode's dev
    // double-mount the second pass would otherwise "decode" this fly's own DNA
    let hashClock = HASH_INTERVAL;
    let fpsFrames = 0;
    let fpsClock = 0;

    const tick = (now) => {
      const elapsed = Math.max(0, (now - last) / 1000);
      // clamp the simulated step so a stalled tab resumes in slow motion, not a teleport
      const wallDt = Math.min(0.1, elapsed);
      // slow motion slows the whole world, not just the legs
      const dt = wallDt * engine.timeScale;
      last = now;

      // the real brain's descending neurons steer the fly and trigger its escapes
      const rb = engine.real;
      game.brainMotor = rb?.ready ? rb.motor(dt) : null;
      if (now >= engine.holdUntil) game.advance(dt);
      const events = game.drainEvents();
      brain.consume(events);
      view.consume(events);
      engine.body?.consume(events);
      if (rb?.ready) {
        engine.senseClock += dt;
        if (engine.senseClock >= SENSE_INTERVAL) {
          rb.sense(game.sensors, engine.senseClock, { speed: game.fly.v / MAX_SPEED, turn: game.fly.omega / MAX_TURN });
          // internal state: hunger drives the walk command neurons (a sated fly idles)
          rb.hunger(1 - game.energy / 100);
          engine.senseClock = 0;
        }
        for (const ev of events) {
          if (ev.type === 'bump' || ev.type === 'hit') rb.bump();
        }
      }
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
      hudClock += wallDt;
      realClock += wallDt;
      if (realClock >= 0.25 && rb?.frame) {
        realClock = 0;
        const f = rb.frame;
        setReal((r) =>
          r.status === 'ready'
            ? { ...r, stats: f.stats, groups: f.groups, memory: f.memory, where: f.where && r.where ? { ...r.where, ...f.where } : r.where }
            : r,
        );
        // the body's motion, to show next to the neurons that caused it
        setMotor({
          speedMm: game.fly.v * MM_PER_UNIT,
          turnRate: game.fly.omega,
          turnCmd: game.brainMotor?.turn ?? 0,
          escaping: game.fly.escapeTimer > 0,
          hungerHz: engine.real?.controls.hunger ?? 0,
          exploreHz: engine.real?.controls.walk ?? 0,
          taste: game.sensors.taste,
          mode: game.motorMode,
        });
      }
      if (hudClock >= HUD_INTERVAL) {
        hudClock = 0;
        updateStatus(engine, game, brain.act, now);
        setHud(snapshot(game, engine));
        setStats({ ...engine.stats });
        setProfile((p) => (p.xp === engine.profile.xp && p.name === engine.profile.name ? p : engine.profile));
      }
      hashClock += wallDt;
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
      engine.real?.dispose();
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
    ({ name, weights }) => {
      const e = engineRef.current;
      setHatchOpen(false);
      if (!e) return;
      if (weights) e.game.reset((Math.random() * 2 ** 32) >>> 0, weights, 0);
      e.profile = { ...e.profile, name, hatched: true };
      saveProfile(e.profile);
      setProfile(e.profile);
      e.brain.consume([{ type: 'levelup', generation: 1 }]);
      setHomeOpen(true);
      showToast(`🐣 ${name} hatched! Pick a mode to start.`, 'ok');
    },
    [showToast],
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

  const onTogglePredator = useCallback(() => setTool((t) => (t === 'spider' ? 'sugar' : 'spider')), []);

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
      const t = toolRef.current;
      if ((t === 'odorA' || t === 'odorB') && e.game.mission === 'sandbox') {
        e.game.addOdor(p.x, p.y, t === 'odorA' ? 'A' : 'B');
      } else if (t === 'spider') {
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
    e.view.setCursor(p ? { ...p, armed: toolRef.current === 'spider' } : null);
  }, []);

  const onPlaygroundLeave = useCallback(() => engineRef.current?.view.setCursor(null), []);

  const pick = useCallback((x, y) => engineRef.current?.brain.pick(x, y) ?? null, []);

  // ---- neural controls ----
  const onMotorMode = useCallback(
    (m) => {
      setMotorMode(m);
      const e = engineRef.current;
      if (e) e.game.motorMode = m;
      showToast(m === 'neurons' ? 'Neurons only: every movement now comes from FlyWire descending neurons' : 'Autopilot: the genome model steers, the FlyWire brain still fires escapes and feeding', 'info');
    },
    [showToast],
  );
  const onMode = useCallback(
    (k) => {
      setHomeOpen(false);
      const e = engineRef.current;
      if (k === 'sandbox') {
        onMission('sandbox');
        setSideTab('sandbox');
        setMotorMode('neurons');
        if (e) e.game.motorMode = 'neurons';
      } else if (k === 'train') {
        onMission('forage');
        setSideTab('learn');
        setMotorMode('neurons');
        if (e) e.game.motorMode = 'neurons';
        setTool((t) => (t.startsWith('odor') ? 'sugar' : t));
      } else {
        const m = BUILD_MISSIONS.includes(e?.mission) ? e.mission : 'build';
        onMission(m);
        setSideTab('map');
        // the build missions need the fly to reach tasks: the genome model steers, the brain still fires escapes and feeding
        setMotorMode('assist');
        if (e) e.game.motorMode = 'assist';
        setTool((t) => (t.startsWith('odor') ? 'sugar' : t));
      }
    },
    [onMission],
  );
  const onControl = useCallback((name, hz) => {
    setStimuli((c) => ({ ...c, [name]: hz }));
    engineRef.current?.real?.control(name, hz);
  }, []);
  const onBackground = useCallback((hz) => {
    setBackgroundState(hz);
    engineRef.current?.real?.background(hz);
  }, []);
  const onForget = useCallback(() => {
    engineRef.current?.real?.resetLearning();
    showToast('Forgotten: every KC→MBON synapse is back to its FlyWire weight', 'info');
  }, [showToast]);
  const onTeach = useCallback(
    async (action, odor) => {
      showToast(`${action === 'train' ? 'Rewarding' : 'Punishing'} odour ${odor}: the brain smells it and gets ${action === 'train' ? 'PAM' : 'PPL1'} dopamine`, 'info');
      const r = await onExperimentRef.current?.(action, odor);
      if (r) showToast(`Odour ${odor}: ${r.changed} synapses changed · memory ${r.memory?.valence > 0 ? 'approach' : r.memory?.valence < 0 ? 'avoid' : 'neutral'}`, 'ok');
    },
    [showToast],
  );
  const onExplore = useCallback((hz) => {
    setExplore(hz);
    const e = engineRef.current;
    if (!e) return;
    e.explore = hz;
    e.real?.control('walk', hz);
  }, []);
  const onSteer = useCallback((sideKey, on) => {
    const e = engineRef.current;
    if (!e?.real) return;
    const name = sideKey === 'L' ? 'steerL' : 'steerR';
    if ((e.real.controls[name] ?? 0) === (on ? STEER_HZ : 0)) return;
    e.real.control(name, on ? STEER_HZ : 0);
  }, []);
  const onReward = useCallback(() => {
    const e = engineRef.current;
    if (!e?.real) return;
    e.real.control('reward', 80);
    setTimeout(() => e.real?.control('reward', 0), REWARD_MS);
    showToast('Dopamine: PAM neurons fire for 0.4 s — whatever the fly smells now is being learned', 'ok');
  }, [showToast]);
  const onLesion = useCallback((name, on) => {
    setLesions((l) => ({ ...l, [name]: on }));
    engineRef.current?.real?.lesion(name, on);
  }, []);
  const onExperiment = useCallback(
    (action, odor) =>
      new Promise((resolve) => {
        const e = engineRef.current;
        if (!e?.real?.ready) return resolve(null);
        const t = setTimeout(() => resolve(null), EXPERIMENT_TIMEOUT_MS);
        e.experimentWaiters.push((m) => {
          clearTimeout(t);
          resolve(m);
        });
        e.real.experiment(action, odor);
      }),
    [],
  );
  const onExperimentRef = useRef(null);
  onExperimentRef.current = onExperiment;
  const onSelfTest = useCallback(async () => {
    const r = await fetch(new URL('api/brain/selftest', document.baseURI));
    if (!r.ok) throw new Error(r.status === 404 ? 'No server brain here (static hosting)' : `self-test failed: HTTP ${r.status}`);
    return r.json();
  }, []);
  const getRaster = useCallback(() => {
    const rb = engineRef.current?.real;
    return rb?.frame ? { raster: rb.raster, simMs: rb.frame.stats.simMs } : null;
  }, []);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.timeScale = playback;
    e.body?.setPlayback(playback);
    e.real?.setSpeed(playback);
  }, [playback, bodyStatus]);

  // keyboard shortcuts (ignored while typing a name)
  useEffect(() => {
    const onKey = (ev) => {
      const t = ev.target;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || typing) return;
      const k = ev.key.toLowerCase();
      if (k === 'a' || k === 'arrowleft') return onSteer('L', true);
      if (k === 'd' || k === 'arrowright') return onSteer('R', true);
      if (k === 'e') return onReward();
      if (ev.repeat) return;
      if (k === 'm') onMutate();
      else if (k === 'p') onTogglePredator();
      else if (k === 'r') onRestart();
      else if (k === 'g') onGood();
      else if (k === 'b') onBad();
      else if (k === 'l') setLabOpen((o) => !o);
      else if (k === 'h') setHomeOpen((o) => !o);
      else if (k === '1') onMode('sandbox');
      else if (k === '2') onMode('train');
      else if (k === '3') onMode('build');
      else if (k === 'escape') {
        setTool('sugar');
        setHomeOpen(false);
        setLabOpen(false);
      }
    };
    const onKeyUp = (ev) => {
      const k = ev.key.toLowerCase();
      if (k === 'a' || k === 'arrowleft') onSteer('L', false);
      if (k === 'd' || k === 'arrowright') onSteer('R', false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [onMutate, onRestart, onTogglePredator, onGood, onBad, onMode, onSteer, onReward]);

  const share = hud && engineRef.current ? shareUrl(engineRef.current, hud.dna) : '';

  return (
    <div className="min-h-screen bg-void text-neutral-200 lg:flex lg:h-screen lg:flex-col">
      {hud && (
        <TopBar
          hud={hud}
          profile={profile}
          mission={mission}
          mode={modeOf(mission)}
          onMode={onMode}
          onHome={() => setHomeOpen(true)}
          onMission={onMission}
          onLab={() => setLabOpen(true)}
          onShare={onCopy}
          copied={copied}
        />
      )}

      <main className="grid flex-1 gap-2 p-2 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(340px,32vw)]">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="relative flex min-h-0 flex-1 flex-col">
            <BodyView
              ref={bodyHostRef}
              status={bodyStatus}
              playback={playback}
              onPlayback={setPlayback}
              behaviour={hud?.behaviour}
              byBrain={hud?.byBrain}
              motorMode={hud?.motorMode}
              armed={armed}
            />
            {hud?.over && <GameOverOverlay hud={hud} onRestart={onRestart} onMutateRetry={onMutateRetry} onCopy={onCopy} />}
          </div>
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
            >
              <NeuralControls
                mode={motorMode}
                onMode={onMotorMode}
                explore={explore}
                onExplore={onExplore}
                onSteer={onSteer}
                onReward={onReward}
                lesions={lesions}
                onLesion={onLesion}
                ready={real.status === 'ready'}
              />
            </BottomDock>
          )}
        </div>

        <aside className="grid min-h-0 gap-2 lg:grid-rows-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <BrainView ref={brainHostRef} activity={hud?.activity ?? []} pick={pick} holding={hud?.holding} real={real} />
          <SidePanel
            tab={sideTab}
            onTab={setSideTab}
            panes={{
              sandbox: (
                <SandboxPanel
                  ready={real.status === 'ready'}
                  controls={stimuli}
                  onControl={onControl}
                  lesions={lesions}
                  onLesion={onLesion}
                  background={background}
                  onBackground={onBackground}
                  memory={real.memory}
                  onTeach={onTeach}
                  onForget={onForget}
                  tool={tool}
                  onTool={setTool}
                  inSandbox={mission === 'sandbox'}
                  onEnter={() => onMode('sandbox')}
                />
              ),
              proof: <ProofPanel real={real} getRaster={getRaster} motor={motor} onSelfTest={onSelfTest} />,
              learn: <LearningPanel results={experiments} onExperiment={onExperiment} ready={real.status === 'ready'} stats={real.stats} />,
              map: (
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
                </MissionStage>
              ),
            }}
          />
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
                className="mt-2 w-full rounded-lg bg-[#0052ff] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 active:scale-[0.98]"
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
      {homeOpen && !hatchOpen && hud && <HomeScreen profile={profile} real={real} onMode={onMode} current={modeOf(mission)} />}
      {hatchOpen && hud && (
        <HatchScreen
          defaultName={profile.name}
          adopting={adoptingRef.current}
          dna={hud.dna}
          onHatch={onHatch}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}
