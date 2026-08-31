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
const decodeEnt = (s) =>
  (s || "")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&raquo;/g, "»")
    .replace(/&laquo;/g, "«");

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
    const title = hrefM ? decodeEnt(hrefM[2]) : null;
    const img = (blk.match(/<img[^>]+src="([^"]+)"/) || [])[1] || null;
    const status = (blk.match(/class="status\s+[^"]*">([^<]+)</) || [])[1] || null;
    const eps = (blk.match(/class="epxs">([^<]+)/) || [])[1] || null;
    const rating = (blk.match(/class="numscore">([^<]+)/) || [])[1] || null;
    out.push({
      url,
      title,
      image: img,
      status: status ? status.trim() : null,
      latest: eps ? eps.trim() : null,
      rating: rating ? Number(rating) : null,
    });
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
 * Daftar genre (dari homepage).
 */
export async function genres() {
  const { body } = await httpGet(`${BASE}/`);
  const seen = new Map();
  for (const m of body.matchAll(/href="https:\/\/kanzenin\.info\/genres\/([a-z0-9-]+)\/"[^>]*>\s*([^<]+?)\s*</g)) {
    if (!seen.has(m[1])) seen.set(m[1], decodeEnt(m[2].trim()));
  }
  return [...seen.entries()].map(([slug, name]) => ({ slug, name }));
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
  const image =
    (body.match(/<img[^>]+class="ts-post-image[^"]*"[^>]+src="([^"]+)"/) || [])[1] ||
    (body.match(/<img[^>]+src="([^"]+)"[^>]+class="ts-post-image/) || [])[1] ||
    null;
  const rating = (body.match(/itemprop="ratingValue" content="([\d.]+)"/) || [])[1] || null;
  const followers = (body.match(/Followed by (\d+)/) || [])[1] || null;
  const views = get("Views");
  const desc =
    (body.match(/<div class="entry-content entry-content-single"[^>]*itemprop="description">([\s\S]*?)<\/div>/) || [])[1];

  const gmap = new Map();
  for (const m of body.matchAll(/href="https:\/\/kanzenin\.info\/genres\/([a-z0-9-]+)\/"[^>]*>\s*([^<]+?)\s*</g)) {
    if (!gmap.has(m[1])) gmap.set(m[1], decodeEnt(m[2].trim()));
  }

  // chapter list dari HTML + dedup (site punya chapter duplikat)
  const rawCh = [
    ...body.matchAll(
      /<li data-num="([^"]+)">\s*<div class="chbox">\s*<div class="eph-num">\s*<a href="([^"]+)">\s*<span class="chapternum">([^<]+)<\/span>\s*<span class="chapterdate">([^<]+)<\/span>/g
    ),
  ].map((m) => ({
    number: Number(m[1]),
    url: m[2],
    title: decodeEnt(m[3].trim()),
    date: decodeEnt(m[4].trim()),
  }));
  const seenNum = new Set();
  const chapters = rawCh.filter((c) => (seenNum.has(c.number) ? false : (seenNum.add(c.number), true)));
  // urutkan desc (terbaru duluan, sesuai site)
  chapters.sort((a, b) => b.number - a.number);

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
    followers: followers ? Number(followers) : null,
    genres: [...gmap.values()],
    post_id: post_id ? Number(post_id) : null,
    first_chapter: f0 ? Number(f0[1]) : (chapters.length ? chapters[chapters.length - 1].number : null),
    latest_chapter: fl ? Number(fl[1]) : (chapters.length ? chapters[0].number : null),
    synopsis: desc ? decodeEnt(stripTags(desc)) : null,
    chapters,
  };
}

/**
 * Slug chapter dari nomor: 67 -> "chapter-67", 67.5 -> "chapter-67-5".
 */
export function chapterSlug(seriesSlug, number) {
  const n = String(number).replace(".", "-");
  return `${seriesSlug}-chapter-${n}`;
}

/**
 * Gambar halaman chapter. Filter ketat: hanya CDN reader (cdnasu.xyz)
 * karena halaman full dari ads/cover/sidebar.
 * -> { url, number, title, pages: [{n, url}], count }
 */
export async function chapterImages(chapterUrl) {
  const url = chapterUrl.startsWith("http") ? chapterUrl : `${BASE}/${chapterUrl}/`;
  const { body } = await httpGet(url);

  const mnum = url.match(/chapter-(\d+)(?:-(\d+))?/);
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
