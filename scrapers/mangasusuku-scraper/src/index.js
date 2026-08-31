// Mangasusu (mangasusuku.com) scraper — zero-dep, Node >= 18
//
// Stack site (audit 2026-08-31):
//   - WordPress 7.1 + theme "mangareader" (Madara clone) — server-rendered HTML
//   - Dibalik Sucuri Cloudproxy (server: Sucuri/Cloudproxy)
//   - Challenge Sucuri: intermittent per-IP (307 + JS blob base64+eval -> set
//     cookie sucuri_cloudproxy_uuid_* + reload). Setelah satu kali dipecah
//     (browser, atau IP lolos), request HTTP biasa = 200 tanpa cookie.
//   - Jika kena challenge lagi: library ini auto-fallback ke curl, dan bisa
//     dipancing ulang dgn browser (lihat README "Anti-bot").
//   - Chapter list: POST /wp-admin/admin-ajax.php {action:get_chapters,id:post_id}
//     (balik ~7 chapter terbaru = chapter yang benar-benar ada di site)
//   - Gambar chapter: cdn.uqni.net (strip jpeg)
//
// Catatan produksi: site ini hanya me-host ~chapter terbaru per series
// (contoh: Solo Leveling hanya chapter 149-155; chapter lama = 404).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://mangasusuku.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CHALLENGE_HINTS = /being redirected|sucuri_cloudproxy|Just a moment/i;

let lastFetchMs = 0;
async function throttle(ms = 700) {
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

async function httpGet(url, { data, referer, retries = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    await throttle();
    let status = 0, headers = {}, body = "";
    let transport = "fetch";
    try {
      const r = await fetch(url, {
        method: data ? "POST" : "GET",
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
          ...(data ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" } : {}),
          ...(referer ? { Referer: referer } : {}),
        },
        redirect: "follow",
        body: data || undefined,
      });
      status = r.status;
      headers = Object.fromEntries(r.headers.entries());
      body = await r.text();
    } catch (e) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      // fallback curl
      transport = "curl";
      try {
        const res = await curlGet(url, { data, referer });
        status = res.status; headers = res.headers; body = res.body;
      } catch (e2) {
        throw new Error(`GET gagal (fetch: ${e.message} | curl: ${e2.message})`);
      }
    }

    const challenged = status === 307 || CHALLENGE_HINTS.test(body.slice(0, 5000));
    if (challenged && transport === "fetch") {
      // coba curl — kadang fingerprint HTTP berbeda lolos
      const res = await curlGet(url, { data, referer });
      status = res.status; headers = res.headers; body = res.body;
    }
    if (CHALLENGE_HINTS.test(body.slice(0, 5000)) && (status === 307 || status === 403)) {
      const msg =
        `Kena Sucuri Cloudproxy challenge (HTTP ${status}).\n` +
        `Solusi: buka ${url} sekali di browser (headless Playwright / Chromium) ` +
        `untuk menyelesaikan JS challenge, lalu ulangi. Lihat README bagian "Anti-bot".`;
      throw new Error(msg);
    }
    if (status === 200 || status === 301) return { status, headers, body, transport };
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

function allBsxItems(html) {
  const out = [];
  const re = /<div class="bsx">([\s\S]*?)<\/a>\s*<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const blk = m[1];
    const href = (blk.match(/href="(https?:[^"]+)"\s+title="([^"]*)"/) || [])[0];
    const url = href ? href.match(/href="([^"]+)"/)[1] : null;
    const title = href ? href.match(/title="([^"]*)"/)[1] : null;
    const img = (blk.match(/<img[^>]+src="([^"]+)"/) || [])[1] || null;
    const status = (blk.match(/class="status\s+([^"]+)">([^<]+)</) || [])[2] || null;
    const eps = (blk.match(/class="epxs">([^<]+)/) || [])[1] || null;
    const rating = (blk.match(/class="numscore">([^<]+)/) || [])[1] || null;
    out.push({ url, title, image: img, status, latest: eps ? eps.trim() : null, rating: rating ? Number(rating) : null });
  }
  return out;
}

