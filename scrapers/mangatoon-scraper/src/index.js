// mangatoon-scraper — zero-dep scraper untuk mangatoon.mobi
//
// Situs: PHP 7.3, HTML server-side render, TANPA Cloudflare challenge.
// Tidak ada API JSON publik (robots.txt melarang /api) -> parser HTML.
//
// Jebakan yang sudah diverifikasi live (jangan dihapus tanpa tes ulang):
//  1. Halaman detail me-render daftar episode DUA KALI (blok asc + blok desc).
//     Ambil blok pertama saja, lalu dedup by data-id. Kalau tidak: 700 episode
//     padahal aslinya 350.
//  2. Gambar reader: `let pictures = [...]` di HTML berisi URL /encrypted/*.webp
//     yang isinya byte TERENKRIPSI (bukan WebP valid). Yang bisa dipakai adalah
//     varian /watermark/*.jpg. JSON itu tetap dipakai sebagai sumber JUMLAH
//     halaman karena tag <img> di HTML kadang cuma sebagian (lazy render).
//  3. /watch/{content_id}/{episode_id}: content_id cuma dekorasi. Episode id
//     yang menentukan. content_id yang tidak ada -> 404.
//  4. Episode id palsu -> HTTP 200 tapi `pictures` kosong + title "{1} - {0}".
//  5. search: TIDAK ada pagination (?page=N mengembalikan hasil identik) dan
//     query tanpa hasil -> HTTP 404 + <div class="no-result">.
//  6. Listing: ?page=0 -> 301, page melewati batas -> 404, halaman terakhir
//     tidak punya tombol Next. Situs tidak pernah memberi total halaman.

const BASE = "https://mangatoon.mobi";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Bahasa yang dilayani domain mangatoon.mobi. */
export const LANGS = ["en", "id", "es", "pt", "th"];

const DEFAULT_LANG = "en";
const THROTTLE_MS = 500;
let lastHit = 0;

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} untuk ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}
export { HttpError };

function checkLang(lang) {
  if (!LANGS.includes(lang)) {
    throw new Error(`lang tidak didukung: ${lang} (pilih: ${LANGS.join(", ")})`);
  }
  return lang;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
  const gap = Date.now() - lastHit;
  if (gap < THROTTLE_MS) await sleep(THROTTLE_MS - gap);
  lastHit = Date.now();
}

/** GET via fetch, fallback ke curl. Melempar HttpError untuk status != 2xx. */
export async function httpGet(url, { retries = 3, binary = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": UA,
          accept: binary
            ? "image/avif,image/webp,image/jpeg,*/*"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          referer: BASE + "/",
        },
        redirect: "follow",
      });
      if (!res.ok) {
        // 4xx tidak akan berubah kalau diulang.
        if (res.status >= 400 && res.status < 500) throw new HttpError(res.status, url);
        throw new HttpError(res.status, url);
      }
      return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (err) {
      lastErr = err;
      if (err instanceof HttpError && err.status >= 400 && err.status < 500) throw err;
      if (attempt < retries) await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------- util parsing

const NAMED_ENT = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", rsquo: "\u2019", lsquo: "\u2018",
  rdquo: "\u201d", ldquo: "\u201c", hellip: "…", middot: "·",
  laquo: "«", raquo: "»", deg: "°", trade: "™", copy: "©", reg: "®",
};

/** Decode entity HTML: bernama + numerik desimal/hex (mis. `&#038;` -> `&`). */
export function decodeEnt(s) {
  if (!s) return "";
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENT[n.toLowerCase()] ?? m);
}

