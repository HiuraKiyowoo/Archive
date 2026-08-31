// kanzenin.info scraper — zero-dep, Node >= 18
//
// Stack site (audit 2026-08-31):
//   - WordPress 7.1 + theme "mangareader" (Madara clone) — server-rendered HTML
//   - Cloudflare LENIENT: 200 langsung tanpa challenge, bahkan tanpa UA
//     (tetap set UA browser untuk jaga-jaga)
//   - Search: /?s=<q>&paged=<n> (10/page)
//   - AZ list: /a-z-list/?show=<A..Z|0-9|.\> + /a-z-list/page/<n>/
//   - Genre: /genres/<slug>/page/<n>/ (romance = 127 halaman)
//   - Series: /manga/<slug>/ — chapter list LANGSUNG di HTML
//     (li[data-num] — TIDAK perlu admin-ajax), TAPI bisa ada duplikat
//     (dedup by chapter number diperlukan)
//   - Reader: /<slug>-chapter-<n>/ — gambar di #readerarea, CDN = cdnasu.xyz
//     (filter wajib: banyak img lain = ads/cover)

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://kanzenin.info";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Di area reader, img yang VALID = dari domain DI LUAR site (CDN reader:
// cdnasu.xyz, cdn.uqni.net, dst). Ads/cover/sidebar selalu di domain site.
const SITE_HOST = "kanzenin.info";
const IMG_EXT = /\.(jpe?g|png|webp|avif|gif)$/i;

let lastFetchMs = 0;
async function throttle(ms = 600) {
  const wait = lastFetchMs + ms - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchMs = Date.now();
}

function curlGet(url, { data, referer, timeout = 30 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-sS", "-m", String(timeout), "-A", UA, "--compressed", "-D", "-"];
    if (data) args.push("--data", data);
    if (referer) args.push("-H", `Referer: ${referer}`);
    args.push(url);
    const c = spawn("curl", args);
    let raw = "", err = "";
    c.stdout.on("data", (d) => (raw += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("error", reject);
    c.on("close", (code) => {
      if (code !== 0) return reject(new Error(`curl exit ${code}: ${err.trim()}`));
      const sep = raw.indexOf("\r\n\r\n");
      const head = sep >= 0 ? raw.slice(0, sep) : "";
      const body = sep >= 0 ? raw.slice(sep + 4) : raw;
      const status = Number((head.match(/^HTTP\/\S+\s+(\d+)/m) || [])[1] || 0);
      const headers = {};
      for (const l of head.split("\r\n")) {
        const i = l.indexOf(":");
        if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
      }
      resolve({ status, headers, body });
    });
  });
}

async function httpGet(url, { retries = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    await throttle();
    let status = 0, headers = {}, body = "";
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
        },
        redirect: "follow",
      });
      status = r.status;
      headers = Object.fromEntries(r.headers.entries());
      body = await r.text();
    } catch (e) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      try {
        const res = await curlGet(url);
        status = res.status; headers = res.headers; body = res.body;
      } catch (e2) {
        throw new Error(`GET gagal (fetch: ${e.message} | curl: ${e2.message})`);
      }
    }
    if (status === 200 || status === 301) return { status, headers, body };
    if (status === 404) { const e = new Error("404 Not Found"); e.status = 404; throw e; }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    throw new Error(`HTTP ${status} untuk ${url}`);
  }
}

// ---------- helpers HTML ----------

const stripTags = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const NAMED_ENT = {
  ndash: "–", mdash: "—", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"',
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
  raquo: "»", laquo: "«", hellip: "…", middot: "·", deg: "°", trade: "™",
};
// decode SEMUA entity numerik (&#038; &#8217; &#x27;) + named yang umum.
// Site pakai &#038; di judul (contoh "Cookies &#038; Cream") — wajib di-decode.
const decodeEnt = (s) =>
  (s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENT[n.toLowerCase()] ?? m);

