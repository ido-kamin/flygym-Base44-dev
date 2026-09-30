// The fly's "personality": six 4-bit connection strengths on the
// Sensory -> Intrinsic -> Motor pathways of the connectome (24 bits of DNA).

import { GENE_COUNT, GENE_LEVELS } from './constants.js';

export const GENES = [
  {
    key: 'food',
    path: 'AL → MB',
    name: 'Sugar drive',
    desc: 'Antennal-lobe odour input onto the mushroom bodies: how hard the fly steers up the sugar gradient.',
  },
  {
    key: 'fear',
    path: 'OL → LH',
    name: 'Threat reflex',
    desc: 'Optic-lobe looming input onto the lateral horn: how strongly it veers away from predators.',
  },
  {
    key: 'reward',
    path: 'PAM → MB',
    name: 'Dopamine gain',
    desc: 'Dopaminergic reward onto the mushroom bodies: energy gained per sugar and the size of the reward wave.',
  },
  {
    key: 'steer',
    path: 'CX → DN',
    name: 'Steering precision',
    desc: 'Central-complex heading control onto descending neurons: turning gain.',
  },
  {
    key: 'speed',
    path: 'PROTO → DN',
    name: 'Locomotor drive',
    desc: 'Protocerebral drive onto descending neurons: top speed, at a metabolic cost.',
  },
  {
    key: 'noise',
    path: 'CX ↺ PROTO',
    name: 'Chaos loop',
    desc: 'Recurrent noise in the navigation loop: erratic exploration.',
  },
];

export const GENE_INDEX = Object.fromEntries(GENES.map((g, i) => [g.key, i]));

export const DEFAULT_WEIGHTS = [10, 8, 8, 9, 8, 4];

const MAX_LEVEL = GENE_LEVELS - 1;

/** Gene level (0..15) -> normalized strength (0..1). */
export const norm = (level) => level / MAX_LEVEL;

/** Small, fast, seedable PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash, used to derive a PRNG seed from a DNA string. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A random but playable genome: every gene in 3..14. */
export function randomWeights(rng) {
  return Array.from({ length: GENE_COUNT }, () => 3 + Math.floor(rng() * 12));
}

/**
 * Localized mutation: shift 1 or 2 distinct genes by 1..4 levels, clamped to
 * the gene range. A gene pinned at a bound is pushed the other way, so a
 * mutation always changes the genome.
 * @returns {{weights:number[], changed:number[]}}
 */
export function mutate(weights, rng) {
  const next = weights.slice();
  const count = rng() < 0.6 ? 1 : 2;
  const pool = [...next.keys()];
  const changed = [];
  for (let k = 0; k < count; k++) {
    const idx = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const step = 1 + Math.floor(rng() * 4);
    let delta = rng() < 0.5 ? -step : step;
    if (next[idx] + delta < 0 || next[idx] + delta > MAX_LEVEL) delta = -delta;
    next[idx] = Math.max(0, Math.min(MAX_LEVEL, next[idx] + delta));
    changed.push(idx);
  }
  return { weights: next, changed: changed.sort((a, b) => a - b) };
}

/** Human-readable archetype for the HUD and the share text. */
export function personality(weights) {
  const [food, fear, reward, steer, speed, noise] = weights;
  if (noise >= 11) return { title: 'Erratic Buzzer', emoji: '⚡', tagline: 'Chaos-loop dominant — unpredictable zig-zags.' };
  if (speed >= 12 && food >= 8) return { title: 'Speed Demon', emoji: '🔥', tagline: 'Maxed locomotor drive — burns energy, eats fast.' };
  if (fear >= 12) return { title: 'Paranoid Dodger', emoji: '👁', tagline: 'Hair-trigger looming reflex — nothing catches it.' };
  if (reward >= 11 && food >= 9) return { title: 'Efficient Forager', emoji: '💎', tagline: 'Dopamine-tuned — squeezes every calorie from sugar.' };
  if (steer >= 12) return { title: 'Precision Pilot', emoji: '🎯', tagline: 'Central complex locked on — surgical turns.' };
  if (food <= 4) return { title: 'Lazy Drifter', emoji: '🌙', tagline: 'Barely smells the sugar — lives on vibes.' };
  return { title: 'Balanced Scout', emoji: '🧭', tagline: 'Well-rounded connectome — steady and adaptable.' };
}

/** Generation level shown in the HUD. Derived from score so it survives the DNA round-trip. */
export function generationOf(score) {
  return 1 + Math.floor(Math.sqrt(score / 5));
}
