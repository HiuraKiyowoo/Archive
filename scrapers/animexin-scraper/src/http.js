// Transport HTTP untuk animexin.dev — zero dependency, Node >= 18 (fetch bawaan).
//
// Temuan recon (2026-08-31):
// - Situs di belakang Cloudflare TAPI Node native fetch LOLOS (bukan blokir
//   TLS fingerprint seperti nhentai). Cukup User-Agent browser.
// - Path /anime/... SELALU 403 "Just a moment" (arsip custom post type
//   diproteksi CF). Gunakan /?post_type=anime dan URL series tanpa prefix
//   /anime/ — lihat catatan di parse.js.
// - Semua halaman memuat script `__CF$cv$params` (challenge-platform). Itu
//   script verifikasi pasif CF, BUKAN penanda blokir. Penanda blokir yang
//   benar = HTTP 403 + <title>Just a moment...</title>.

export const BASE = 'https://animexin.dev';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(status, url, body = '') {
    super(`HTTP ${status} untuk ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export class BlockedError extends Error {
  constructor(url) {
    super(
      `Cloudflare memblokir ${url} (403 "Just a moment"). ` +
        'Path /anime/* memang selalu diblokir di situs ini — pakai URL tanpa prefix /anime/.'
    );
    this.name = 'BlockedError';
    this.url = url;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cache in-memory: menghindari request ganda saat satu operasi butuh
// halaman yang sama berulang (mis. episode() membaca halaman series).
const cache = new Map();
const TTL = 10 * 60 * 1000;

/** Satu antrean serial + spacing, supaya tidak menghajar situs. */
let chain = Promise.resolve();
let lastAt = 0;
const MIN_GAP = 700;

function serial(fn) {
  const run = chain.then(async () => {
    const gap = Date.now() - lastAt;
    if (gap < MIN_GAP) await sleep(MIN_GAP - gap);
    try {
      return await fn();
    } finally {
      lastAt = Date.now();
    }
  });
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function isBlockPage(status, body) {
  return status === 403 && body.includes('<title>Just a moment');
}

/**
 * GET satu URL dan kembalikan teksnya.
 * @param {string} url URL absolut atau path relatif terhadap BASE.
 * @param {{retries?: number, timeout?: number, cache?: boolean,
 *          allow404?: boolean}} [opt]
 */
export async function fetchText(url, opt = {}) {
  const {
    retries = 3,
    timeout = 30000,
    cache: useCache = true,
    allow404 = false,
  } = opt;
  const full = url.startsWith('http') ? url : BASE + url;

  if (useCache) {
    const hit = cache.get(full);
    if (hit && Date.now() - hit.at < TTL) return hit.body;
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1200 * attempt);
    try {
      const body = await serial(async () => {
        const res = await fetch(full, {
          headers: {
            'user-agent': UA,
            accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'id-ID,id;q=0.9,en;q=0.8',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeout),
        });
        const text = await res.text();
        if (isBlockPage(res.status, text)) throw new BlockedError(full);
        if (res.status === 404 && allow404) return null;
        if (!res.ok) throw new HttpError(res.status, full, text.slice(0, 300));
        return text;
      });
      if (useCache && body !== null) cache.set(full, { at: Date.now(), body });
      return body;
    } catch (err) {
      lastErr = err;
      // Blokir CF & 404 bukan masalah transport — jangan diulang.
      if (err instanceof BlockedError) throw err;
      if (err instanceof HttpError && err.status < 500) throw err;
    }
  }
  throw lastErr;
}

/** Kosongkan cache in-memory (dipakai test). */
export function clearCache() {
  cache.clear();
}
