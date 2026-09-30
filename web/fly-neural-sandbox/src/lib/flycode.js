// Vibecode theme: the "FlyCode" terminal and the cynical status line.
//
// compileFlyContract() turns the Base44 DNA fields into a (satirical) Solidity
// contract deterministically, so the DNA string really is the "bytecode" of the
// code shown: same link, same contract. FlyTerminal then streams glitchy
// pseudo-code, one line per leg step, whose content is read from the live
// neural state; statusFor() picks the sarcastic status from brain state.

import { C } from './connectome.js';
import { GENES, mulberry32, hashString, norm } from './genome.js';
import { BUILD_TASKS, PIPELINE } from './game.js';

const MISSION_TASKS = { build: BUILD_TASKS, vibe: PIPELINE };

const hex = (n, w = 2) => n.toString(16).padStart(w, '0');

/** Satirical Solidity source for a DNA (weights / score / pose from base44.unpackDNA). */
export function compileFlyContract(dna, { weights, score, gx, gy, heading }) {
  const genes = weights.map((w, i) => `    uint8 constant ${GENES[i].key.toUpperCase()} = 0x${hex(w)}; // ${GENES[i].path}`);
  return [
    '// SPDX-License-Identifier: BUZZ-1.0',
    'pragma solidity ^0.8.24;',
    `/// @notice compiled from Base44 DNA ${dna} by six legs and 139,255 neurons`,
    `contract FlyCoin_${dna} {`,
    ...genes,
    `    uint16 public immutable score = ${score};`,
    `    bytes2 public immutable pose = 0x${hex(gx, 1)}${hex(gy, 1)}; // heading ${heading * 22.5}deg`,
  ];
}

const VERBS = ['buzz', 'hover', 'forage', 'groom', 'saccade', 'antennate', 'stridulate', 'halt', 'zigzag'];
const TYPES = ['uint256', 'bytes32', 'address', 'uint8', 'bool'];
const GLITCH = '▓▒░#@%&¤§ÆØ∆';

/** Streams pseudo-code lines; each call to step() is one leg step. */
export class FlyTerminal {
  constructor(seed = 1, maxLines = 60) {
    this.rng = mulberry32(seed >>> 0);
    this.maxLines = maxLines;
    this.lines = [];
    this.n = 0;
  }

  reset(dna, fields) {
    this.rng = mulberry32(hashString(dna));
    this.lines = compileFlyContract(dna, fields).map((text) => ({ text, kind: 'header' }));
    this.n = 0;
  }

