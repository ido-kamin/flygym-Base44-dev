// The fly's web search: its brain picks what to look up, the server fetches it.
//
// Queries come from the fly's state: its strongest, most active pathway picks a
// topic (sugar drive -> nectar, threat reflex -> spiders, ...), and after it has
// read an article it tends to follow a word from it, like a person hopping
// between links. Results come from /api/search (the game server's Wikipedia
// proxy); if that is unavailable (static hosting, dev) we call Wikipedia's
// CORS-enabled API directly.

import { GENES } from './genome.js';

export const TOPICS = {
  food: ['nectar', 'honey bee', 'fruit fermentation', 'sugar', 'olfaction'],
  fear: ['jumping spider', 'predator evasion', 'looming stimulus', 'escape response'],
  reward: ['dopamine', 'reward learning', 'mushroom body'],
  steer: ['insect navigation', 'central complex', 'path integration'],
  speed: ['insect flight', 'fastest insects', 'wing beat'],
  noise: ['chaos theory', 'random walk', 'serendipity'],
};

const STOP = new Set(['about', 'after', 'their', 'there', 'which', 'these', 'those', 'other', 'where', 'while', 'using', 'known', 'being', 'first', 'within', 'between', 'during', 'species', 'called']);

/**
 * @param {number[]} weights  genome
 * @param {Float32Array|number[]} eligibility  recent pathway activity per gene
 * @param {{title:string, snippet?:string}|null} lastRead
 * @param {() => number} rng
 */
export function nextQuery(weights, eligibility, lastRead, rng = Math.random) {
  if (lastRead && rng() < 0.55) {
    const words = `${lastRead.title} ${lastRead.snippet ?? ''}`
      .toLowerCase()
      .replace(/[^a-z\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4 && !STOP.has(w));
    if (words.length) return words[Math.floor(rng() * words.length)];
  }
  // topic from the gene whose pathway is strongest x most active
  let best = 0;
  let bestScore = -Infinity;
  GENES.forEach((g, i) => {
    const score = weights[i] * (0.5 + (eligibility?.[i] ?? 0)) + rng() * 4;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  const list = TOPICS[GENES[best].key];
  return list[Math.floor(rng() * list.length)];
}

/** Search the web; returns [{title, snippet, url}]. */
export async function searchWeb(query, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`/api/search?q=${encodeURIComponent(query)}`);
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data.results)) return data.results;
    }
  } catch {
    /* no game server: fall through to Wikipedia */
  }
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '6',
    srprop: 'snippet',
    format: 'json',
    origin: '*',
  });
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`search failed (${r.status})`);
  const data = await r.json();
  return (data?.query?.search ?? []).map((s) => ({
    title: s.title,
    snippet: String(s.snippet ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .slice(0, 220),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`,
  }));
}
