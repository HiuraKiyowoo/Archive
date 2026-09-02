// pcverge-scraper: transport HTTP zero-dependency (GET + POST form).
//
// Temuan recon (2026-09-01, semua lewat request nyata):
// - pcverge.com = WordPress + tema **muvipro** (kelas CSS `gmr-*`), plugin
//   `idmuvi-core`, di belakang Cloudflare + LiteSpeed cache. UA browser wajar
//   LOLOS tanpa challenge.
// - REST API WordPress **terbuka penuh tanpa auth**: `/wp-json/wp/v2/`.
// - `robots.txt`: `Disallow: /wp-admin/` TAPI **`Allow: /wp-admin/admin-ajax.php`**
//   secara eksplisit. Dua jalur yang dipakai scraper ini (`/wp-json/` yang tidak
//   dilarang, dan `admin-ajax.php` yang diizinkan) sah menurut robots.
// - `<meta name="generator" content="WordPress 7.1">` — versi itu TIDAK ADA;
//   kemungkinan dipalsukan plugin SEO. Jangan dipakai untuk deteksi fitur.
//
// Transport sopan: serial 1 koneksi, jeda 900 ms, nol paralelisme. Dengan
// `per_page=100` seluruh katalog 25.022 item cuma ~250 request.

const BASE = "https://pcverge.com";
const REST = `${BASE}/wp-json/wp/v2`;
const AJAX = `${BASE}/wp-admin/admin-ajax.php`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SPACING_MS = 900;
const MAX_RETRY = 3;
const TIMEOUT_MS = 45000;

const cache = new Map();
let lastHit = 0;
let queue = Promise.resolve();

/** Error HTTP non-2xx. `body` = potongan/pesan dari upstream. */
export class HttpError extends Error {
  constructor(status, url, message, body) {
    super(message || `HTTP ${status} untuk ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body ?? null;
  }
}

/** Error isi respons (bukan JSON, atau WP mengembalikan objek error). */
export class ApiError extends Error {
  constructor(url, message, code) {
    super(message);
    this.name = "ApiError";
    this.url = url;
    this.code = code ?? null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function spacing() {
  const gap = Date.now() - lastHit;
  if (gap < SPACING_MS) await sleep(SPACING_MS - gap);
  lastHit = Date.now();
}

/**
 * Request mentah, diantrikan serial + retry. Mengembalikan `{text, url, total,
 * totalHalaman}` — header dibutuhkan karena WP menaruh jumlah total di
 * `X-WP-Total` / `X-WP-TotalPages`, bukan di body.
 *
 * 4xx dianggap permanen (tidak diulang): WP membalas
 * **400 `rest_post_invalid_page_number`** kalau `page` melewati halaman
 * terakhir, dan itu batas normal — bukan gangguan yang perlu diretry.
 *
 * POST tidak di-cache dan tidak memakai kunci cache GET.
 */
function kirim(url, { metode = "GET", body = null, headers = {} } = {}) {
  const kunci = metode === "GET" ? url : null;
  const run = async () => {
    if (kunci && cache.has(kunci)) return cache.get(kunci);

    let lastErr;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
      await spacing();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: metode,
          headers: {
            "user-agent": UA,
            accept: "application/json, text/html;q=0.9, */*;q=0.8",
            "accept-language": "id-ID,id;q=0.9,en;q=0.8",
            referer: `${BASE}/`,
            ...headers,
          },
          body,
          redirect: "follow",
          signal: ac.signal,
        });
        clearTimeout(timer);
        const text = await res.text();

        if (!res.ok) {
          const err = new HttpError(res.status, url, undefined, ringkas(text));
          if (res.status < 500) throw err;
          lastErr = err;
        } else {
          const out = {
            text,
            url: res.url,
            total: intOrNull(res.headers.get("x-wp-total")),
            totalHalaman: intOrNull(res.headers.get("x-wp-totalpages")),
          };
          if (kunci) cache.set(kunci, out);
          return out;
        }
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof HttpError && e.status < 500) throw e;
        lastErr = e;
      }
      if (attempt < MAX_RETRY) await sleep(800 * attempt);
    }
    throw lastErr;
  };

  const hasil = queue.then(run, run);
  queue = hasil.catch(() => {});
  return hasil;
}

function intOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ringkas(text) {
  try {
    const j = JSON.parse(text);
    if (j && j.message) return `${j.code ?? "error"}: ${j.message}`;
  } catch {
    /* body bukan JSON */
  }
  return (text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 140).trim() || null;
}

/**
 * GET satu endpoint REST. Param bernilai undefined/null/"" dibuang.
 * Array digabung dengan koma (WP menerima `categories=1,2`).
 */
export async function restGet(path, params = {}) {
  const u = new URL(path.startsWith("http") ? path : `${REST}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const res = await kirim(u.toString());
  let data;
  try {
    data = JSON.parse(res.text);
  } catch {
    throw new ApiError(res.url, `Respons bukan JSON (${res.text.slice(0, 80)})`);
  }
  if (data && !Array.isArray(data) && typeof data.code === "string" && data.message) {
    throw new ApiError(res.url, data.message, data.code);
  }
  return { data, url: res.url, total: res.total, totalHalaman: res.totalHalaman };
}

/** GET halaman HTML (untuk rating, durasi, kualitas, tautan download). */
export async function htmlGet(url) {
  const abs = url.startsWith("http") ? url : `${BASE}/${url.replace(/^\/+/, "")}`;
  const res = await kirim(abs, { headers: { accept: "text/html,application/xhtml+xml" } });
  return { html: res.text, url: res.url };
}

/**
 * POST `admin-ajax.php` dengan body form. Terukur: endpoint player
 * **tidak butuh nonce maupun referer** — tanpa header apa pun tetap 200.
 * Referer tetap dikirim karena itu perilaku klien yang wajar.
 */
export async function ajaxPost(fields) {
  const body = new URLSearchParams(fields).toString();
  const res = await kirim(AJAX, {
    metode: "POST",
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      accept: "*/*",
    },
  });
  return { html: res.text, url: res.url };
}

export function clearCache() {
  cache.clear();
}

export { BASE, REST, AJAX, UA, SPACING_MS };
