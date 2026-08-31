#!/usr/bin/env node
/**
 * anime-indo.lol scraper — pure HTTP (Node 18+, zero runtime dependencies).
 *
 * Site is a server-rendered "OtakuDesu/Anitoki"-style template behind Cloudflare
 * CDN (no JS challenge, no API/XHR on the main site). Everything is scrapeable
 * with plain HTTP GET + HTML parsing.
 *
 * Stream chain (verified during development):
 *   episode page
 *     ├─ B-TUBE   iframe /btube3.php?url=<token>  -> VideoJS page -> <source src="googlevideo.com/videoplayback?...&expire=...&sig=...">  (MP4, signed, EXPIRING, pure HTTP)
 *     ├─ CEPAT    data-video https://xtwap.top/cepat.php?url=<token> -> JWPlayer page -> "file":"/play.php?n=..." -> HLS master -> 480/720/1080p variant playlists -> .ts segments (pure HTTP)
 *     └─ GDRIVE   data-video https://gdplayer.to/x/?<token> -> JWPlayer page whose config+sources come from a client-side
 *                 AES-CBC/PBKDF2-decrypted, single-use token. Re-deriving it in pure HTTP would mean bypassing the
 *                 service's obfuscated access control, so the scraper only reports the embed URL (documented below).
 */

'use strict';

const BASE = 'https://anime-indo.lol';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// HTTP layer: timeout, bounded retry, polite delay, in-run cache
// ---------------------------------------------------------------------------

const cache = new Map();
const DELAY_MS = 600; // politeness delay between outgoing requests
let lastReq = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function polite() {
  const wait = lastReq + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
}