  push(text, kind = 'code') {
    this.lines.push({ text, kind, id: this.n++ });
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines);
  }

  /** Corrupt characters in proportion to how erratic the brain is. */
  glitch(text, amount) {
    if (amount <= 0) return text;
    return [...text]
      .map((ch) => (ch !== ' ' && this.rng() < amount ? GLITCH[Math.floor(this.rng() * GLITCH.length)] : ch))
      .join('');
  }

  /** One log line per leg step, in the language of the current mission. */
  step(leg, game, activity) {
    if (game.mission === 'vibe') return this.stepSolidity(leg, game, activity);
    const r = this.rng;
    const a = (k) => Math.round(Math.min(1, activity[C[k]] ?? 0) * 255);
    const legName = ['LF', 'LM', 'LH', 'RF', 'RM', 'RH'][leg] ?? 'XX';
    const pick = (list) => list[Math.floor(r() * list.length)];
    let line;
    if (game.mission === 'build') {
      const noun = pick(['Nectar', 'Flower', 'Hive', 'Petal', 'Swarm', 'Pollen', 'Wing']);
      line = pick([
        () => `base44 ▸ create page "${noun} Dashboard"   # ${legName} step, T1 0x${hex(a('T1'))}`,
        () => `base44 ▸ entity ${noun} { name: string, sweetness: number }`,
        () => `base44 ▸ add button "Buzz" → onClick: navigate("/${noun.toLowerCase()}")`,
        () => `base44 ▸ style --theme neon --accent #e879f9   # MB 0x${hex(a('MB_L'))}${hex(a('MB_R'))}`,
        () => `base44 ▸ function ${noun.toLowerCase()}Score(req) { return ${Math.round(game.energy)} }`,
        () => `✓ preview hot-reloaded in ${Math.round(40 + r() * 200)} ms (DN 0x${hex(a('DN'))})`,
      ])();
    } else if (game.mission === 'search') {
      line = pick([
        () => `GET fly://search  ·  ${legName} tarsus on the trackpad  ·  OL 0x${hex(a('OL_L'))}${hex(a('OL_R'))}`,
        () => `⌕ scrolling… antennae scanning for keywords (AL 0x${hex(a('AL_L'))}${hex(a('AL_R'))})`,
        () => `↳ hovering a link with the ${legName} leg`,
      ])();
    } else {
      const turn = Math.round(((activity[C.MB_R] ?? 0) - (activity[C.MB_L] ?? 0)) * 90);
      line = pick([
        () => `${legName} step · MB_L 0x${hex(a('MB_L'))} MB_R 0x${hex(a('MB_R'))} → steer ${turn >= 0 ? '+' : ''}${turn}°`,
        () => `antennae: sugar ${(game.sensors.odorL ?? 0).toFixed(2)} L / ${(game.sensors.odorR ?? 0).toFixed(2)} R`,
        () => `VNC T1 0x${hex(a('T1'))} T2 0x${hex(a('T2'))} T3 0x${hex(a('T3'))} · tripod gait`,
        () => `energy ${Math.round(game.energy)}% · DN drive 0x${hex(a('DN'))}`,
      ])();
    }
    const chaos = norm(game.weights[5]) * 0.06;
    this.push(this.glitch(line, chaos));
  }

  stepSolidity(leg, game, activity) {
    const r = this.rng;
    const a = (k) => Math.round(Math.min(1, activity[C[k]] ?? 0) * 255);
    const verb = VERBS[Math.floor(r() * VERBS.length)];
    const legName = ['LF', 'LM', 'LH', 'RF', 'RM', 'RH'][leg] ?? 'XX';
    const templates = [
      () => `    function ${verb}${legName}(${TYPES[Math.floor(r() * TYPES.length)]} dn) external { require(DN > 0x${hex(a('DN'))}); }`,
      () => `    emit Step(${legName}, 0x${hex(a('T1'))}${hex(a('T2'))}${hex(a('T3'))}); // T1 T2 T3 motor burst`,
      () => `    mapping(address => uint256) internal sugarOf${legName}; // MB 0x${hex(a('MB_L'))}|0x${hex(a('MB_R'))}`,
      () => `    modifier onlyCX() { require(heading == 0x${hex(Math.round(((game.fly.theta % 6.283) + 6.283) % 6.283 * 40))}); _; }`,
      () => `    // TODO: audit ${legName} tarsus before mainnet (optic lobe 0x${hex(a('OL_L'))}${hex(a('OL_R'))})`,
      () => `    uint256 constant GAS_${verb.toUpperCase()} = ${Math.round(game.energy * 1000)}; // energy`,
      () => `    assembly { mstore(0x${hex(a('PROTO'))}, 0x${hex(a('CX'))}) } // pure muscle memory`,
    ];
    const chaos = norm(game.weights[5]) * 0.12 + Math.max(0, (activity[C.CX] ?? 0) - 0.8) * 0.2;
    this.push(this.glitch(templates[Math.floor(r() * templates.length)](), chaos));
  }

  /** Special lines for game events. */
  event(ev) {
    switch (ev.type) {
      case 'stage':
        if (ev.mission === 'build') {
          this.push(`✓ [${ev.stage}] done — ${Math.round(ev.progress * 100)}% of the app built`, 'stage');
        } else {
          this.push(`    // [${ev.stage}] ✓ ${Math.round(ev.progress * 100)}% — ${stageLine(ev.stage)}`, 'stage');
        }
        break;
      case 'wrongStage':
        this.push(
          ev.mission === 'build'
            ? `✗ [${ev.got}] merge conflict — the app needs [${ev.need}] first`
            : `    // [${ev.got}] ✗ merge conflict: pipeline wants [${ev.need}]`,
          'warn',
        );
        break;
      case 'shipped':
        this.push(`🚀 App #${ev.deployments} shipped on Base44 — six legs, zero meetings`, 'success');
        break;
      case 'needSearch':
        this.push('⌕ the fly clicked [Search]…', 'stage');
        break;
      case 'results':
        this.push(`GET fly://search?q=${ev.query} → ${ev.count} results`, 'header');
        break;
      case 'read':
        this.push(`📖 read "${ev.result.title}" — ${ev.result.snippet?.slice(0, 70) ?? ''}…`, 'stage');
        break;
      case 'trained':
        if (ev.changes.length) {
          this.push(
            `🧠 ${ev.reward > 0 ? 'reward' : 'punishment'} → ${ev.changes.map((c) => `${GENES[c.gene].name} ${c.delta > 0 ? '↑' : '↓'}`).join(', ')}`,
            ev.reward > 0 ? 'success' : 'warn',
          );
        }
        break;
      case 'deployed':
        this.push(`}  // 🚀 deployed #${ev.deployments} on Base (simulated) — 0x${hex(Math.floor(this.rng() * 2 ** 32), 8)}…`, 'success');
        break;
      case 'hit':
        this.push('    revert RugPulled(msg.sender); // spider strike, OL→LH→DN escape', 'warn');
        break;
      case 'mutate':
        this.push(`    // hotfix: mutated ${ev.genes.map((g) => GENES[g].key.toUpperCase()).join(', ')} without tests`, 'stage');
        break;
      default:
        break;
    }
  }
}

