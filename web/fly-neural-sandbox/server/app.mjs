// Fly Neural Sandbox server: serves the built game (dist/) and three small APIs.
//
//   GET  /api/health          liveness + which features are configured
//   GET  /api/search?q=...     the fly's web search (Wikipedia, proxied + cached)
//   ws   /api/brain            the fly's FlyWire brain, simulated on this server (brainHost.mjs)
//   GET  /api/brain/info       where the brains run (host, CPUs, sessions)
//   GET  /api/brain/selftest   run the published circuits here and report the neurons' responses
//   POST /api/fly-apps         the fly ships a REAL Base44 app from its DNA
//   GET  /api/fly-apps/:id     build status -> deploy -> live URL
//
// Real app creation calls the Base44 Platform API (POST /api/apps) with the
// server's own access token (BASE44_API_TOKEN), so it spends that workspace's
// credits. To keep that safe the prompt is never taken from the client: the
// server decodes the Base44 DNA and derives the prompt itself; requests are
// rate-limited per visitor and globally (the Platform API allows 5/min), and a
// daily cap bounds spend. Without a token the endpoint reports
// `not_configured` and the game falls back to the builder hand-off link.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { decodeFlyFromBase44, DNAError } from '../src/lib/base44.js';
import { flyAppPrompt } from '../src/lib/base44App.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.gz': 'application/gzip', // served as-is; the client inflates it (no Content-Encoding)
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readJson(req, limit = 2048) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

/**
 * Sliding-window limiter: at most `max` hits per `windowMs` per key.
 * `limit(key)` records a hit if allowed; `limit(key, false)` only checks.
 * Keys whose hits have all expired are pruned, so memory stays bounded.
 */
export function rateLimiter(max, windowMs, now = () => Date.now()) {
  const hits = new Map();
  let lastPrune = now();
  const limit = (key, commit = true) => {
    const t = now();
    if (t - lastPrune > windowMs) {
      lastPrune = t;
      for (const [k, list] of hits) if (!list.length || t - list[list.length - 1] >= windowMs) hits.delete(k);
    }
    const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (list.length >= max) {
      hits.set(key, list);
      return false;
    }
    if (commit) {
      list.push(t);
      hits.set(key, list);
    }
    return true;
  };
  limit.size = () => hits.size;
  return limit;
}

const SEARCH_CACHE_MAX = 200;

const stripHtml = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

/**
 * @param {object} opts
 * @param {string} opts.distDir     built game to serve
 * @param {string} [opts.publicDir] static data served directly (Vite's public/), preferred over its copy in dist/
 * @param {ReturnType<import('./brainHost.mjs').createBrainHost>} [opts.brainHost]  FlyWire brains on this server (ws /api/brain)
 * @param {object} [opts.env]       process.env-like config
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {() => number} [opts.now]
 */
