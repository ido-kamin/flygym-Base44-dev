// "Build this fly's app on Base44": turn a fly's DNA into a Base44 app prompt.
//
// The prompt is derived deterministically from the DNA (genome -> app concept,
// genes -> features), so the same fly link always proposes the same app. It is
// handed to the Base44 builder through a human click: browsers only allow
// window.open from a user gesture, and a third-party page cannot script
// base44.com or create apps in a visitor's account. Creating apps server-side
// (Base44 Platform API, POST /api/apps) needs an access token and spends that
// workspace's credits, so it is not done from the browser.

import { GENES, mulberry32, hashString, personality } from './genome.js';

/**
 * Builder URL. `?prompt=` prefill is not documented publicly; if the builder
 * ignores it the page still opens and the prompt is on the clipboard.
 */
export const BASE44_BUILDER_URL = 'https://app.base44.com/';

const CONCEPTS = [
  'a habit tracker',
  'a team stand-up board',
  'a recipe planner',
  'a personal finance dashboard',
  'a study flashcards app',
  'a fitness log',
  'a travel itinerary planner',
  'a reading list',
  'a plant-care reminder app',
  'a mood journal',
  'a side-project launch checklist',
  'a neighborhood events board',
];

const FEATURE_BY_GENE = [
  'streaks and rewards for every completed item (sugar drive)',
  'security alerts and a "threat radar" widget (threat reflex)',
  'a dopamine-style celebration animation on each win (dopamine gain)',
  'precise filters, sorting and a keyboard command palette (steering precision)',
  'a speed mode with one-tap quick-add (locomotor drive)',
  'a "surprise me" button that shuffles suggestions (chaos loop)',
];

/**
 * @param {string} dna  10-char Base44 DNA
 * @param {number[]} weights  6 gene levels (0..15)
 * @param {{score:number, deployments?:number, url?:string}} extra
 * @returns {{title:string, prompt:string}}
 */
export function flyAppPrompt(dna, weights, { score, deployments = 0, url = '' }) {
  const rng = mulberry32(hashString(dna));
  const p = personality(weights);
  const concept = CONCEPTS[Math.floor(rng() * CONCEPTS.length)];
  // the fly's three strongest genes become the headline features
  const ranked = weights.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const features = ranked.slice(0, 3).map(([, i]) => FEATURE_BY_GENE[i]);
  const genes = weights.map((w, i) => `${GENES[i].name} ${w}/15`).join(', ');
  const title = `${p.title}'s ${concept.replace(/^an? /, '')}`;
  const prompt = [
    `Build ${concept} designed by a fruit fly. Its personality is "${p.title}" (${p.tagline})`,
    `Must-have features: ${features.join('; ')}.`,
    `Visual style: dark neon lab UI (cyan, magenta and orange glow), with a small "Designed by fly ${dna}" badge that links to ${url || 'the Fly Neural Sandbox'}.`,
    `Fly stats to show on an About page: DNA ${dna}; score ${score}; deployments ${deployments}; genome ${genes}.`,
  ].join('\n');
  return { title, prompt };
}

/** Builder link carrying the prompt (see BASE44_BUILDER_URL note). */
export function base44BuildUrl(prompt) {
  return `${BASE44_BUILDER_URL}?prompt=${encodeURIComponent(prompt)}`;
}
