'use strict';
/**
 * nhentai-scraper — zero-dependency nhentai scraper.
 * Target spec: https://nhentai.net  (HTTP-first, server-rendered + JSON inline)
 *
 * Key findings (verified 2026-08):
 *  - Gallery page embeds a <script>{status,body}</script> where body is the
 *    FULL gallery entity: id, media_id, title{english,japanese,pretty}, tags[],
 *    num_pages, pages[{number,path,width,height,thumbnail,...}], num_favorites,
 *    scanlator, related, comments.
 *  - Search page `/search/?q=...&page=N` returns cover-grid of gallery cards.
 *  - Full page images live at `i.nhentai.net/galleries/{media_id}/{n}.webp`
 *    (verified 210KB webp). Thumbnails at `t{n}.nhentai.net/galleries/.../{n}t.webp`.
 *  - Cover in entity may carry a double extension bug (`cover.webp.webp`).
 */

const { spawn } = require('node:child_process');

const BASE = 'https://nhentai.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * HTTP GET transported by `curl` (installed on host).
 * WHY curl: Cloudflare blocks Node's native fetch via TLS fingerprint
 * (JA3/JA4) on nhentai (~always 403 "Just a moment..."). curl's fingerprint
 * passes and returns the real gallery page (verified: HTTP 200, 76KB).
 *
 * Rate-limit: nhentai's Cloudflare rate-limits rapid back-to-back fetches.
 * All requests go through a shared serial queue with a minimum spacing
 * (default 1500ms) so batches stay under the throttle, plus retries with
 * backoff when a 403 / Cloudflare interstitial slips through.
 */
function rawCurl(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '-sS', '--max-time', '20', '-L', '-A', UA,
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      '-H', 'Referer: ' + BASE + '/',
      '-w', '\n%{http_code}',
      url,
    ];
    const proc = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`curl exit ${code}: ${err.trim()}`));
      const nl = out.lastIndexOf('\n');
      const status = Number(out.slice(nl + 1).trim());
      const text = out.slice(0, nl);
      resolve({ status, text });
    });
  });
}

const isCloudflareWall = (r) =>
  r.status === 403 || /<title>Just a moment/i.test(r.text);

/** Shared serialized + spaced HTTP GET with retry/backoff. */
let _lastReq = 0;
async function httpGet(url, { spacingMs = 1500, retries = 4 } = {}) {
  let last;
  for (let attempt = 0; attempt < retries; attempt++) {
    // enforce minimum spacing from the previous request to dodge rate limit
    const elapsed = Date.now() - _lastReq;
    if (elapsed < spacingMs) await new Promise((r) => setTimeout(r, spacingMs - elapsed));
    const res = await rawCurl(url);
    _lastReq = Date.now();
    if (!isCloudflareWall(res)) return res; // success (any real HTTP code)
    last = res;
    // backoff before retrying a wall/403 (7s, 14s, 28s)
    await new Promise((r) => setTimeout(r, 7000 * Math.pow(2, attempt)));
  }
  if (last) return last;
  throw new Error(`httpGet ${url}: all retries failed`);
}

/**
 * Extract the gallery entity from a gallery page's inline <script> blocks.
 * NOTE: the page embeds MORE THAN ONE parseable {status,body} JSON block —
 * an earlier one is app/zone state ({"zones":...}). We must return the block
 * whose decoded body is the gallery (has media_id), not the first one.
 */
function extractGalleryJson(html) {
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const block = m[1].trim();
    if (!block.startsWith('{')) continue;
    let outer;
    try { outer = JSON.parse(block); } catch { continue; }
    if (outer && typeof outer.body === 'string') {
      let inner;
      try { inner = JSON.parse(outer.body); } catch { continue; }
      if (inner && inner.media_id) return inner;
    }
  }
  return null;
}

/**
 * Fetch a gallery by numeric id. Resolves to a normalized object.
 * 403/CF-wall retries are in `httpGet`; here we also retry the soft case:
 * Cloudflare sometimes returns HTTP 200 whose body is a challenge page
 * (no gallery JSON) when the egress IP is rate-limited.
 */
async function getGallery(id, { tries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    const url = `${BASE}/g/${id}/`;
    const { status, text } = await httpGet(url);
    if (status !== 200) {
      lastErr = new Error(`gallery ${id}: HTTP ${status}`);
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    const g = extractGalleryJson(text);
    if (g && g.media_id) return normalizeGallery(g, url);
    lastErr = new Error(`gallery ${id}: inline JSON not found (page len ${text.length}, title ${/<title>([^<]*)</.exec(text)?.[1] || '?'})`);
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw lastErr;
}

function normalizeGallery(g, url) {
  const pages = (g.pages || []).map((p) => ({
    number: p.number,
    path: p.path,                       // galleries/{media_id}/{n}.webp
    width: p.width,
    height: p.height,
    thumbnailPath: p.thumbnail,         // may carry double-ext bug
  }));
  return {
    id: g.id,
    url,
    media_id: g.media_id,
    title: {
      english: g.title && g.title.english,
      japanese: g.title && g.title.japanese,
      pretty: g.title && g.title.pretty,
    },
    scanlator: g.scanlator || '',
    upload_date: g.upload_date || g.uploaded_at || null,
    num_pages: g.num_pages,
    num_favorites: g.num_favorites,
    tags: (g.tags || []).map((t) => ({
      id: t.id, type: t.type, name: t.name, slug: t.slug, url: t.url,
      count: typeof t.count === 'number' ? t.count : undefined,
    })),
    pages,
    cover: {
      path: (g.cover && g.cover.path) || (pages[0] && pages[0].path),
      width: g.cover && g.cover.width,
      height: g.cover && g.cover.height,
    },
    related: Array.isArray(g.related) ? g.related.map((r) => r.id) : [],
  };
}

/** Build absolute URL for a page of a gallery (handles the .webp.webp bug). */
function pageUrl(media_id, pagePath) {
  const clean = (p) => (p.endsWith('.webp.webp') ? p.slice(0, -5) : p);
  return `https://i.nhentai.net/galleries/${media_id}/${clean(pagePath).split('/').pop()}`;
}

/**
 * Search galleries. Returns { total, pages, results: [card,...] }.
 * A card is a light object parsed from the cover grid.
 */
async function search(query, page = 1) {
  const url = `${BASE}/search/?q=${encodeURIComponent(query)}&page=${page}`;
  const { status, text } = await httpGet(url);
  if (status !== 200) throw new Error(`search "${query}": HTTP ${status}`);
  return parseSearchResults(text);
}

/** Parse the search/home cover-grid into light gallery cards. */
function parseSearchResults(html) {
  const results = [];
  const re = /class="gallery"[^>]*>.*?<a[^>]*href="\/g\/(\d+)\/"[\s\S]*?<img[^>]*?src="([^"]+)"[^>]*alt="([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    results.push({ id: Number(m[1]), thumb: m[2], title: m[3] });
  }
  // fallback: looser scan if strict regex found nothing
  if (!results.length) {
    const re2 = /href="\/g\/(\d+)\/"[^>]*>[\s\S]*?<img[^>]*?src="([^"]+)"[\s\S]*?alt="([^"]*)"/g;
    while ((m = re2.exec(html)) !== null) {
      results.push({ id: Number(m[1]), thumb: m[2], title: m[3] });
    }
  }
  const pagenav = /class="pagination"[^>]*>[\s\S]*?(\d+)\s*&rsaquo;/.exec(html);
  const total = pagenav ? Number(pagenav[1]) : results.length;
  return { total, results };
}

module.exports = { getGallery, search, extractGalleryJson, normalizeGallery, pageUrl, httpGet, BASE };