async function fetchHtml(url, { referer, retries = 1 } = {}) {
  if (cache.has(url)) return cache.get(url);
  await polite();
  lastReq = Date.now();
  const headers = { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' };
  if (referer) headers.referer = referer;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      // 403/429/503: do NOT retry — log and surface
      if ([403, 429, 503].includes(res.status)) {
        throw Object.assign(new Error(`HTTP ${res.status} (no retry on rate-limit/blocked)`), { status: res.status });
      }
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      const html = await res.text();
      const entry = { html, finalUrl: res.url };
      cache.set(url, entry);
      return entry;
    } catch (e) {
      if (e.status) throw e; // 4xx: no retry
      lastErr = e;
      if (attempt < retries) await sleep(2000 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Tiny HTML helpers (no external parser dependency)
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, d) => String.fromCodePoint(parseInt(d, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] !== undefined ? m[2] : m[3]) : null;
}

function absUrl(u) {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return BASE + u;
  return new URL(u, BASE).href;
}

// Extract the inner HTML of the first element matching `cls` inside `html`.
function byClass(html, cls) {
  const m = html.match(new RegExp(`class\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)</div>`, 'i'));
  return m ? m[1] : '';
}

// All matches of a simple pattern (used on flat, server-rendered markup).
function findAll(re, html) {
  return [...html.matchAll(re)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// Pagination:  <div class="pag"><span>«</span> <span class='cur'>1</span>
//               <a href='/page/2/'>2</a> ... <a href='/page/10/'>10</a>
//               <a href='/page/2/'>»</a></div>
// «/» are prev/next (NOT page numbers). Current page is a <span class='cur'>.
// The last page is the max numeric anchor (appears after "...").
// ---------------------------------------------------------------------------
function parsePagination(html, url) {
  const pag = html.match(/<div class="pag">([\s\S]*?)<\/div>/);
  if (!pag) return { current: null, last: null, next: null, prev: null, hasNext: false, hasPrev: false };
  const block = pag[1];
  const cur = block.match(/class=['"]cur['"]>(\d+)/);
  const numbers = [...block.matchAll(/<a[^>]*href=['"]([^'"]+)['"][^>]*>\s*(\d+)\s*<\/a>/g)]
    .map((m) => ({ n: parseInt(m[2], 10), href: m[1] }));
  const next = block.match(/<a[^>]*href=['"]([^'"]+)['"][^>]*>\s*»\s*<\/a>/);
  const prev = block.match(/<a[^>]*href=['"]([^'"]+)['"][^>]*>\s*«\s*<\/a>/);
  const last = numbers.length ? Math.max(...numbers.map((x) => x.n)) : null;
  const current = cur ? parseInt(cur[1], 10) : null;
  return {
    current,
    last,
    next: next ? absUrl(next[1]) : null,
    prev: prev && prev[1] !== '#' ? absUrl(prev[1]) : null,
    hasNext: !!next && next[1] !== '#',
    hasPrev: !!prev && prev[1] !== '#',
  };
}

// ---------------------------------------------------------------------------
// Item parsers (three shapes found on the site)
// ---------------------------------------------------------------------------

// 1) Homepage "Update Terbaru" — <a href="/slug-episode-N/"><div class="list-anime">...
function parseUpdateCards(html) {
  const out = [];
  const re = /<a[^>]*href=["']([^"']+)["'][^>]*>\s*<div class="list-anime">([\s\S]*?)<\/div>\s*<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const inner = m[2];
    const img = inner.match(/<img[^>]*>/);
    const title = inner.match(/<p>([\s\S]*?)<\/p>/);
    const eps = inner.match(/class="eps">([^<]*)</);
    out.push({
      title: title ? stripTags(title[1]) : null,
      url: absUrl(m[1]),
      image: img ? absUrl(attr(img[0], 'data-original') || attr(img[0], 'src')) : null,
      type: null,
      status: null,
      latest_episode: eps ? parseInt(eps[1], 10) : null,
      genres: [],
      description: null,
    });
  }
  return out;
}

// 2) Homepage "Popular" — <table class="ztable"> rows
function parsePopular(html) {
  const out = [];
  const re = /<table class="ztable"[\s\S]*?<\/table>/g;
  let t;
  while ((t = re.exec(html))) {
    const block = t[0];
    const link = block.match(/<a[^>]*href=["']([^"']+)["']/);
    const img = block.match(/<img[^>]*>/);
    const descA = block.match(/class="zvidesc">\s*<a[^>]*>([\s\S]*?)<\/a>/);
    const genres = block.match(/<br>\s*([\s\S]*?)\s*<\/td>/);
    out.push({
      title: descA ? stripTags(descA[1]) : null,
      url: link ? absUrl(link[1]) : null,
      image: img ? absUrl(attr(img[0], 'src')) : null,
      type: null,
      status: null,
      latest_episode: null,
      year: null,
      genres: genres ? stripTags(genres[1]).split(',').map((s) => s.trim()).filter(Boolean) : [],
      description: null,
    });
  }
  return out;
}

// 3) Search / Genre listing — <table class="otable"> rows with <span class="label">
function parseOtable(html) {
  const out = [];
  const re = /<table class="otable"[\s\S]*?<\/table>/g;
  let t;
  while ((t = re.exec(html))) {
    const block = t[0];
    const body = html.indexOf(block) === -1 ? block : block;
    const link = block.match(/<a[^>]*href=["']([^"']+)["']/);
    const img = block.match(/<img[^>]*>/);
    const descA = block.match(/class="videsc">\s*<a[^>]*>([\s\S]*?)<\/a>/);
    const labels = [...block.matchAll(/<span class="label">([\s\S]*?)<\/span>/g)].map((m) => stripTags(m[1]));
    const des = block.match(/<p class="des">([\s\S]*?)<\/p>/);

    // labels are free text: type (TV/Movie/OVA/ONA...), status (Currently Airing/...),
    // duration ("24 min. per ep."), year (4 digits)
    let type = null, status = null, duration = null, year = null;
    for (const l of labels) {
      if (/^\d{4}$/.test(l)) year = parseInt(l, 10);
      else if (/min\.?\s*per/i.test(l)) duration = l;
      else if (/^tv$|^movie$|^ova$|^ona$|^special$/i.test(l)) type = l;
      else status = status ? status + ', ' + l : l;
    }
    out.push({
      title: descA ? stripTags(descA[1]) : null,
      url: link ? absUrl(link[1]) : null,
      image: img ? absUrl(attr(img[0], 'src')) : null,
      type, status, latest_episode: null, year, duration,
      genres: [],
      description: des ? stripTags(des[1]) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const envelope = (command, url, data, pagination) => ({
  source: 'anime-indo.lol',
  command,
  url,
  ok: true,
  pagination: pagination || null,
  data,
});

async function home(page = 1) {
  const url = page === 1 ? BASE + '/' : `${BASE}/page/${page}/`;
  const { html, finalUrl } = await fetchHtml(url);
  const update = parseUpdateCards(html);
  const popular = parsePopular(html);
  return envelope('home', finalUrl, {
    sections: { 'update-terbaru': update, popular },
    counts: { 'update-terbaru': update.length, popular: popular.length },
  }, parsePagination(html, url));
}

async function search(query, page = 1) {
  const url = page === 1 ? `${BASE}/search.php?q=${encodeURIComponent(query)}` : `${BASE}/search/${encodeURIComponent(query)}/page/${page}/`;
  const { html, finalUrl } = await fetchHtml(url);
  const items = parseOtable(html).map((it) => ({
    ...it,
    // search rows carry type/status/year labels (e.g. "TV", "24 min. per ep.", "2004")
  }));
  const title = (html.match(/<div class="title">([^<]*)<\/div>/) || [])[1];
  return envelope('search', finalUrl, {
    query,
    heading: title ? stripTags(title) : null,
    items,
  }, parsePagination(html, url));
}

async function genre(slug, page = 1) {
  const s = String(slug).trim().toLowerCase().replace(/\s+/g, '-');
  const url = page === 1 ? `${BASE}/genres/${s}/` : `${BASE}/genres/${s}/page/${page}/`;
  const { html, finalUrl } = await fetchHtml(url);
  const items = parseOtable(html);
  const heading = (html.match(/<div class="title">([^<]*)<\/div>/) || [])[1];
  return envelope('genre', finalUrl, {
    genre: heading ? stripTags(heading).replace(/^genre\s+/i, '') : s,
    items,
  }, parsePagination(html, url));
}

async function genres() {
  const { html, finalUrl } = await fetchHtml(`${BASE}/list-genre/`);
  const start = html.indexOf('class="list-genre"');
  if (start === -1) return envelope('genres', finalUrl, { count: 0, genres: [] });
  let end = html.indexOf('<div class="nganan">', start);
  const block = html.slice(start, end !== -1 ? end : start + 20000);
  const re = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g;
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push({ name: stripTags(m[2]), slug: m[1].replace(/^\/genres\//, '').replace(/\/$/, '') });
  return envelope('genres', finalUrl, { count: out.length, genres: out });
}

async function detail(url) {
  const abs = absUrl(url);
  const { html, finalUrl } = await fetchHtml(abs);

  const h1 = html.match(/<h1 class="title">([^<]*)<\/h1>/);
  const detailBlock = byClass(html, 'detail');
  const poster = detailBlock.match(/<img[^>]*>/);
  const h2 = detailBlock.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
  const genreLinks = [...detailBlock.matchAll(/<li><a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g)].map((m) => stripTags(m[2]));
  const synopsis = detailBlock.match(/<p>([\s\S]*?)<\/p>/);

  // Episode list: <div class="title">X Episode List</div> ... <div class="ep"> <a href="/slug-episode-N/"> N</a>
  const epBlock = (html.match(/class="ep">([\s\S]*?)<\/div>/) || [])[1] || '';
  const episodes = [];
  const seen = new Set();
  for (const m of epBlock.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g)) {
    const u = absUrl(m[1]);
    if (seen.has(u)) continue; // de-duplicate
    seen.add(u);
    const nm = m[1].match(/episode-(\d+)/);
    episodes.push({
      number: nm ? parseInt(nm[1], 10) : null,
      title: null,
      url: u,
      date: null,
      sub: true,   // this site is Subtitle-Indonesia only (titles carry "Sub Indo")
      dub: false,
    });
  }
  episodes.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

  return envelope('detail', finalUrl, {
    title: h1 ? stripTags(h1[1]) : null,
    alternative_title: h2 ? (stripTags(h2[1]) !== (h1 ? stripTags(h1[1]) : '') ? stripTags(h2[1]) : null) : null,
    poster: poster ? absUrl(attr(poster[0], 'src')) : null,
    cover: null,
    rating: null,           // not present in this template
    rating_count: null,     // not present
    status: null,           // not present
    type: null,             // not present
    studio: null,           // not present
    producer: null,         // not present
    duration: null,         // not present
    season: null,           // not present
    release_year: null,     // not present
    country: null,          // not present
    genres: genreLinks,
    tags: [],               // not present
    description: synopsis ? stripTags(synopsis[1]) : null,
    synopsis: synopsis ? stripTags(synopsis[1]) : null,
    related: null,          // not present
    episodes,
    episode_count: episodes.length,
  });
}

async function episode(url) {
  const abs = absUrl(url);
  const { html, finalUrl } = await fetchHtml(abs);

  const h1 = html.match(/<h1 class="title">([^<]*)<\/h1>/);
  const titleText = h1 ? stripTags(h1[1]) : null;
  const nm = (url.match(/episode-(\d+)/) || [])[1];

  const iframe = html.match(/<iframe[^>]*id="tontonin"[^>]*>/);
  const mirrors = [...html.matchAll(/<a[^>]*class="server(?:\s+cur)?"[^>]*data-video="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    name: stripTags(m[2]),
    is_default: /class="server cur"/.test(m[0]),
    embed: absUrl(m[1]),
  }));
  const prev = (html.match(/<a[^>]*href=["']([^"']+)["'][^>]*>&laquo; Prev/) || [])[1] || null;
  const next = (html.match(/<a[^>]*href=["']([^"']+)["'][^>]*>Next &rsaquo;/) || [])[1] || null;
  const allEps = (html.match(/<a[^>]*href=["']([^"']+)["'][^>]*>Semua Episode/) || [])[1] || null;

  return envelope('episode', finalUrl, {
    title: titleText,
    number: nm ? parseInt(nm, 10) : null,
    url: finalUrl,
    date: null, // no publish date rendered on the page
    sub: /sub(titule)?\s*(indonesia|indo)/i.test(titleText || ''),
    dub: false, // sub-only site; no dub track/link rendered
    player_iframe: iframe ? absUrl(attr(iframe[0], 'src')) : null,
    mirrors,
    prev: prev ? absUrl(prev) : null,
    next: next ? absUrl(next) : null,
    all_episodes: allEps ? absUrl(allEps) : null,
  });
}

async function stream(url) {
  const abs = absUrl(url);
  const ep = await episode(abs);
  const out = {
    episode: ep.data,
    sources: [],
    notes: [
      'GDRIVE mirror: gdplayer.to loads its JWPlayer config from a client-side AES-CBC/PBKDF2-decrypted, single-use token; ' +
      'resolving it in pure HTTP would require bypassing the service\'s obfuscated access control, so only the embed URL is reported.',
    ],
  };

  for (const mir of ep.data.mirrors) {
    if (mir.name === 'B-TUBE') {
      try {
        // Re-resolve up to 3 times: the signed URL embeds the generator's egress IP
        // (ip=...), and sandboxes behind a rotating-IP pool can draw a different egress
        // on the next hop. Bounded retries keep this honest without hammering the site.
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const bust = attempt ? `&_b=${Date.now()}` : '';
            const { html: ph } = await fetchHtml(mir.embed + bust, { referer: abs });
            const src = ph.match(/<source[^>]*src="([^"]+)"/);
            if (src) {
              const u = decodeEntities(src[1]);
              const expire = parseInt(new URL(u).searchParams.get('expire') || '0', 10);
              out.sources.push({
                mirror: 'B-TUBE',
                kind: 'mp4',
                url: u,
                signed_ip: new URL(u).searchParams.get('ip'),
                expires_at_unix: expire || null,
                expiring: true, // googlevideo signed URL (expire + sig params)
                verified: null, // filled by test suite byte check
              });
              break;
            }
            lastErr = new Error('no <source> in player response');
          } catch (e) { lastErr = e; }
        }
        if (!out.sources.some((s) => s.mirror === 'B-TUBE')) {
          out.sources.push({ mirror: 'B-TUBE', kind: 'mp4', url: null, error: String(lastErr?.message || lastErr), expiring: true });
        }
      } catch (e) {
        out.sources.push({ mirror: 'B-TUBE', kind: 'mp4', url: null, error: String(e.message || e), expiring: true });
      }
    } else if (mir.name === 'CEPAT') {
      try {
        const { html: ph } = await fetchHtml(mir.embed, { referer: abs });
        const file = ph.match(/"file"\s*:\s*"([^"]+)"/);
        if (file) {
          const masterUrl = new URL(decodeEntities(file[1]), new URL(mir.embed).origin).href;
          const { html: master } = await fetchHtml(masterUrl, { referer: mir.embed });
          const variants = [];
          const lines = master.split(/\r?\n/);
          for (let i = 0; i < lines.length - 1; i++) {
            if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
              const res = (lines[i].match(/RESOLUTION=([x\d]+)/) || [])[1];
              const quality = res && res.includes('x') ? `${parseInt(res.split('x')[1], 10)}p` : null;
              const rel = lines[i + 1];
              variants.push({ resolution: res || null, quality, url: new URL(rel, masterUrl).href });
            }
          }
          out.sources.push({ mirror: 'CEPAT', kind: 'hls', url: masterUrl, variants, expiring: false, verified: null });
        }
      } catch (e) {
        out.sources.push({ mirror: 'CEPAT', kind: 'hls', url: null, error: String(e.message || e), expiring: false });
      }
    } else {
      out.sources.push({ mirror: mir.name, kind: 'embed', url: mir.embed, expiring: true, resolvable: false, note: 'client-side token decryption; see notes' });
    }
  }
  return envelope('stream', abs, out);
}


module.exports = { BASE, home, search, genre, genres, detail, episode, stream, parsePagination, _fetchHtml: fetchHtml, _cache: cache };