// "<title>Nama – kanzenin</title>" -> "Nama"
function pageTitle(html) {
  const t = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  if (!t) return null;
  return decodeEnt(t).replace(/\s*–\s*kanzenin\s*$/i, "").trim() || null;
}

function allBsxItems(html) {
  const out = [];
  const re = /<div class="bsx">([\s\S]*?)<\/a>\s*<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const blk = m[1];
    const hrefM = blk.match(/href="([^"]+)"\s+title="([^"]*)"/);
    const url = hrefM ? hrefM[1] : null;
    const img = (blk.match(/<img[^>]+src="([^"]+)"/) || [])[1] || null;
    const status = (blk.match(/class="status\s+[^"]*">([^<]+)</) || [])[1] || null;
    const eps = (blk.match(/class="epxs">([^<]+)/) || [])[1] || null;
    const rating = (blk.match(/class="numscore">([^<]+)/) || [])[1] || null;
    const date = (blk.match(/class="epxdate">([^<]+)/) || [])[1] || null;
    const type = (blk.match(/class="type\s+([A-Za-z]+)"/) || [])[1] || null;
    // div.tt = nama series (di kartu chapter, attr title = "Series Chapter N")
    const tt = (blk.match(/class="tt">\s*([\s\S]*?)\s*<\/div>/) || [])[1];
    const title = decodeEnt(tt ? stripTags(tt) : hrefM ? hrefM[2] : "") || null;

    // Kartu di section "Latest Update"/"Project Update" nunjuk ke URL CHAPTER,
    // bukan /manga/<slug>/. Bedakan supaya konsumen gak salah pakai.
    // Format chapter yang dipakai site: /<slug>-chapter-<n>/ (umum) DAN
    // /<slug>-<n>/ tanpa kata "chapter" (langka, contoh /im-a-vampire-43/).
    const isSeriesUrl = Boolean(url && /\/manga\/[^/]+\/?$/.test(url));
    const chM = !isSeriesUrl && url
      ? url.match(/^https:\/\/kanzenin\.info\/(.+?)-(?:chapter-)?(\d+(?:-\d+)?)\/$/)
      : null;
    const item = {
      url,
      title,
      image: img,
      status: status ? status.trim() : null,
      type,
      latest: eps ? eps.trim() : null,
      rating: rating ? Number(rating) : null,
      date: date ? date.trim() : null,
      kind: chM ? "chapter" : "series",
    };
    if (chM) {
      item.series_slug = chM[1];
      item.series_url = `${BASE}/manga/${chM[1]}/`;
      item.chapter_url = url;
      item.chapter = Number(chM[2].replace("-", "."));
    } else if (url) {
      const sM = url.match(/\/manga\/([^/]+)\//);
      if (sM) {
        item.series_slug = sM[1];
        item.series_url = url;
      }
    }
    out.push(item);
  }
  return out;
}

function maxPage(html) {
  // max dari semua link /page/N/ (search: /page/N/?s=q, genre: /genres/x/page/N/,
  // az: /a-z-list/page/N/). WordPress selalu menampilkan nomor halaman terakhir.
  let max = 1;
  for (const m of html.matchAll(/page\/(\d+)\//g)) max = Math.max(max, Number(m[1]));
  return max;
}

// ---------- API ----------

/**
 * Search doujin. Pagination: `?s=<q>&paged=<n>` (10/page).
 * @returns {Promise<{items, page, max_page}>}
 */
export async function search(query, { page = 1, limit = 50 } = {}) {
  const q = encodeURIComponent(query);
  const url = page <= 1 ? `${BASE}/?s=${q}` : `${BASE}/?s=${q}&paged=${page}`;
  const { body } = await httpGet(url);
  const items = allBsxItems(body).slice(0, limit);
  return { items, page, max_page: maxPage(body) };
}

/**
 * AZ list per huruf: "0-9", ".", "A".."Z". Ada pagination /a-z-list/page/N/
 * (per huruf, bukan global).
 * @returns {Promise<{items, page, max_page, letter}>}
 */
export async function azList(letter = "A", { page = 1 } = {}) {
  const url =
    page <= 1
      ? `${BASE}/a-z-list/?show=${encodeURIComponent(letter)}`
      : `${BASE}/a-z-list/page/${page}/?show=${encodeURIComponent(letter)}`;
  const { body } = await httpGet(url);
  return { items: allBsxItems(body), page, max_page: maxPage(body), letter };
}

/**
 * Semua series (loop huruf). { letters: [...] } opsional.
 */
export async function allSeries({ letters } = {}) {
  const ls = letters || ["0-9", ".", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];
  const out = [];
  for (const l of ls) {
    const { items } = await azList(l);
    out.push(...items);
  }
  const seen = new Set();
  return out.filter((x) => (x.url && !seen.has(x.url) ? (seen.add(x.url), true) : false));
}

/**
 * Series per genre. Pagination: /genres/<slug>/page/<n>/
 * @returns {Promise<{items, page, max_page}>}
 */
export async function byGenre(slug, { page = 1, limit = 100 } = {}) {
  const url = page <= 1 ? `${BASE}/genres/${slug}/` : `${BASE}/genres/${slug}/page/${page}/`;
  const { body } = await httpGet(url);
  return { items: allBsxItems(body).slice(0, limit), page, max_page: maxPage(body) };
}

/**
 * Daftar genre lengkap dari widget filter /manga/ (44 genre).
 * Ambil ID (dipakai filter browse) + slug (dipakai byGenre) + nama.
 * -> [{ id, slug, name }]
 */
export async function genres() {
  const { body } = await httpGet(`${BASE}/manga/`);
  // widget filter: <input ... id="genre-1607" name="genre[]" value="1607"><label ...>Action</label>
  const byName = new Map();
  for (const m of body.matchAll(
    /name="genre\[\]"\s+value="(\d+)">\s*<label[^>]*>([^<]+)<\/label>/g
  )) {
    byName.set(decodeEnt(m[2].trim()), Number(m[1]));
  }
  // slug dari link /genres/<slug>/ (sidebar/footer), join by nama
  const slugByName = new Map();
  for (const m of body.matchAll(
    /href="https:\/\/kanzenin\.info\/genres\/([a-z0-9-]+)\/"[^>]*>\s*([^<]+?)\s*</g
  )) {
    const nm = decodeEnt(m[2].trim());
    if (!slugByName.has(nm)) slugByName.set(nm, m[1]);
  }
  return [...byName.entries()].map(([name, id]) => ({
    id,
    slug: slugByName.get(name) || name.toLowerCase().replace(/\s+/g, "-"),
    name,
  }));
}

/**
 * Directory /manga/ dengan filter lengkap (advanced search theme).
 * Pagination pakai `?page=N` (BUKAN /page/N/ atau ?paged=N — dua itu diam-diam
 * balik page 1). 27 item/halaman.
 *
 * @param {object} o
 *   o.genre   - array ID genre (dari genres().id) — semantik AND (irisan)
 *   o.status  - "" | "ongoing" | "completed" | "hiatus"
 *   o.type    - "" | "manga" | "manhwa" | "manhua" | "comic" | "novel"
 *   o.order   - "" (default) | "title" | "titlereverse" | "update" | "latest" | "popular"
 *   o.page    - 1-based
 * @returns {Promise<{items, page, has_next, next_page}>}
 */
export async function browse({ genre = [], status = "", type = "", order = "", page = 1 } = {}) {
  const p = new URLSearchParams();
  for (const g of genre) p.append("genre[]", String(g));
  if (status) p.set("status", status);
  if (type) p.set("type", type);
  if (order) p.set("order", order);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  const url = `${BASE}/manga/${qs ? `?${qs}` : ""}`;
  const { body } = await httpGet(url);
  // tombol Next di div.hpage: <a href="?page=N&order=..." class="r">Next</a>
  const nx = body.match(/href="\?page=(\d+)(?:&amp;|&)?[^"]*"\s+class="r"/);
  return {
    items: allBsxItems(body),
    page,
    has_next: Boolean(nx),
    next_page: nx ? Number(nx[1]) : null,
    url,
  };
}

/**
 * /manga/list-mode — SATU request berisi SELURUH katalog (2328 series per
 * audit 2026-08-31), lengkap post_id, dikelompokkan per huruf.
 * Jauh lebih efisien daripada allSeries() yang loop 28 huruf x pagination.
 * -> { total, letters: {A: n, ...}, items: [{ post_id, slug, url, title, letter }] }
 */
export async function listMode() {
  // WAJIB `/manga/?list`, JANGAN `/manga/list-mode/`.
  // Keduanya render soralist yang sama, TAPI /manga/list-mode/ adalah halaman
  // statis yang basi (last-modified Juni 2026) dan cuma punya 2328 series.
  // /manga/?list di-render live -> 2362 series, cocok persis dgn walk browse().
  const { body } = await httpGet(`${BASE}/manga/?list`);
  const i = body.indexOf('class="soralist"');
  const seg = i >= 0 ? body.slice(i) : body;
  const items = [];
  const letters = {};
  for (const g of seg.matchAll(
    /<div class="blix"><span><a name="[^"]*">([^<]*)<\/a><\/span><ul>([\s\S]*?)<\/ul>/g
  )) {
    const letter = decodeEnt(g[1].trim());
    let n = 0;
    for (const m of g[2].matchAll(
      /<a class="series[^"]*" rel="(\d+)" href="(https:\/\/kanzenin\.info\/manga\/([^"/]+)\/)">([^<]*)</g
    )) {
      items.push({
        post_id: Number(m[1]),
        slug: m[3],
        url: m[2],
        title: decodeEnt(m[4].trim()),
        letter,
      });
      n++;
    }
    letters[letter] = n;
  }
  return { total: items.length, letters, items };
}

/**
 * Homepage: 4 section (Popular Today / Project Update / Latest Update /
 * Recommendation) + daftar rilis chapter terbaru.
 * -> { sections: {name: [item]}, latest_chapters: [{series, chapter, url}] }
 */
export async function home() {
  const { body } = await httpGet(`${BASE}/`);
  const sections = {};
  // setiap section: <h2>Nama</h2> ... <div class="listupd">...</div>
  const heads = [...body.matchAll(/<(?:h[123])[^>]*>([^<]{2,60})<\/(?:h[123])>/g)];
  for (let k = 0; k < heads.length; k++) {
    const name = decodeEnt(heads[k][1].trim());
    const from = heads[k].index;
    const to = k + 1 < heads.length ? heads[k + 1].index : body.length;
    const items = allBsxItems(body.slice(from, to));
    if (items.length) sections[name] = items;
  }
  // rilis chapter terbaru: ambil dari kartu kind="chapter" (Latest/Project
  // Update) — lebih akurat daripada regex URL, karena ada slug chapter yang
  // gak pakai kata "chapter" (/im-a-vampire-43/).
  const latest_chapters = [];
  const seen = new Set();
  for (const it of Object.values(sections).flat()) {
    if (it.kind !== "chapter" || seen.has(it.chapter_url)) continue;
    seen.add(it.chapter_url);
    latest_chapters.push({
      series: it.series_slug,
      series_title: it.title,
      chapter: it.chapter,
      url: it.chapter_url,
      date: it.date,
    });
  }
  return { sections, latest_chapters };
}

/**
 * /project/ — series yang digarap sendiri tim kanzenin.
 * ADA pagination (104 halaman, 20/page) — `all: true` untuk walk semuanya.
 * -> { items, count, page, max_page }
 */
export async function project({ page = 1, all = false } = {}) {
  const url = page > 1 ? `${BASE}/project/page/${page}/` : `${BASE}/project/`;
  const { body } = await httpGet(url);
  const max = maxPage(body);
  if (!all) {
    const items = allBsxItems(body);
    return { items, count: items.length, page, max_page: max };
  }
  const seen = new Map();
  for (const it of allBsxItems(body)) seen.set(it.url, it);
  for (let p = 2; p <= max; p++) {
    const { body: b } = await httpGet(`${BASE}/project/page/${p}/`);
    for (const it of allBsxItems(b)) seen.set(it.url, it);
  }
  const items = [...seen.values()];
  return { items, count: items.length, page: 1, max_page: max };
}

/**
 * RSS feed /feed/ — 10 rilis chapter terakhir + timestamp presisi.
 * Paling murah buat polling update (3KB vs 19KB homepage).
 * -> [{ title, url, date, iso }]
 */
export async function feed() {
  const { body } = await httpGet(`${BASE}/feed/`);
  const out = [];
  for (const m of body.matchAll(
    /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<pubDate>([^<]+)<\/pubDate>/g
  )) {
    const title = decodeEnt(m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim());
    out.push({
      title,
      url: m[2].trim(),
      date: m[3].trim(),
      iso: new Date(m[3].trim()).toISOString(),
    });
  }
  return out;
}

/**
 * Detail series: /manga/<slug>/
 * Chapter list LANGSUNG di HTML (li[data-num]) — dedup by number
 * (site punya duplikat, contoh rooftop-sex-king: 58/57/54 x2).
 * -> { slug, title, url, image, status, type, released, author, artist,
 *      serialization, posted_on, updated_on, views, rating, followers,
 *      genres, post_id, first_chapter, latest_chapter, synopsis,
 *      chapters: [{number, url, title, date}] }
 */
export async function series(slug) {
  const url = `${BASE}/manga/${slug}/`;
  const { body } = await httpGet(url);

  const get = (label) => {
    const m = body.match(new RegExp(`<td>${label}</td>\\s*<td>([\\s\\S]*?)</td>`));
    return m ? decodeEnt(stripTags(m[1])) : null;
  };
  const title = pageTitle(body);
  const post_id = (body.match(/class="post-(\d+)/) || [])[1] || null;
  // cover asli ada di div.thumb (itemprop=image) — BUKAN img.ts-post-image,
  // itu punya kartu sidebar/recommendation.
  const thumbBlk = body.match(/<div class="thumb"[^>]*>([\s\S]{0,600}?)<\/div>/);
  const image =
    (thumbBlk && (thumbBlk[1].match(/<img[^>]+src="([^"]+)"/) || [])[1]) ||
    (body.match(/<img[^>]+class="[^"]*wp-post-image[^"]*"[^>]+src="([^"]+)"/) || [])[1] ||
    null;
  const rating = (body.match(/itemprop="ratingValue" content="([\d.]+)"/) || [])[1] || null;
  const rating_count = (body.match(/itemprop="ratingCount" content="(\d+)"/) || [])[1] || null;
  const followers = (body.match(/Followed by ([\d.,]+)/) || [])[1] || null;
  const views = get("Views");
  const posted_at = (body.match(/itemprop="datePublished" datetime="([^"]+)"/) || [])[1] || null;
  const updated_at = (body.match(/itemprop="dateModified" datetime="([^"]+)"/) || [])[1] || null;
  const posted_by = (body.match(/<i itemprop="name">([^<]+)<\/i>/) || [])[1] || null;
  const desc =
    (body.match(/<div class="entry-content entry-content-single"[^>]*itemprop="description">([\s\S]*?)<\/div>/) || [])[1];

  // Genre series HANYA di div.seriestugenre. Kalau scan seluruh body, widget
  // filter sidebar (44 genre site) ikut kebawa.
  const gmap = new Map();
  const gblk = body.match(/<div class="seriestugenre">([\s\S]*?)<\/div>/);
  for (const m of (gblk ? gblk[1] : "").matchAll(
    /href="https:\/\/kanzenin\.info\/genres\/([a-z0-9-]+)\/"[^>]*>\s*([^<]+?)\s*</g
  )) {
    if (!gmap.has(m[1])) gmap.set(m[1], decodeEnt(m[2].trim()));
  }

  // chapter list dari HTML + dedup (site punya chapter duplikat).
  // PENTING: <li> bisa punya class (contoh class="first-chapter" di series
  // one-shot 1 chapter) — regex WAJIB toleran, kalau `<li data-num="N">` exact
  // maka semua series 1-chapter balik 0 chapter.
  const rawCh = [
    ...body.matchAll(
      /<li data-num="([^"]+)"[^>]*>\s*<div class="chbox">\s*<div class="eph-num">\s*<a href="([^"]+)">\s*<span class="chapternum">([^<]+)<\/span>\s*<span class="chapterdate">([^<]+)<\/span>/g
    ),
  ].map((m) => {
    // data-num BUKAN selalu angka bersih: bisa "45 End", "12.5", "7 Tamat".
    // Ambil angka di depan; sisanya jadi label.
    const raw = decodeEnt(m[1].trim());
    const numM = raw.match(/^(\d+(?:[.,]\d+)?)/);
    const suffix = numM ? raw.slice(numM[0].length).trim() : raw;
    return {
      number: numM ? Number(numM[1].replace(",", ".")) : null,
      number_raw: raw,
      label: suffix || null,
      is_end: /\b(end|tamat|fin|final)\b/i.test(raw),
      url: m[2],
      title: decodeEnt(m[3].trim()),
      date: decodeEnt(m[4].trim()),
    };
  });
  const seenNum = new Set();
  const chapters = rawCh.filter((c) => {
    // dedup by nomor (site punya entry duplikat). Kalau nomor gak keparse,
    // pakai URL supaya entry-nya gak ikut kebuang.
    const key = c.number === null ? `u:${c.url}` : `n:${c.number}`;
    if (seenNum.has(key)) return false;
    seenNum.add(key);
    return true;
  });
  // urutkan desc (terbaru duluan, sesuai site); nomor null ditaruh belakang
  chapters.sort((a, b) => (b.number ?? -Infinity) - (a.number ?? -Infinity));

  const fl = body.match(/epcurlast">Chapter ([\d.]+)/);
  const f0 = body.match(/epcurfirst">Chapter ([\d.]+)/);

  return {
    slug,
    title,
    url,
    image,
    status: get("Status"),
    type: get("Type"),
    released: get("Released"),
    author: get("Author"),
    artist: get("Artist"),
    serialization: get("Serialization"),
    posted_on: get("Posted On"),
    updated_on: get("Updated On"),
    views: views && views !== "?" ? views : null,
    rating: rating ? Number(rating) : null,
    rating_count: rating_count ? Number(rating_count) : null,
    followers: followers ? Number(String(followers).replace(/[.,]/g, "")) : null,
    genres: [...gmap.values()],
    genre_slugs: [...gmap.keys()],
    posted_by,
    posted_at,
    updated_at,
    post_id: post_id ? Number(post_id) : null,
    first_chapter: f0 ? Number(f0[1]) : (chapters.length ? chapters[chapters.length - 1].number : null),
    latest_chapter: fl ? Number(fl[1]) : (chapters.length ? chapters[0].number : null),
    synopsis: desc ? decodeEnt(stripTags(desc)) : null,
    chapters,
  };
}

/**
 * Slug chapter dari nomor: 67 -> "<slug>-chapter-67", 67.5 -> "...-chapter-67-5".
 *
 * CATATAN: ini best-effort. Sebagian chapter di site pakai slug yang gak
 * mengikuti pola ini (suffix "-end", atau tanpa kata "chapter" sama sekali,
 * contoh /im-a-vampire-43/). Untuk hasil pasti, ambil `url` dari
 * series().chapters — jangan bikin URL sendiri.
 */
export function chapterSlug(seriesSlug, number) {
  const n = String(number).replace(".", "-");
  return `${seriesSlug}-chapter-${n}`;
}

/**
 * Gambar halaman chapter. Filter: di dalam #readerarea, ambil img yang
 * host-nya BUKAN kanzenin.info (semua halaman reader dilayani CDN eksternal,
 * sedangkan ads/cover/sidebar selalu di domain site).
 * -> { url, number, title, pages: [{n, url}], count }
 */
export async function chapterImages(chapterUrl) {
  const url = chapterUrl.startsWith("http") ? chapterUrl : `${BASE}/${chapterUrl}/`;
  const { body } = await httpGet(url);

  // Nomor chapter dari URL. Variasi nyata di site:
  //   /x-chapter-5/        -> 5
  //   /x-chapter-67-5/     -> 67.5   (desimal pakai dash)
  //   /x-chapter-45-end/   -> 45     (suffix kata: end/tamat/final)
  //   /x-43/               -> 43     (tanpa kata "chapter")
  const tail = url.replace(/\/+$/, "").split("/").pop();
  const mnum =
    tail.match(/-chapter-(\d+)(?:-(\d+))?(?:-[a-z]+)?$/i) ||
    tail.match(/-(\d+)(?:-(\d+))?(?:-[a-z]+)?$/i);
  const number = mnum
    ? mnum[2] !== undefined
      ? Number(`${mnum[1]}.${mnum[2]}`)
      : Number(mnum[1])
    : null;

  let seg = body;
  const ri = body.indexOf('id="readerarea"');
  if (ri >= 0) seg = body.slice(ri);
  const urls = [];
  for (const m of seg.matchAll(/<img[^>]+(?:src|data-src)="(https?:\/\/[^"]+)"/gi)) {
    const u = m[1];
    if (!IMG_EXT.test(u)) continue; // harus ext gambar
    let host;
    try { host = new URL(u).hostname; } catch { continue; }
    if (host === SITE_HOST || host.endsWith(`.${SITE_HOST}`)) continue; // buang ads/cover site
    if (urls.includes(u)) continue;
    urls.push(u);
  }
  const title = pageTitle(body);

  return {
    url,
    number,
    title,
    pages: urls.map((u, i) => ({ n: i + 1, url: u })),
    count: urls.length,
  };
}

/**
 * Download semua gambar chapter ke folder.
 */
export async function downloadChapter(chapterUrl, outDir, { first, referer = true } = {}) {
  const ch = await chapterImages(chapterUrl);
  if (!ch.count) throw new Error("tidak ada gambar (chapter kosong / 404 / CDN beda?)");
  const pages = first ? ch.pages.slice(0, first) : ch.pages;
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const p of pages) {
    const ext = (p.url.match(IMG_EXT) || [".jpg"])[0].toLowerCase();
    const file = path.join(outDir, `p${String(p.n).padStart(3, "0")}${ext}`);
    const args = ["-sS", "-m", "60", "-A", UA, "-o", file];
    if (referer) args.push("-H", `Referer: ${ch.url}`);
    args.push(p.url);
    await new Promise((resolve, reject) => {
      const c = spawn("curl", args);
      let e = "";
      c.stderr.on("data", (d) => (e += d));
      c.on("error", reject);
      c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(e.trim() || `curl ${code}`))));
    });
    await new Promise((r) => setTimeout(r, 300));
    const size = fs.statSync(file).size;
    if (size === 0) throw new Error(`file kosong di p${p.n}: ${p.url}`);
    results.push({ n: p.n, file, bytes: size });
  }
  return { chapter: ch.url, dir: outDir, files: results };
}
