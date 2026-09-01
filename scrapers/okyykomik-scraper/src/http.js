// okyykomik-scraper: transport HTTP zero-dependency.
//
// Temuan recon (2026-09-01):
// - www.okyykomik.my.id = blog BLOGGER (Blogspot) dgn custom domain (ghs.google.com).
//   Tidak ada WordPress/Madara, tidak ada Cloudflare challenge.
// - robots.txt: Disallow /search dan /share-widget, Allow: / . Feed TIDAK dilarang,
//   jadi scraper ini HANYA memakai /feeds/* dan halaman post — tidak pernah /search.
// - Semua data tersedia lewat Blogger Feed API: /feeds/posts/{summary|default}?alt=json
//   Envelope: { feed: { openSearch$totalResults, entry: [...] } }
//   Post tunggal: /feeds/posts/default/{postId}?alt=json  -> { entry: {...} }
//   id ngawur -> HTTP 404 body "Entry not found" (bukan JSON).

const BASE = "https://www.okyykomik.my.id";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const SPACING_MS = 350;
const MAX_RETRY = 3;
const TIMEOUT_MS = 45000;

const cache = new Map();
let lastHit = 0;

/** Error HTTP (status non-2xx). */
export class HttpError extends Error {
  constructor(status, url, message) {
    super(message || `HTTP ${status} untuk ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

/** Error format respons (bukan JSON / envelope tidak dikenal). */
export class FeedError extends Error {
  constructor(url, message) {
    super(message);
    this.name = "FeedError";
    this.url = url;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function spacing() {
  const gap = Date.now() - lastHit;
  if (gap < SPACING_MS) await sleep(SPACING_MS - gap);
  lastHit = Date.now();
}

/** GET mentah dengan retry. 4xx dianggap permanen (tidak diulang). */
export async function rawGet(url, { asText = false } = {}) {
  const key = (asText ? "T:" : "J:") + url;
  if (cache.has(key)) return cache.get(key);

  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
    await spacing();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": UA,
          accept: asText ? "text/html,application/xhtml+xml,*/*" : "application/json,*/*",
          "accept-language": "id-ID,id;q=0.9,en;q=0.8",
        },
        redirect: "follow",
        signal: ac.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 200).trim();
        const err = new HttpError(res.status, url, `HTTP ${res.status} untuk ${url}${body ? ` — ${body}` : ""}`);
        if (res.status >= 400 && res.status < 500) throw err;
        lastErr = err;
      } else {
        const text = await res.text();
        const out = { url: res.url, text };
        cache.set(key, out);
        return out;
      }
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof HttpError && e.status >= 400 && e.status < 500) throw e;
      lastErr = e;
    }
    if (attempt < MAX_RETRY) await sleep(600 * attempt);
  }
  throw lastErr;
}

/** GET JSON feed Blogger. */
export async function feedGet(path, params = {}) {
  const u = new URL(path.startsWith("http") ? path : BASE + path);
  u.searchParams.set("alt", "json");
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  const { text, url } = await rawGet(u.toString());
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new FeedError(url, `Respons bukan JSON (${text.slice(0, 80)})`);
  }
  return { url, data };
}

/** GET halaman HTML. */
export async function htmlGet(path) {
  const url = path.startsWith("http") ? path : BASE + path;
  const { text } = await rawGet(url, { asText: true });
  return { url, html: text };
}

export function clearCache() {
  cache.clear();
}

export { BASE, UA };
