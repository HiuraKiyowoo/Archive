// moviezone-scraper: transport HTTP zero-dependency.
//
// Temuan recon (2026-09-01, semua diukur lewat request nyata):
// - moviezone.web.id = Next.js 14 App Router di Vercel (`x-powered-by: next.js`,
//   `server: Vercel`). TANPA Cloudflare, TANPA challenge apa pun.
//   Matriks UA {Chrome, curl default, UA kosong} -> ketiganya HTTP 200, 37.354 byte
//   identik. Jadi UA tidak digating; header wajar sudah cukup.
// - HTML-nya SSR tapi daftar film TIDAK ada di HTML awal — komponen client
//   mengisinya lewat fetch ke route handler internal. Jadi jangan parse HTML,
//   pakai API-nya.
// - API ditemukan dengan mengunduh chunk `/_next/static/chunks/**` lalu grep
//   literal `/api/movies/...`. Chunk per-halaman menyimpan endpoint yang beda:
//   page.js (hero/trending/popular/top-rated/latest/upcoming),
//   search/page.js (search), genre/[genre]/page.js (discover + genres),
//   movie/[slug]/page.js (detail + episodes).
// - Data aslinya dari TMDB: pesan error upstream bocor apa adanya, contoh
//   `{"error":"TMDB /movie/99999999 → 404 Not Found"}`. Poster/backdrop
//   langsung ke image.tmdb.org. Nama genre sudah dilokalkan ke bahasa Indonesia.
//
// CATATAN robots.txt (JUJUR, jangan disembunyikan):
//   robots.txt situs ini berisi `Disallow: /api/`. Artinya pemilik situs tidak
//   mengizinkan crawler otomatis menyentuh /api/*. Scraper ini MEMAKAI /api/*
//   karena itu satu-satunya sumber data (HTML tidak memuat daftarnya) dan
//   karena user memintanya secara eksplisit. Konsekuensinya ditanggung pemakai:
//   spacing antar-request dibuat longgar (1,2 s) dan tidak ada paralelisme.
//   Kalau kamu memakai ini di produksi, hormati keputusan pemilik situs.

const BASE = "https://moviezone.web.id";
const API = `${BASE}/api/movies`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Situs tanpa WAF, tapi /api/ dilarang robots -> sengaja pelan, serial, 1 koneksi.
const SPACING_MS = 1200;
const MAX_RETRY = 3;
const TIMEOUT_MS = 45000;

const cache = new Map();
let lastHit = 0;
let queue = Promise.resolve();

/** Error HTTP (status non-2xx). `body` menyimpan pesan upstream kalau ada. */
export class HttpError extends Error {
  constructor(status, url, message, body) {
    super(message || `HTTP ${status} untuk ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body ?? null;
  }
}

/** Error format respons (bukan JSON / envelope tidak dikenal). */
export class ApiError extends Error {
  constructor(url, message) {
    super(message);
    this.name = "ApiError";
    this.url = url;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function spacing() {
  const gap = Date.now() - lastHit;
  if (gap < SPACING_MS) await sleep(SPACING_MS - gap);
  lastHit = Date.now();
}

/**
 * GET mentah, di-antrikan serial (satu koneksi) + retry.
 *
 * 4xx dianggap PERMANEN (tidak diulang) — termasuk 400 "Query wajib diisi".
 * 5xx diulang, TAPI 500 di sini sering bukan gangguan sementara: route handler
 * meneruskan 404 TMDB sebagai 500 (`TMDB /movie/x → 404 Not Found`). Kalau
 * body-nya mengandung penanda 404 upstream, retry dilewati supaya tidak
 * membuang 3 request untuk slug yang memang tidak ada.
 */
export function rawGet(url) {
  const run = async () => {
    if (cache.has(url)) return cache.get(url);

    let lastErr;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
      await spacing();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          headers: {
            "user-agent": UA,
            accept: "application/json,*/*",
            "accept-language": "id-ID,id;q=0.9,en;q=0.8",
            referer: BASE + "/",
          },
          redirect: "follow",
          signal: ac.signal,
        });
        clearTimeout(timer);

        const text = await res.text();

        if (!res.ok) {
          const pesan = pesanUpstream(text);
          const err = new HttpError(
            res.status,
            url,
            `HTTP ${res.status} untuk ${url}${pesan ? ` — ${pesan}` : ""}`,
            pesan,
          );
          // 4xx permanen; 500 yang isinya 404 upstream juga permanen.
          if (res.status < 500) throw err;
          if (/→\s*404\b|not found/i.test(pesan || "")) throw err;
          lastErr = err;
        } else {
          const out = { url: res.url, text };
          cache.set(url, out);
          return out;
        }
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof HttpError && e.status < 500) throw e;
        if (e instanceof HttpError && /→\s*404\b|not found/i.test(e.body || "")) throw e;
        lastErr = e;
      }
      if (attempt < MAX_RETRY) await sleep(900 * attempt);
    }
    throw lastErr;
  };

  // Serialisasi: request berikutnya menunggu yang sebelumnya selesai.
  const hasil = queue.then(run, run);
  queue = hasil.catch(() => {});
  return hasil;
}

/** Ambil pesan error dari body JSON `{"error":"..."}` kalau ada. */
function pesanUpstream(text) {
  try {
    const j = JSON.parse(text);
    if (j && typeof j.error === "string") return j.error;
  } catch {
    /* body bukan JSON */
  }
  return (text || "").slice(0, 160).trim() || null;
}

/**
 * GET satu route API. Parameter bernilai undefined/null/"" dibuang supaya
 * tidak mengirim `?type=` kosong yang bisa diartikan lain oleh upstream.
 */
export async function apiGet(path, params = {}) {
  const u = new URL(path.startsWith("http") ? path : `${API}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  const { text, url } = await rawGet(u.toString());
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(url, `Respons bukan JSON (${text.slice(0, 80)})`);
  }
  if (data && typeof data === "object" && typeof data.error === "string") {
    throw new ApiError(url, data.error);
  }
  return { url, data };
}

export function clearCache() {
  cache.clear();
}

export { BASE, API, UA, SPACING_MS };