function stageLine(stage) {
  switch (stage) {
    case 'Compile':
      return 'solc 0.8.24 --optimize-runs=buzz';
    case 'Audit':
      return 'auditor: "lgtm" (auditor is also the fly)';
    case 'Mint':
      return '_mint(msg.sender, 1_000_000 * 1e18);';
    case 'Deploy':
      return 'forge create FlyCoin --legs 6';
    default:
      return 'bridged to Base, chainId 8453';
  }
}

/**
 * Cynical status line from brain + body state. Highest-priority match wins.
 * @returns {{text:string, tone:'ok'|'warn'|'dna'|'info'}}
 */
export function statusFor(game, activity, recent = {}) {
  const f = game.fly;
  const act = (k) => activity[C[k]] ?? 0;
  const margin = 95;
  const nearX = f.x < margin || f.x > 960 - margin;
  const nearY = f.y < margin || f.y > 640 - margin;
  const erratic = norm(game.weights[5]) > 0.6 || Math.abs(game.noise ?? 0) > 1.4;

  if (game.mission === 'build') return buildStatus(game, act, { nearX, nearY, erratic }, recent);
  if (game.mission === 'search') return searchStatus(game, act, { nearX, nearY, erratic }, recent);
  if (game.mission !== 'vibe') return forageStatus(game, act, recent);
  if (recent.deployed) return { text: 'Success! Fly just deployed an ERC-20 token on Base using pure muscle memory.', tone: 'ok' };
  if (game.over) return { text: 'Fly ran out of runway. Down round incoming.', tone: 'warn' };
  if (recent.hit || act('LH_L') + act('LH_R') > 0.9) return { text: 'Fly spotted a rug pull. Initiating evasive maneuvers.', tone: 'warn' };
  if (nearX && nearY) return { text: 'Fly is waiting for a venture capital funding round.', tone: 'info' };
  if (erratic && act('CX') > 0.5) return { text: 'Fly is hallucinating a new Layer 3 scaling solution…', tone: 'dna' };
  if (game.energy < 25) return { text: 'Fly is pivoting to AI wrappers.', tone: 'warn' };
  if (recent.wrong) return { text: 'Fly shipped to prod without an audit. Again.', tone: 'warn' };
  if (recent.stage) return { text: `Fly closed the [${recent.stage}] ticket. Velocity: ${Math.round(f.v / 3)} story points.`, tone: 'ok' };
  if (act('PAM') > 0.5) return { text: 'Dopamine hit: Fly just discovered "number go up".', tone: 'ok' };
  if (act('MB_L') + act('MB_R') > 1.2) return { text: 'Brain state optimized: Fly is restructuring the smart contract.', tone: 'dna' };
  if (f.v < 60) return { text: 'Fly is writing a Medium post about decentralization.', tone: 'info' };
  const need = PIPELINE[game.pipeline];
  return { text: `Fly is vibecoding toward [${need}]… ${game.pipeline * 20}% deployed.`, tone: 'info' };
}

