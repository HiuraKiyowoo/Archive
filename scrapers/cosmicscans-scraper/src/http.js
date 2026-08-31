// cosmicscans-scraper: transport HTTP zero-dependency.
//
// Temuan recon (2026-08-31):
// - Situs 03.cosmicscans.to = SvelteKit tanpa SSR (shell kosong), semua data
//   diambil frontend dari REST API publik `https://cdncid.csmcscns.id`.
// - Base API + admin diambil dari chunk build (PUBLIC_COSMIC_API_BASE_URL).
// - Tidak ada Cloudflare challenge. Node native fetch lolos 200 di semua route.
// - Envelope API selalu `{ success: true, data: ..., cursor?: {...} }`.
//   Respons dengan `success !== true` dianggap gagal (mengikuti klien resminya).

const API_BASE = "https://cdncid.csmcscns.id";
const ADMIN_BASE = "https://dash.csmcscns.id";
const SITE = "https://03.cosmicscans.to";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TIMEOUT_MS = 30000;
const SPACING_MS = 400;

/** Error HTTP/transport dengan status + url. */
export class HttpError extends Error {
  constructor(message, url, status = 0, body = "") {
    super(message);
    this.name = "HttpError";
    this.url = url;
    this.status = status;
    this.body = body;
  }
}

/** Error khusus saat API balas 200 tapi envelope-nya bukan success:true. */
export class ApiError extends Error {
  constructor(message, url, payload = null) {
    super(message);
    this.name = "ApiError";
    this.url = url;
    this.payload = payload;
  }
}

const cache = new Map();
let lastAt = 0;

export function clearCache() {
  cache.clear();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Bangun URL + query. Array => diulang sebagai param yang sama
 * (persis serializer klien resmi: searchParams.append per elemen).
 * Nilai null/undefined dibuang.
 */
export function buildUrl(path, params = {}, base = API_BASE) {
  const url = new URL(path.startsWith("http") ? path : base + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item === null || item === undefined || item === "") continue;
        url.searchParams.append(k, String(item));
      }
      continue;
    }
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/** GET mentah, balas { status, text }. Serial + spacing, retry hanya 5xx/jaringan. */
export async function fetchRaw(url, { tries = 3, referer = SITE + "/" } = {}) {
  const wait = SPACING_MS - (Date.now() - lastAt);
  if (wait > 0) await sleep(wait);

  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
          Origin: SITE,
          Referer: referer,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      lastAt = Date.now();
      const text = await res.text();

      // 4xx = permanen (termasuk 404 "tidak ditemukan" & 400 validasi) -> jangan retry.
      if (res.status >= 400 && res.status < 500) {
        return { status: res.status, text };
      }
      if (!res.ok) {
        lastErr = new HttpError(`HTTP ${res.status}`, url, res.status, text.slice(0, 300));
        if (attempt < tries) await sleep(1500 * attempt);
        continue;
      }
      return { status: res.status, text };
    } catch (err) {
      lastAt = Date.now();
      lastErr = new HttpError(err.message || "network error", url, 0);
      if (attempt < tries) await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}

/**
 * GET JSON dengan validasi envelope. `data` dibalikkan apa adanya bersama
 * `cursor` kalau ada. Cache in-memory per URL.
 */
export async function apiGet(path, params = {}, { base = API_BASE, cache: useCache = true } = {}) {
  const url = buildUrl(path, params, base);
  if (useCache && cache.has(url)) return cache.get(url);

  const { status, text } = await fetchRaw(url);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpError(`respons bukan JSON (HTTP ${status})`, url, status, text.slice(0, 300));
  }

  if (status >= 400) {
    // API balas pesan terstruktur: {success:false,message:"Manga tidak ditemukan"}
    // atau {statusCode:400,message:"querystring/limit must be >= 1"}
    const msg = json.message || json.error || `HTTP ${status}`;
    throw new HttpError(msg, url, status, text.slice(0, 300));
  }
  if (!json || typeof json !== "object" || json.success !== true) {
    throw new ApiError("envelope API tidak success:true", url, json);
  }

  const out = { url, data: json.data, cursor: json.cursor ?? null, raw: json };
  if (useCache) cache.set(url, out);
  return out;
}

export { API_BASE, ADMIN_BASE, SITE, UA };