export function stripTags(html) {
  return decodeEnt(
    String(html ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Angka ringkas ala MangaToon -> integer. "253.6M" -> 253600000, "37.6k" -> 37600.
 * Mengembalikan 0 kalau tidak bisa diparse (situs tidak pernah memberi field ini
 * kosong pada halaman yang valid; 0 dipakai agar tidak ada null di output).
 */
export function parseCount(s) {
  const t = String(s ?? "").trim().replace(/,/g, "");
  const m = t.match(/^([\d.]+)\s*([kKmMbB]?)$/);
  if (!m) return 0;
  const mult = { "": 1, k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()];
  return Math.round(parseFloat(m[1]) * mult);
}

function pick(re, html, fallback = "") {
  const m = html.match(re);
  return m ? stripTags(m[1]) : fallback;
}

function pathOf(url) {
  return url.startsWith("http") ? url.replace(/^https?:\/\/[^/]+/, "") : url;
}

function abs(url) {
  if (!url) return "";
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("http")) return url;
  return BASE + (url.startsWith("/") ? "" : "/") + url;
}

/** content_id dari URL series. */
function cidOf(url) {
  const m = String(url).match(/content_id=(\d+)/);
  return m ? Number(m[1]) : 0;
}

function slugOf(url) {
  const m = pathOf(String(url)).match(/^\/[a-z]{2}\/([^/?#]+)/);
  return m ? m[1] : "";
}

/**
 * PENTING: param `page` di situs ini 0-BASED.
 *   URL dasar (tanpa query) = halaman 1
 *   ?page=1                 = halaman 2
 *   ?page=25                = halaman 26
 * `?page=0` dijawab 301 ke URL dasar. API di modul ini memakai `page` 1-based
 * yang manusiawi, lalu dikonversi di sini. Kalau konversi ini dihapus, page=2
 * akan diam-diam melewati satu halaman dan walk() bisa mengulang halaman sama.
 */
function listUrl(base, page) {
  return page <= 1 ? base : `${base}?page=${page - 1}`;
}

/** Ada tombol "Next Page"? Situs tidak memberi total halaman. */
function hasNext(html) {
  return /<span class="next">/.test(html);
}

/** Nomor halaman berikutnya dalam penomoran 1-based modul ini. */
function nextPageNumber(html) {
  const m = html.match(/href="[^"]*[?&]page=(\d+)"[^>]*>\s*<span class="next">/);
  return m ? Number(m[1]) + 1 : 0;
}

// ------------------------------------------------------- parser kartu listing

/**
 * Kartu series pada halaman genre/tag: <a href=..content_id=N><div class="item">
 * Field yang tersedia: cover, judul, likes, tags, jumlah episode, views.
 */
function parseItemCards(html) {
  const out = [];
  // Penutup kartu adalah `</a>` saja — JANGAN tambah `</div>` sesudahnya, karena
  // hanya kartu TERAKHIR yang diikuti `</div>` (sisanya langsung `<a>` berikutnya).
  // Regex lama `...</a>\s*</div>` cuma cocok 1 kartu dari 18.
  const re = /<a href="([^"]*content_id=\d+)"[^>]*>\s*<div class="item">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const url = abs(m[1]);
    const body = m[2];
    const cover = (body.match(/data-src="([^"]+)"/) || ["", ""])[1];
    out.push({
      content_id: cidOf(url),
      slug: slugOf(url),
      title: pick(/class="content-title"><span>([\s\S]*?)<\/span>/, body),
      url,
      cover: abs(cover),
      likes: parseCount(pick(/class="list-icon">[\s\S]*?<span>([^<]*)<\/span>/, body)),
      likes_raw: pick(/class="list-icon">[\s\S]*?<span>([^<]*)<\/span>/, body),
      tags: pick(/class="tags"><span>([\s\S]*?)<\/span>/, body)
        .split("/")
        .map((t) => t.trim())
        .filter(Boolean),
      episode_count: Number(
        (pick(/class="open-episode-count">([^<]*)</, body).match(/(\d+)/) || [0, 0])[1]
      ),
      views: parseCount(
        pick(/class="watch-count">[\s\S]*?<\/span>\s*([^<]*)</, body)
      ),
      views_raw: pick(/class="watch-count">[\s\S]*?<\/span>\s*([^<]*)</, body),
    });
  }
  return out;
}

/**
 * Kartu pada hasil search: div.recommend-item.
 *
 * PENTING: hasil pencarian MangaToon dicampur dengan judul dari situs saudara
 * NovelToon (novel teks). Contoh nyata: search "bossy" = 18 hasil, hanya 6 yang
 * komik MangaToon (`?content_id=N`), 12 sisanya menunjuk
 * `noveltoon.mobi/en/detail/<id>/comments`. Keduanya tetap dikembalikan dengan
 * penanda `kind` supaya tidak ada hasil yang hilang diam-diam:
 *   kind "comic" -> content_id > 0, bisa dipakai series()/episodeImages()
 *   kind "novel" -> content_id 0, novel_id > 0, hanya bisa dibuka di NovelToon
 */
function parseRecommendCards(html) {
  const out = [];
  const re = /<div class="recommend-item">([\s\S]*?)<div class="comics-type">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const body = m[1];
    const href = (body.match(/href="([^"]+)"/) || ["", ""])[1];
    const title = pick(/class="recommend-comics-title">\s*<span>([\s\S]*?)<\/span>/, body);
    if (!href || !title) continue;
    const cid = cidOf(href);
    const novel = href.match(/noveltoon\.mobi\/[a-z]{2}\/detail\/(\d+)/);
    out.push({
      kind: cid ? "comic" : novel ? "novel" : "other",
      content_id: cid,
      novel_id: novel ? Number(novel[1]) : 0,
      slug: cid ? slugOf(href) : "",
      title,
      url: abs(href),
      cover: abs((body.match(/data-src="([^"]+)"/) || ["", ""])[1]),
      type: stripTags(m[2])
        .split("/")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }
  return out;
}

/** Link series generik (banner, section homepage) */
function parseAnchorCards(html) {
  const out = [];
  // `<a` dan `href` BISA dipisah newline di homepage (blok "Hottest Comics"),
  // jadi wajib `\s+` bukan spasi tunggal. Pola lama melewatkan 2 kartu.
  const re = /<a\s+href="([^"]*content_id=\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const url = abs(m[1]);
    const body = m[2];
    const cover = (body.match(/data-src="([^"]+)"/) || ["", ""])[1];
    const alt = (body.match(/alt="([^"]*)"/) || ["", ""])[1];
    out.push({
      content_id: cidOf(url),
      slug: slugOf(url),
      title: stripTags(alt) || "",
      url,
      cover: abs(cover),
    });
  }
  return out;
}

/**
 * Judul kartu homepage tersimpan di elemen terpisah, bukan di dalam anchor.
 * Ada 2 varian yang dipakai situs:
 *   - `div.content-title > span`            (kartu grid biasa)
 *   - `div.top-content-info-title > span`   (kartu besar "Hottest Comics")
 * Beberapa kartu (blok Genres) hanya punya `alt` di <img>, sudah ditangani
 * parseAnchorCards. Fungsi ini mengisi judul yang masih kosong secara berurutan.
 */
function attachTitles(cards, html) {
  const titles = [
    ...html.matchAll(
      /class="(?:content-title|top-content-info-title)"><span>([\s\S]*?)<\/span>/g
    ),
  ].map((m) => stripTags(m[1]));
  let i = 0;
  for (const c of cards) {
    if (!c.title && i < titles.length) c.title = titles[i];
    i++;
  }
  // Jika jumlah judul dan kartu tidak sejajar, isi sisa yang masih kosong
  // dengan judul pertama yang belum terpakai (menghindari field kosong).
  const unused = titles.filter((t) => !cards.some((c) => c.title === t));
  for (const c of cards) {
    if (!c.title && unused.length) c.title = unused.shift();
  }
  return cards;
}

// --------------------------------------------------------------- endpoint API

/**
 * Homepage: banner + semua section bertajuk (h2.item-title).
 * -> { lang, url, banner: [card], sections: [{ title, count, items: [card] }], count }
 */
export async function home({ lang = DEFAULT_LANG } = {}) {
  checkLang(lang);
  const url = lang === "en" ? `${BASE}/` : `${BASE}/${lang}`;
  const html = await httpGet(url);

  const bannerHtml = (html.match(/<div class="banner-images">([\s\S]*?)<div class="list">/) ||
    ["", ""])[1];
  const banner = parseAnchorCards(bannerHtml);

  const sections = [];
  // Section pembungkus bisa `list-item` ATAU `list-item update-list`
  // (section "Manga Update Today"). Split pakai regex, bukan string literal.
  const blocks = html.split(/<div class="list-item[^"]*">/).slice(1);
  for (const b of blocks) {
    const title = pick(/class="item-title">([\s\S]*?)<\/h2>/, b);
    const items = attachTitles(parseAnchorCards(b), b);
    if (items.length) sections.push({ title, count: items.length, items });
  }
  return {
    lang,
    url,
    banner,
    banner_count: banner.length,
    sections,
    section_count: sections.length,
    count: sections.reduce((n, s) => n + s.count, 0),
  };
}

/**
 * Daftar genre + opsi status dari widget filter halaman genre.
 * -> { lang, genres: [{ id, name, url }], status: [{ id, name, url }] }
 */
export async function genres({ lang = DEFAULT_LANG } = {}) {
  checkLang(lang);
  const html = await httpGet(`${BASE}/${lang}/genre/comic`);
  const start = html.indexOf('<div class="genre-top">', html.indexOf("</style>"));
  const seg = html.slice(start, html.indexOf("genre-page-heading", start));
  const groups = seg.split('<div class="channel-item">').slice(1);

  const parseGroup = (g) =>
    [...g.matchAll(
      /href="([^"]+)"\s+class="channel-a">\s*<div class="channel([^"]*)">\s*<span>([\s\S]*?)<\/span>/g
    )].map((m) => {
      const href = m[1];
      const catMatch = href.match(/\/genre\/category\/(\d+)\/(\d+)/);
      return {
        id: catMatch ? Number(catMatch[1]) : 0,
        status_id: catMatch ? Number(catMatch[2]) : 0,
        name: stripTags(m[3]),
        url: abs(href),
        active: m[2].includes("activity"),
      };
    });

  const g0 = groups[0] ? parseGroup(groups[0]) : [];
  const g1 = groups[1] ? parseGroup(groups[1]) : [];
  return {
    lang,
    genres: g0.map(({ id, name, url }) => ({ id, name, url })),
    genre_count: g0.length,
    status: g1.map((s, i) => ({ id: s.status_id || i, name: s.name, url: s.url })),
    status_count: g1.length,
  };
}

/**
 * Listing series dengan filter genre + status.
 *  genre  : 0 = semua, atau id dari genres().genres
 *  status : 0 = terpopuler, 1 = baru update, 2 = completed
 * Situs TIDAK memberi total halaman -> pakai has_next / next_page.
 * page melewati batas -> HttpError 404 (bukan array kosong).
 */
export async function browse({ lang = DEFAULT_LANG, genre = 0, status = 0, page = 1 } = {}) {
  checkLang(lang);
  if (page < 1) throw new Error("page minimal 1 (page=0 dijawab 301 oleh situs)");
  const base =
    genre === 0 && status === 0
      ? `${BASE}/${lang}/genre/comic`
      : `${BASE}/${lang}/genre/category/${genre}/${status}`;
  const url = listUrl(base, page);
  const html = await httpGet(url);
  const items = parseItemCards(html);
  return {
    lang,
    genre,
    status,
    page,
    url,
    items,
    count: items.length,
    has_next: hasNext(html),
    next_page: nextPageNumber(html),
  };
}

/** Shortcut /genre/hot — terpopuler. */
export async function hot({ lang = DEFAULT_LANG, page = 1 } = {}) {
  checkLang(lang);
  const url = listUrl(`${BASE}/${lang}/genre/hot`, page);
  const html = await httpGet(url);
  const items = parseItemCards(html);
  return { lang, page, url, items, count: items.length, has_next: hasNext(html), next_page: nextPageNumber(html) };
}

/** Shortcut /genre/new — baru update. */
export async function updated({ lang = DEFAULT_LANG, page = 1 } = {}) {
  checkLang(lang);
  const url = listUrl(`${BASE}/${lang}/genre/new`, page);
  const html = await httpGet(url);
  const items = parseItemCards(html);
  return { lang, page, url, items, count: items.length, has_next: hasNext(html), next_page: nextPageNumber(html) };
}

/**
 * Listing per tag. Tag id didapat dari series().tags[].id — himpunan tag jauh
 * lebih besar dari genres() (yang cuma 25 genre unggulan).
 * tag id tidak valid -> HttpError 404.
 */
export async function byTag({ lang = DEFAULT_LANG, tag, page = 1 } = {}) {
  checkLang(lang);
  if (!tag) throw new Error("butuh tag id (lihat series().tags[].id)");
  const base = `${BASE}/${lang}/genre/tags/${tag}`;
  const url = listUrl(base, page);
  const html = await httpGet(url);
  const items = parseItemCards(html);
  return {
    lang, tag, page, url, items,
    count: items.length,
    has_next: hasNext(html),
    next_page: nextPageNumber(html),
  };
}

/**
 * Pencarian judul. CATATAN: tidak ada pagination — `?page=N` diabaikan situs
 * dan mengembalikan hasil yang sama. Query tanpa hasil -> HTTP 404 dari situs,
 * di sini dinormalisasi jadi { count: 0, found: false }.
 */
export async function search({ word, lang = DEFAULT_LANG } = {}) {
  checkLang(lang);
  if (!word || !String(word).trim()) throw new Error("butuh kata kunci (word)");
  const url = `${BASE}/${lang}/search?word=${encodeURIComponent(word)}`;
  let html;
  try {
    html = await httpGet(url);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      return {
        lang, word, url,
        items: [], count: 0, comic_count: 0, novel_count: 0, found: false,
      };
    }
    throw err;
  }
  const items = parseRecommendCards(html);
  return {
    lang,
    word,
    url,
    items,
    count: items.length,
    comic_count: items.filter((x) => x.kind === "comic").length,
    novel_count: items.filter((x) => x.kind === "novel").length,
    found: items.length > 0,
  };
}

/**
 * Detail series + SELURUH daftar episode.
 * Terima content_id (angka). `slug` opsional dan tidak harus benar — situs
 * me-redirect 302 ke slug kanonik berdasarkan content_id.
 */
export async function series({ id, slug = "detail", lang = DEFAULT_LANG } = {}) {
  checkLang(lang);
  if (!id) throw new Error("butuh content_id (angka)");
  const url = `${BASE}/${lang}/${slug}?content_id=${id}`;
  const html = await httpGet(url);

  // Daftar episode di-render 2x (asc lalu desc). Ambil blok pertama saja.
  const marks = [...html.matchAll(/class="episode-content/g)].map((m) => m.index);
  const epSeg = marks.length ? html.slice(marks[0], marks[1] ?? html.length) : "";

  const episodes = [];
  const seen = new Set();
  const epRe =
    /<a class="episode-item-new"[^>]*data-id="(\d+)"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = epRe.exec(epSeg))) {
    const epId = Number(m[1]);
    if (seen.has(epId)) continue;
    seen.add(epId);
    const body = m[3];
    const stats = body.match(
      /episode-like-view">\s*<span[^>]*>[^<]*<\/span>&nbsp;([\d.]+[kKmM]?)\s*<span[^>]*>[^<]*<\/span>&nbsp;([\d.]+[kKmM]?)/
    );
    episodes.push({
      episode_id: epId,
      number: Number(pick(/class="episode-title-new episode-number">(\d+)</, body, "0")),
      title: pick(/class="episode-title-new">\s*([\s\S]*?)\s*<\/div>/, body),
      url: abs(m[2]),
      date: pick(/class="open-date">([^<]*)</, body),
      views: stats ? parseCount(stats[1]) : 0,
      views_raw: stats ? stats[1] : "",
      likes: stats ? parseCount(stats[2]) : 0,
      likes_raw: stats ? stats[2] : "",
    });
  }

  const tags = [...html.matchAll(/href="\/[a-z]{2}\/genre\/tags\/(\d+)">([\s\S]*?)<\/a>/g)].map(
    (t) => ({ id: Number(t[1]), name: stripTags(t[2]) })
  );

  const viewRaw = pick(/class="view-count">([^<]*)</, html);
  const likeRaw = pick(/class="like-count">([^<]*)</, html);
  const updateTo = pick(/class="detail-episodes-number">([^<]*)</, html);

  return {
    content_id: Number(id),
    lang,
    url,
    slug: slugOf(pick(/rel="canonical" href="([^"]+)"/, html) || url) || slugOf(url),
    title: pick(/<h1 class="detail-title[^"]*">([\s\S]*?)<\/h1>/, html) ||
      pick(/og:title" content="([^"]*)"/, html),
    status: pick(/class="detail-status">\s*([\s\S]*?)\s*<\/div>/, html),
    author: pick(/Author Name:\s*([\s\S]*?)\s*<\/span>/, html),
    score: Number(pick(/detail-score-points[^>]*>([^<]*)</, html, "0")) || 0,
    views: parseCount(viewRaw),
    views_raw: viewRaw,
    likes: parseCount(likeRaw),
    likes_raw: likeRaw,
    cover: pick(/og:image" content="([^"]+)"/, html),
    description: pick(
      /class="detail-description-short[^"]*">([\s\S]*?)<\/div>/,
      html
    ),
    tags,
    tag_count: tags.length,
    latest_episode: Number((updateTo.match(/(\d+)/) || [0, 0])[1]),
    latest_episode_raw: updateTo,
    episodes,
    episode_count: episodes.length,
  };
}

/**
 * Gambar satu episode.
 * Jumlah halaman diambil dari `let pictures` (JSON, selalu lengkap); URL yang
 * dipakai adalah turunan /watermark/*.jpg karena varian /encrypted/*.webp
 * berisi byte terenkripsi dan tidak bisa dibuka sebagai gambar.
 */
export async function episodeImages({ contentId, episodeId, lang = DEFAULT_LANG } = {}) {
  checkLang(lang);
  if (!contentId || !episodeId) throw new Error("butuh contentId dan episodeId");
  const url = `${BASE}/${lang}/watch/${contentId}/${episodeId}`;
  const html = await httpGet(url);

  const m = html.match(/let pictures\s*=\s*(\[[\s\S]*?\]);/);
  let raw = [];
  if (m) {
    try {
      raw = JSON.parse(m[1]);
    } catch {
      raw = [];
    }
  }
  if (!raw.length) {
    // episode id tidak ada: situs balas 200 dengan pictures kosong
    throw new HttpError(404, url);
  }

  const pages = raw.map((p, i) => ({
    index: i + 1,
    url: toWatermark(p.url, lang),
    encrypted_url: p.url,
    width: Number(p.width) || 0,
    height: Number(p.height) || 0,
    size: Number(p.size) || 0,
  }));

  return {
    content_id: Number(contentId),
    episode_id: Number(episodeId),
    lang,
    url,
    title: pick(/og:title" content="([^"]*)"/, html) || pick(/<title>([^<]*)<\/title>/, html),
    series_title: pick(/class="episode-title"[^>]*>([\s\S]*?)</, html) ||
      pick(/<title>[^-]*-\s*([^-]+?)\s*-\s*MangaToon<\/title>/, html),
    series_url: abs(pick(/href="(\/[a-z]{2}\/[^"]*content_id=\d+)"/, html)),
    // Di episode pertama situs mengisi tombol "Previous" dengan episode itu
    // sendiri (bukan disable). Dinormalisasi jadi 0 = tidak ada.
    prev_episode: normalizeNav(episodeIdOf(html, "prev"), episodeId),
    next_episode: normalizeNav(episodeIdOf(html, "next"), episodeId),
    pages,
    count: pages.length,
  };
}

/**
 * Episode tetangga. JANGAN pakai class `page-icons-prev`/`page-icons-next`:
 * situs salah menandai class-nya — pada beberapa episode KEDUA tombol memakai
 * `page-icons-next` sekaligus (terverifikasi di /en/watch/21/518). Label teks
 * "Previous Episode"/"Next Episode" adalah satu-satunya penanda yang benar.
 *
 * Catatan: episode_id TIDAK berurutan (Hunk No.1: ep1=517, ep2=518, ep3=516),
 * jadi id "next" yang lebih kecil dari id sekarang itu normal.
 */
function episodeIdOf(html, dir) {
  const label = dir === "prev" ? "Previous Episode" : "Next Episode";
  const re = new RegExp(
    `href="[^"]*/watch/\\d+/(\\d+)"[^>]*>\\s*<span class="page-text">\\s*${label}\\s*</span>`
  );
  const m = html.match(re);
  return m ? Number(m[1]) : 0;
}

/** 0 = tidak ada tetangga. Situs menunjuk ke diri sendiri di ujung daftar. */
function normalizeNav(id, current) {
  return id && id !== Number(current) ? id : 0;
}

/**
 * /encrypted/x.webp -> /watermark/x.jpg pada host CDN aliyun.
 * Host bervariasi (`en.c.pic.mangatoon.mobi` atau `en-c-pic-aliyun...`),
 * dinormalisasi ke `{lang}-c-pic-aliyun.mangatoon.mobi` (terverifikasi 200
 * image/jpeg untuk semua sampel).
 */
export function toWatermark(encryptedUrl, lang = DEFAULT_LANG) {
  let u = String(encryptedUrl).replace(/^http:\/\//, "https://");
  const m = u.match(/^https:\/\/([^/]+)(\/.*)$/);
  if (!m) return u;
  const prefix = m[1].split(".")[0].split("-")[0] || lang;
  const path = m[2].replace("/encrypted/", "/watermark/").replace(/\.webp$/, ".jpg");
  return `https://${prefix}-c-pic-aliyun.mangatoon.mobi${path}`;
}

/** Unduh gambar episode ke folder. */
export async function download({ contentId, episodeId, dir, lang = DEFAULT_LANG, limit = 0 } = {}) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  if (!dir) throw new Error("butuh folder tujuan (dir)");
  const ep = await episodeImages({ contentId, episodeId, lang });
  await mkdir(dir, { recursive: true });
  const list = limit > 0 ? ep.pages.slice(0, limit) : ep.pages;
  const saved = [];
  for (const p of list) {
    const buf = await httpGet(p.url, { binary: true });
    const name = `p${String(p.index).padStart(3, "0")}.jpg`;
    await writeFile(join(dir, name), buf);
    saved.push({ index: p.index, file: join(dir, name), bytes: buf.length, url: p.url });
  }
  return { content_id: ep.content_id, episode_id: ep.episode_id, dir, saved, count: saved.length };
}

/**
 * Judul yang direkomendasikan di dalam sebuah booklist.
 *
 * Booklist mencampur komik MangaToon dengan novel NovelToon (situs saudara).
 * Terverifikasi di /en/book/list: 15 link mangatoon.mobi vs 47 noveltoon.mobi.
 * Semuanya dikembalikan dengan penanda `kind` — jangan dibuang, karena booklist
 * memang keranjang campuran buatan pengguna.
 */
function parseRecommendedTitles(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/href="([^"]*content_id=(\d+))"/g)) {
    const href = m[1];
    const cid = Number(m[2]);
    const novel = /noveltoon\.mobi/.test(href);
    const key = `${novel ? "n" : "c"}${cid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: novel ? "novel" : "comic",
      content_id: novel ? 0 : cid,
      novel_id: novel ? cid : 0,
      slug: slugOf(href),
      url: href.startsWith("http") ? href : abs(href),
    });
  }
  return out;
}

/**
 * Avatar pengguna dari kartu booklist. Situs punya 2 varian markup:
 *   listing  -> <img class="... lazyload" data-src="URL" src="PLACEHOLDER">
 *   detail   -> <img class="book-list-item-author-img" src="URL">
 * Placeholder `header-default.png` / `content_cover_default.webp` dibuang.
 * URL avatar bertanda tangan waktu (`?sign=...&t=...`) — berubah tiap request,
 * jadi jangan dipakai sebagai identitas/cache key.
 */
function pickAvatar(html) {
  const tag = (html.match(/<img[^>]*book-list-item-author-img[^>]*>/) || [""])[0];
  if (!tag) return "";
  const cands = [
    (tag.match(/data-src="([^"]*)"/) || ["", ""])[1],
    (tag.match(/\ssrc="([^"]*)"/) || ["", ""])[1],
  ];
  for (const c of cands) {
    if (c && !/default\.(png|webp|jpg)/i.test(c)) return c;
  }
  return "";
}

/** Isi satu kartu booklist -> objek. Dipakai booklist() dan booklistDetail(). */
function parseBooklistCard(b) {
  const titles = [...b.matchAll(/class="book-list-item-title"[^>]*>([\s\S]*?)<\/p>/g)].map((t) =>
    stripTags(t[1])
  );
  const rec = parseRecommendedTitles(b);
  return {
    // Nama pengguna BISA kosong di sisi situs (akun terhapus/anonim): situs
    // merender <p class="book-list-item-title"></p> kosong. Terverifikasi pada
    // booklist 3097 & 3098. Dikembalikan sebagai string kosong, bukan null.
    user: titles[0] || "",
    // Avatar: halaman listing memakai lazyload (`data-src`), halaman
    // booklist-detail memakai `src` langsung. Terima keduanya, dan jangan
    // ambil placeholder default (`header-default.png`).
    user_avatar: pickAvatar(b),
    date: pick(/class="book-list-item-create-time">([^<]*)</, b),
    title: titles[1] || "",
    // Situs kadang memakai <p>, kadang <div> untuk deskripsi yang sama.
    description: pick(/class="book-list-item-des">([\s\S]*?)<\/(?:p|div)>/, b),
    series: rec,
    series_count: rec.length,
    comic_count: rec.filter((x) => x.kind === "comic").length,
    novel_count: rec.filter((x) => x.kind === "novel").length,
  };
}

/**
 * Booklist buatan pengguna (/book/list). Punya pagination ?page=N (0-based di situs).
 *
 * Kartu dipotong berdasarkan batas anchor `booklist-detail/<id>` berikutnya,
 * BUKAN `</a></div>`: kartu tanpa blok rekomendasi punya jumlah penutup tag
 * berbeda, dan pola lama membuat 2 dari 40 kartu hilang (id 3100 & 3086).
 */
export async function booklist({ lang = DEFAULT_LANG, page = 1 } = {}) {
  checkLang(lang);
  const base = `${BASE}/${lang}/book/list`;
  const url = listUrl(base, page);
  const html = await httpGet(url);
  const body = html.slice(html.indexOf("</style>"));

  const anchors = [...body.matchAll(/<a href="(\/[a-z]{2}\/booklist-detail\/(\d+))">/g)];
  const items = anchors.map((a, i) => {
    const start = a.index + a[0].length;
    const end = i + 1 < anchors.length ? anchors[i + 1].index : body.length;
    return {
      booklist_id: Number(a[2]),
      url: abs(a[1]),
      ...parseBooklistCard(body.slice(start, end)),
    };
  });

  return {
    lang, page, url, items,
    count: items.length,
    has_next: hasNext(html),
    next_page: nextPageNumber(html),
  };
}

/** Detail satu booklist. */
export async function booklistDetail({ id, lang = DEFAULT_LANG } = {}) {
  checkLang(lang);
  if (!id) throw new Error("butuh booklist id");
  const url = `${BASE}/${lang}/booklist-detail/${id}`;
  const html = await httpGet(url);
  const body = html.slice(html.indexOf("</style>"));
  return {
    booklist_id: Number(id),
    lang,
    url,
    // <title> halaman = judul booklist; lebih andal dari kartu di body.
    page_title: pick(/<title>([\s\S]*?)\s*-\s*MANGATOON<\/title>/, html),
    ...parseBooklistCard(body),
  };
}

/**
 * Sitemap per bahasa: SELURUH katalog bahasa itu dalam 1 request, plus
 * lastmod + cover. Jalur paling murah untuk full sync.
 * Beberapa entry memang tidak punya <lastmod> atau <image:loc> di sisi situs —
 * field-nya diisi string kosong, bukan null.
 */
export async function sitemap({ lang = DEFAULT_LANG } = {}) {
  checkLang(lang);
  const url = `${BASE}/sitemap/detail_${lang}.xml`;
  const xml = await httpGet(url);
  const items = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const e = m[1];
    const loc = pick(/<loc>([^<]+)<\/loc>/, e);
    if (!loc) continue;
    items.push({
      content_id: cidOf(loc),
      slug: slugOf(loc),
      url: loc,
      lastmod: pick(/<lastmod>([^<]+)<\/lastmod>/, e),
      cover: pick(/<image:loc>([^<]+)<\/image:loc>/, e),
    });
  }
  return { lang, url, items, count: items.length };
}

/** Daftar semua sitemap yang diumumkan situs. */
export async function sitemapIndex() {
  const xml = await httpGet(`${BASE}/sitemap_index.xml`);
  const items = [...xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/g)].map((m) => ({
    url: pick(/<loc>([^<]+)<\/loc>/, m[1]),
    lastmod: pick(/<lastmod>([^<]+)<\/lastmod>/, m[1]),
  }));
  return { url: `${BASE}/sitemap_index.xml`, items, count: items.length };
}

/**
 * Walk listing sampai habis (has_next=false atau 404). Dipakai karena situs
 * tidak pernah memberi total halaman.
 *
 * Dedup memakai `content_id` kalau ada, kalau tidak `booklist_id` (untuk
 * booklist()). Tanpa ini, walk(booklist) akan menciut jadi 1 item karena
 * kartu booklist tidak punya content_id.
 */
export async function walk(fn, args = {}, { maxPages = 200 } = {}) {
  const all = [];
  const seen = new Set();
  let page = 1;
  let pages = 0;
  let stopped_at = "";
  while (page && pages < maxPages) {
    let res;
    try {
      res = await fn({ ...args, page });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        stopped_at = `404 di halaman ${page}`;
        break;
      }
      throw err;
    }
    pages++;
    for (const it of res.items) {
      const key = it.content_id || it.booklist_id || it.url;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(it);
    }
    if (!res.has_next) {
      stopped_at = `halaman terakhir (${page})`;
      break;
    }
    page = res.next_page || page + 1;
    if (pages >= maxPages) stopped_at = `batas maxPages (${maxPages})`;
  }
  return { items: all, count: all.length, pages, stopped_at };
}