export function createFlyServer({
  distDir,
  publicDir = null,
  brainHost = null,
  env = process.env,
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  const token = env.BASE44_API_TOKEN || '';
  const apiBase = (env.BASE44_API_URL || 'https://app.base44.com').replace(/\/$/, '');
  const dailyCap = Number(env.FLY_APPS_DAILY_CAP || 25);
  const orgId = env.BASE44_ORGANIZATION_ID || undefined;
  const publicUrl = env.PUBLIC_URL || '';

  const perVisitor = rateLimiter(1, 120_000, now); // 1 real build / 2 min / visitor
  const global = rateLimiter(4, 60_000, now); // stay under the Platform API's 5/min
  const searchLimit = rateLimiter(30, 60_000, now);
  const statusLimit = rateLimiter(60, 60_000, now); // app-status polls (each may call the Platform API)
  const selfTestLimit = rateLimiter(6, 60_000, now);
  let day = new Date(now()).toISOString().slice(0, 10);
  let builtToday = 0;
  /** apps this server created: id -> {dna, name, createdAt, url?} (never proxy other ids) */
  const jobs = new Map();
  const searchCache = new Map();

  const base44 = async (method, path, body) => {
    const r = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 200) };
    }
    if (!r.ok) throw Object.assign(new Error(`Base44 API ${method} ${path} -> ${r.status}`), { status: r.status, data });
    return data;
  };

  async function search(req, res, url) {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
    if (!q) return json(res, 400, { error: 'missing_query' });
    if (!searchLimit(clientKey(req))) return json(res, 429, { error: 'rate_limited' });
    const hit = searchCache.get(q.toLowerCase());
    if (hit && now() - hit.at < 600_000) return json(res, 200, { query: q, results: hit.results, cached: true });
    const wiki = new URL('https://en.wikipedia.org/w/api.php');
    wiki.search = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: q,
      srlimit: '6',
      srprop: 'snippet',
      format: 'json',
      utf8: '1',
    });
    try {
      const r = await fetchImpl(wiki, { headers: { 'user-agent': 'FlyNeuralSandbox/0.2 (Base44 demo)' } });
      if (!r.ok) throw new Error(`wikipedia ${r.status}`);
      const data = await r.json();
      const results = (data?.query?.search ?? []).map((s) => ({
        title: s.title,
        snippet: stripHtml(s.snippet ?? '').slice(0, 220),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`,
      }));
      searchCache.delete(q.toLowerCase());
      searchCache.set(q.toLowerCase(), { at: now(), results });
      // bounded: drop the oldest entries (Map keeps insertion order)
      while (searchCache.size > SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
      return json(res, 200, { query: q, results });
    } catch (err) {
      return json(res, 502, { error: 'search_unavailable', detail: String(err.message ?? err) });
    }
  }

  async function createApp(req, res) {
    if (!token) return json(res, 503, { error: 'not_configured' });
    const body = await readJson(req);
    let fly;
    try {
      fly = decodeFlyFromBase44(String(body.dna ?? ''));
    } catch (err) {
      if (err instanceof DNAError) return json(res, 400, { error: 'invalid_dna' });
      throw err;
    }
    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      builtToday = 0;
    }
    if (builtToday >= dailyCap) return json(res, 429, { error: 'daily_cap' });
    // check the visitor first but only count the hit once the global limit lets the build through
    const visitor = clientKey(req);
    if (!perVisitor(visitor, false)) return json(res, 429, { error: 'rate_limited' });
    if (!global('all')) return json(res, 429, { error: 'busy' });
    perVisitor(visitor);

    const link = publicUrl ? `${publicUrl.replace(/\/$/, '')}/#dna=${fly.dna}` : '';
    const { title, prompt } = flyAppPrompt(fly.dna, fly.weights, { score: fly.score, url: link });
    builtToday++;
    try {
      const app = await base44('POST', '/api/apps', {
        initial_message: { content: prompt },
        name: `Fly ${fly.dna} · ${title}`.slice(0, 80),
        user_description: `Designed by fruit fly ${fly.dna} in the Fly Neural Sandbox.`,
        public_settings: 'public_without_login',
        ...(orgId ? { organization_id: orgId } : {}),
      });
      jobs.set(app.id, { dna: fly.dna, name: app.name, createdAt: now(), url: null, deploying: false });
      return json(res, 201, { id: app.id, name: app.name, title, state: app.status?.state ?? 'processing' });
    } catch (err) {
      builtToday--;
      const paywall = err.data?.status?.error_source === 'paywall';
      return json(res, 502, { error: paywall ? 'no_credits' : 'create_failed', status: err.status ?? null });
    }
  }

  async function appStatus(req, res, id) {
    const job = jobs.get(id);
    if (!job) return json(res, 404, { error: 'unknown_app' });
    if (!statusLimit(clientKey(req))) return json(res, 429, { error: 'rate_limited' });
    if (job.url) return json(res, 200, { id, state: 'live', url: job.url, name: job.name });
    try {
      const app = await base44('GET', `/api/apps/${id}`);
      const state = app?.status?.state ?? 'processing';
      if (state === 'error') {
        return json(res, 200, { id, state: 'error', reason: app.status?.error_source ?? 'build' });
      }
      if (state !== 'ready') return json(res, 200, { id, state: 'building', name: job.name });
      if (!job.deploying) {
        job.deploying = true;
        try {
          await base44('POST', `/api/apps/${id}/deploy`, {});
        } catch (err) {
          job.deploying = false; // try the deploy again on the next poll
          throw err;
        }
      }
      const pub = await base44('GET', `/api/apps/platform/${id}/published-url`);
      if (pub?.url) job.url = pub.url;
      return json(res, 200, { id, state: job.url ? 'live' : 'deploying', url: job.url, name: job.name });
    } catch (err) {
      return json(res, 200, { id, state: 'deploying', note: `retrying (${err.status ?? 'network'})` });
    }
  }

  async function serveStatic(req, res, url) {
    const root = resolve(distDir);
    let decoded;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      return json(res, 400, { error: 'bad_path' });
    }
    let path = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root)) return json(res, 403, { error: 'forbidden' });
    let info = null;
    // static data (connectome, meshes) straight from public/: it never changes while dist/ is being rebuilt
    if (publicDir) {
      const pub = resolve(publicDir);
      const candidate = join(pub, path);
      if (candidate.startsWith(pub)) {
        const s = await stat(candidate).catch(() => null);
        if (s?.isFile()) {
          file = candidate;
          info = s;
        }
      }
    }
    info ??= await stat(file).catch(() => null);
    if (!info || info.isDirectory()) {
      // a missing file is a 404; only page routes (no extension) fall back to the game
      if (extname(path) && extname(path) !== '.html') return json(res, 404, { error: 'not_found' });
      // SPA: unknown paths (and "/") get the game
      file = join(root, 'index.html');
      path = '/index.html';
      info = await stat(file).catch(() => null);
    }
    if (!info) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '5' });
      return res.end('The fly is still hatching (building the game)… refresh in a few seconds.');
    }
    const immutable = path.startsWith('/assets/');
    // revalidated files (index.html, the 7.7 MB connectome, meshes) get an ETag so repeat visits are a 304
    const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
    if (!immutable && req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': 'no-cache' });
      return res.end();
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      etag,
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    // the file can vanish between stat() and open (e.g. a rebuild replacing dist/): end this response, don't crash
    pipeline(createReadStream(file), res).catch(() => res.destroy?.());
  }

  /**
   * The visitor's address. The client controls the leftmost X-Forwarded-For
   * entries; the rightmost one is added by the proxy in front of this server.
   */
  function clientKey(req) {
    const hops = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    return hops[hops.length - 1] || req.socket?.remoteAddress || 'unknown';
  }

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://local');
    } catch {
      return json(res, 400, { error: 'bad_request' });
    }
    try {
      if (url.pathname === '/api/health') {
        return json(res, 200, { ok: true, realApps: Boolean(token), dailyCap, builtToday, brain: brainHost?.info() ?? null });
      }
      if (url.pathname === '/api/brain/info' && req.method === 'GET') {
        if (!brainHost) return json(res, 404, { error: 'no_brain_host' });
        return json(res, 200, brainHost.info());
      }
      if (url.pathname === '/api/brain/selftest' && req.method === 'GET') {
        if (!brainHost) return json(res, 404, { error: 'no_brain_host' });
        if (!selfTestLimit(clientKey(req))) return json(res, 429, { error: 'rate_limited' });
        return json(res, 200, await brainHost.selfTest());
      }
      if (url.pathname === '/api/search' && req.method === 'GET') return await search(req, res, url);
      if (url.pathname === '/api/fly-apps' && req.method === 'POST') return await createApp(req, res);
      const m = url.pathname.match(/^\/api\/fly-apps\/([a-f0-9]{24})$/);
      if (m && req.method === 'GET') return await appStatus(req, res, m[1]);
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' });
      return await serveStatic(req, res, url);
    } catch (err) {
      return json(res, err.status ?? 500, { error: err.status ? err.message : 'server_error' });
    }
  }

  return { handle, server: createServer(handle), jobs };
}