function maxPage(html) {
  let max = 1;
  for (const m of html.matchAll(/page\/(\d+)\//g)) max = Math.max(max, Number(m[1]));
  return max;
}

// ---------- API ----------

/**
 * Search manga/manhwa. Site gak punya pagination untuk search
 * (?s=...&paged=2 = 404) — semua hasil satu halaman.
 */
export async function search(query, { limit = 50 } = {}) {
  const url = `${BASE}/?s=${encodeURIComponent(query)}`;
  const { body } = await httpGet(url);
  return allBsxItems(body).slice(0, limit);
}

/**
 * AZ list per huruf. param: "0-9", "A".."Z", atau "." (simbol).
 * Gak ada pagination — satu halaman per huruf.
 */
export async function azList(letter = "A") {
  const url = `${BASE}/az-list/?show=${encodeURIComponent(letter)}`;
  const { body } = await httpGet(url);
  return allBsxItems(body);
}

/**
 * Semua series di site (loop huruf). Opsi: { letters: ["A","B"] }.
 */
export async function allSeries({ letters } = {}) {
  const ls = letters || ["0-9", ".", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];
  const out = [];
  for (const l of ls) {
    out.push(...(await azList(l)));
  }
  // dedup by url
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
  const items = allBsxItems(body).slice(0, limit);
  return { items, page, max_page: maxPage(body) };
}

/**
 * Daftar genre yang ada di site (dari homepage widget).
 */
export async function genres() {
  const { body } = await httpGet(`${BASE}/`);
  const seen = new Map();
  for (const m of body.matchAll(/href="https:\/\/mangasusuku\.com\/genres\/([a-z0-9-]+)\/"[^>]*>\s*([^<]+?)\s*</g)) {
    if (!seen.has(m[1])) seen.set(m[1], m[2].trim());
  }
  return [...seen.entries()].map(([slug, name]) => ({ slug, name }));
}

/**
 * Detail series: /komik/<slug>/
 * -> { slug, title, url, image, status, type, released, author, artist,
 *      serialization, posted_on, updated_on, rating, followers, genres,
 *      post_id, latest_chapter, synopsis, chapters[] }
 * chapters[] dari admin-ajax get_chapters (chapter yang benar2 ada di site).
 */
export async function series(slug) {
  const url = `${BASE}/komik/${slug}/`;
  const { body } = await httpGet(url);

  const get = (label) => {
    const m = body.match(new RegExp(`<td>${label}</td>\\s*<td>([\\s\\S]*?)</td>`));
    return m ? stripTags(m[1]) : null;
  };
  const title = (body.match(/<title>([^|<]+)/) || [])[1]?.trim() || null;
  const post_id = (body.match(/class="post-(\d+)/) || [])[1] || null;
  const image = (body.match(/<img[^>]+class="ts-post-image[^"]*"[^>]+src="([^"]+)"/) || [])[1] || null;
  const rating = (body.match(/itemprop="ratingValue" content="([\d.]+)"/) || [])[1] || null;
  const followers = (body.match(/Followed by (\d+)/) || [])[1] || null;
  const desc = (body.match(/<div class="entry-content entry-content-single"[^>]*itemprop="description">([\s\S]*?)<\/div>/) || [])[1];
  const latest = (body.match(/epcurlast">Chapter ([^<]+)/) || [])[1] || null;

  const gmap = new Map();
  for (const m of body.matchAll(/href="https:\/\/mangasusuku\.com\/genres\/([a-z0-9-]+)\/"[^>]*>\s*([^<]+?)\s*</g)) {
    if (!gmap.has(m[1])) gmap.set(m[1], m[2].trim());
  }

  let chapters = [];
  if (post_id) {
    try {
      const aj = await httpGet(`${BASE}/wp-admin/admin-ajax.php`, {
        data: `action=get_chapters&id=${post_id}`,
        referer: url,
      });
      for (const m of aj.body.matchAll(/<option data-id="(\d+)" value="([^"]+)">([^<]+)<\/option>/g)) {
        chapters.push({ id: Number(m[1]), url: m[2], title: m[3].trim() });
      }
    } catch (e) {
      chapters = []; // ajax gagal -> kosong, tetap kembalikan metadata
    }
  }

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
    rating: rating ? Number(rating) : null,
    followers: followers ? Number(followers) : null,
    genres: [...gmap.values()],
    post_id: post_id ? Number(post_id) : null,
    latest_chapter: latest ? Number(latest.replace(/\D/g, "")) || latest : null,
    synopsis: desc ? stripTags(desc) : null,
    chapters,
  };
}

/**
 * Gambar halaman chapter: /<slug>-chapter-<n>/
 * -> { slug, number, url, title, pages: [{n, url}], count }
 */
export async function chapterImages(chapterUrl) {
  const url = chapterUrl.startsWith("http") ? chapterUrl : `${BASE}/${chapterUrl}/`;
  const { body } = await httpGet(url);

  const mnum = url.match(/chapter-(\d+)(?:-|\b|$)/) || url.match(/chapter[-_]?(\d+)/);
  const number = mnum ? Number(mnum[1]) : null;

  // area reader: <div id="readerarea"> ... <img src="https://cdn...">
  let seg = body;
  const ri = body.indexOf('id="readerarea"');
  if (ri >= 0) seg = body.slice(ri);
  const urls = [];
  for (const m of seg.matchAll(/<img[^>]+(?:src|data-src)="(https?:\/\/[^"]+\.(?:jpe?g|png|webp|avif))"/gi)) {
    if (urls.includes(m[1])) continue;
    urls.push(m[1]);
  }
  const title = (body.match(/<title>([^<]+)/) || [])[1]?.trim() || null;

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
 * @param {string} chapterUrl url chapter (slug juga boleh)
 * @param {string} outDir
 * @param {{first?: number, referer?: boolean}} opts
 */
export async function downloadChapter(chapterUrl, outDir, { first, referer = true } = {}) {
  const ch = await chapterImages(chapterUrl);
  const pages = first ? ch.pages.slice(0, first) : ch.pages;
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const p of pages) {
    const ext = (p.url.match(/\.(jpe?g|png|webp|avif)/i) || [".jpg"])[0].toLowerCase();
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
    await new Promise((r) => setTimeout(r, 400));
    const size = fs.statSync(file).size;
    results.push({ n: p.n, file, bytes: size });
  }
  return { chapter: ch.url, dir: outDir, files: results };
}