function buildStatus(game, act, { nearX, nearY, erratic }, recent) {
  if (recent.shipped) return { text: 'Shipped! Fly just built a Base44 app with six legs and zero meetings.', tone: 'ok' };
  if (game.over) return { text: 'Fly ran out of energy mid-deploy. Feed it and hit Retry.', tone: 'warn' };
  if (recent.hit) return { text: 'A spider filed a bug report. Fly is escaping the backlog.', tone: 'warn' };
  if (recent.trainedGood) return { text: 'Good fly! Dopamine is rewiring its build instincts.', tone: 'ok' };
  if (nearX && nearY) return { text: 'Fly is stuck in a modal dialog.', tone: 'info' };
  if (erratic && act('CX') > 0.5) return { text: 'Fly is refactoring the whole app for no reason…', tone: 'dna' };
  if (recent.wrong) return { text: 'Merge conflict! The fly tried to publish before building the page.', tone: 'warn' };
  if (recent.stage) return { text: `Fly finished [${recent.stage}]. The preview looks… buzzing.`, tone: 'ok' };
  if (game.energy < 25) return { text: 'Fly is low on sugar. Builders need snacks too.', tone: 'warn' };
  if (act('MB_L') + act('MB_R') > 1.2) return { text: 'Fly is designing the database schema.', tone: 'dna' };
  if (game.fly.v < 60) return { text: 'Fly is reading the Base44 docs (finally).', tone: 'info' };
  const next = MISSION_TASKS.build[game.pipeline];
  return { text: `Next up: [${next}]. Fly is ${game.pipeline * 17}% done with its app.`, tone: 'info' };
}

function searchStatus(game, act, { nearX, nearY, erratic }, recent) {
  if (game.over) return { text: 'Fly fell into a rabbit hole and forgot to eat.', tone: 'warn' };
  if (recent.read) return { text: `Fly is reading "${recent.read}"…`, tone: 'ok' };
  if (recent.query) return { text: `Fly is googling "${recent.query}"…`, tone: 'dna' };
  if (recent.hit) return { text: 'A spider appeared in the search results. Fly is closing the tab.', tone: 'warn' };
  if (nearX && nearY) return { text: 'Fly hit a paywall.', tone: 'info' };
  if (erratic && act('CX') > 0.5) return { text: 'Fly opened 47 tabs.', tone: 'dna' };
  if (act('PAM') > 0.5) return { text: 'Fly learned something new. Dopamine says: more.', tone: 'ok' };
  return { text: 'Fly is looking for the [Search] button…', tone: 'info' };
}

function forageStatus(game, act, recent) {
  if (game.over) return { text: 'Your fly is out of energy. Tap Retry and drop some sugar!', tone: 'warn' };
  if (recent.hit) return { text: 'Spider strike! Giant-fiber escape: descending neurons fired.', tone: 'warn' };
  if (recent.trainedGood) return { text: 'Good fly! Dopamine (PAM neurons) is strengthening what it just did.', tone: 'ok' };
  if (recent.trainedBad) return { text: 'Bad fly… that pathway just got a little weaker.', tone: 'warn' };
  if (act('LH_L') + act('LH_R') > 0.9) return { text: 'Danger nearby — the lateral horn is on high alert.', tone: 'warn' };
  if (act('PAM') > 0.5) return { text: 'Yum! Dopamine reward wave in the mushroom bodies.', tone: 'ok' };
  const d = act('MB_R') - act('MB_L');
  if (Math.abs(d) > 0.08) return { text: `Fly smells sugar on the ${d > 0 ? 'right' : 'left'} — steering toward it.`, tone: 'dna' };
  if (game.energy < 25) return { text: 'Hungry fly! Drop some sugar near it.', tone: 'warn' };
  return { text: 'Fly is exploring the garden…', tone: 'info' };
}
