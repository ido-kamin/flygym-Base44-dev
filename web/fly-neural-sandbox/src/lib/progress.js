// Player-facing progression: XP, levels, the fly's name, quests.
// Kept out of the 48-bit DNA (which stays genome + score + pose); stored in
// localStorage so it survives reloads on this device.

import { BUILD_TASKS, PIPELINE } from './game.js';

export const XP = {
  eat: 5,
  stage: 15,
  shipped: 120,
  deployed: 80,
  read: 12,
  trained: 3,
  levelup: 25,
};

/** Level from XP: quick early levels, slower later (1 + floor(sqrt(xp / 60))). */
export const levelOf = (xp) => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 60));
export const xpForLevel = (level) => (level - 1) ** 2 * 60;

/** Progress 0..1 through the current level. */
export function levelProgress(xp) {
  const l = levelOf(xp);
  const lo = xpForLevel(l);
  const hi = xpForLevel(l + 1);
  return (xp - lo) / (hi - lo);
}

const FIRST = ['Buzz', 'Zippy', 'Nectar', 'Pixel', 'Ziggy', 'Dot', 'Rocket', 'Mango', 'Sprout', 'Echo'];
const LAST = ['Lightwing', 'Sixlegs', 'Byte', 'Compoundeye', 'Hoverton', 'McFly', 'Antenna', 'Tarsus'];
export function randomFlyName(rng = Math.random) {
  return `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`;
}

const KEY = 'fly-neural-sandbox:profile';
export function loadProfile() {
  try {
    const p = JSON.parse(window.localStorage.getItem(KEY) || 'null');
    if (p && typeof p.name === 'string') return { name: p.name.slice(0, 32), xp: Number(p.xp) || 0, hatched: !!p.hatched };
  } catch {
    /* storage unavailable */
  }
  return null;
}
export function saveProfile(p) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

/** The quest shown for each mission, with live progress. */
export function questFor(mission, { pipeline = 0, reads = 0, eaten = 0, deployments = 0 } = {}) {
  switch (mission) {
    case 'build':
      return {
        title: 'Ship an app on Base44',
        steps: BUILD_TASKS,
        done: pipeline,
        hint: 'Guide the fly to the glowing task. Wrong order = merge conflict.',
        reward: `${XP.shipped} XP + a real app`,
        completed: deployments,
      };
    case 'search':
      return {
        title: 'Research the web',
        steps: null,
        done: Math.min(reads, 5),
        total: 5,
        hint: 'The fly clicks [Search], then reads the results it walks over.',
        reward: `${XP.read} XP per article`,
      };
    case 'vibe':
      return {
        title: 'Deploy FlyCoin on Base',
        steps: PIPELINE,
        done: pipeline,
        hint: 'Compile → Audit → Mint → Deploy → Base, in order.',
        reward: `${XP.deployed} XP`,
        completed: deployments,
      };
    case 'sandbox':
      return {
        title: 'Play with its brain',
        steps: null,
        done: Math.min(eaten, 10),
        total: 10,
        hint: 'It can’t starve here. Drop sugar, spiders and odours; stimulate, silence and teach its neurons in the Sandbox tab.',
        reward: 'no score, just science',
      };
    default:
      return {
        title: 'Feed your fly',
        steps: null,
        done: Math.min(eaten % 10, 10),
        total: 10,
        hint: 'Click the arena to drop sugar. Spiders are optional (and scary).',
        reward: `${XP.eat} XP per sugar`,
      };
  }
}

export const MISSION_META = {
  forage: { label: 'Forage', icon: '🍬', url: 'fly://garden', tab: 'Sugar garden', color: '#a3e635' },
  build: { label: 'Build on Base44', icon: '🛠', url: 'fly://base44.app/builder', tab: 'Base44 builder', color: '#e879f9' },
  search: { label: 'Search the web', icon: '🔎', url: 'fly://search', tab: 'Search', color: '#22d3ee' },
  vibe: { label: 'Vibecode · Base', icon: '⌨', url: 'fly://base.org/deploy', tab: 'FlyCoin.sol', color: '#3b7bff' },
  sandbox: { label: 'Sandbox', icon: '🧪', url: 'fly://lab', tab: 'Brain sandbox', color: '#f5a524' },
};
