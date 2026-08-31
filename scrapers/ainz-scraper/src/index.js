// Ainz Scans ID scraper — zero-dep (Node >= 18)
// Site: https://v3.ainzscans01.com (SvelteKit SPA + NestJS API, Cloudflare lenient)
//
// KEY FINDINGS:
// - CF blocks default bot UA (python/curl UA variants) with 403; browser UA = 200.
// - No challenge/Turnstile/clearance cookie needed.
// - Node fetch with browser UA may or may not pass CF TLS inspection depending on
//   edge behavior — we auto-fall back to `curl` transport when fetch fails or 403s.
// - API base: /api. All endpoints GET, JSON.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = "https://v3.ainzscans01.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const AINZ = { base: BASE, ua: UA };

// ---------------------------------------------------------------------------
// transport: fetch first, curl fallback (same pattern as nhentai-scraper)
// ---------------------------------------------------------------------------
function curlGet(url, { headers = {}, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-sS", "-m", String(Math.ceil(timeoutMs / 1000)), "-D", "-", "-w", "\n__HTTP_STATUS__:%{http_code}"];
    for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
    args.push(url);
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`curl exit ${code}: ${err.slice(0, 200)}`));
      const m = out.match(/\r?\n__HTTP_STATUS__:(\d+)\s*$/);
      const status = m ? Number(m[1]) : 0;
      const body = m ? out.slice(0, m.index) : out;
      // strip header part (everything before blank line)
      const idx = body.search(/\r?\n\r?\n/);
      const text = idx >= 0 ? body.slice(idx + (body[idx + 1] === "\n" ? 2 : 2)) : body;
      resolve({ status, text, via: "curl" });
    });
  });
}

async function httpGetJson(path, { tries = 3, spacingMs = 1200 } = {}) {
  const url = path.startsWith("http") ? path : BASE + path;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (i > 0) await sleep(spacingMs * (i + 1));
    try {
      // 1) try native fetch
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json", Referer: BASE + "/" },
        signal: AbortSignal.timeout(30000),
      });
      const text = await res.text();
      if (res.ok) {
        return JSON.parse(text);
      }
      lastErr = new Error(`HTTP ${res.status} via fetch`);
      // 403/503 -> CF likely; try curl transport
      if (res.status === 403 || res.status === 503 || res.status === 520) {
        const c = await curlGet(url, { headers: { "User-Agent": UA, Accept: "application/json", Referer: BASE + "/" } });
        if (c.status === 200) return JSON.parse(c.text);
        lastErr = new Error(`HTTP ${c.status} via curl`);
      }
    } catch (e) {
      lastErr = e;
      // network/parse error -> try curl
      try {
        const c = await curlGet(url, { headers: { "User-Agent": UA, Accept: "application/json", Referer: BASE + "/" } });
        if (c.status === 200) return JSON.parse(c.text);
        lastErr = new Error(`HTTP ${c.status} via curl`);
      } catch (e2) {
        lastErr = e2;
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// endpoints
// ---------------------------------------------------------------------------

/**
 * Search comics/anime/novels by keyword + filters.
 *
 * Verified filter params (live 2026-08-30):
 *   q          — keyword (optional; empty = browse all)
 *   page       — 1-based
 *   limit      — per page (default 20)
 *   sort       — "popular" (default) | "latest" | "rating" | "views"
 *   type       — "COMIC" | "ANIME" | "NOVEL"  (content type)
 *   comic_type — "MANHUA" | "MANHWA" | "MANGA" (comic subtype only)
 *   genre      — genre slug (e.g. "action", "romance") — see genres()
 *   status     — "ONGOING" | "COMPLETED" | ...
 *
 * @param {string} query
 * @param {object} opts
 * @returns {Promise<{items: object[], page: number, limit: number, total: number, total_pages: number}>}
 */
export function search(query = "", { page = 1, limit, sort, type, comic_type, genre, status } = {}) {
  const p = new URLSearchParams();
  p.set("q", String(query).trim());
  p.set("page", String(page));
  if (limit) p.set("limit", String(limit));
  if (sort) p.set("sort", sort);
  if (type) p.set("type", type);
  if (comic_type) p.set("comic_type", comic_type);
  if (genre) p.set("genre", genre);
  if (status) p.set("status", status);
  return httpGetJson(`/api/search?${p.toString()}`).then((d) => ({
    items: d.data ?? [],
    page: d.page,
    limit: d.limit,
    total: d.total,
    total_pages: d.total_pages,
  }));
}

/**
 * Browse = search with empty query (same endpoint, q="").
 */
export function browse({ page = 1, limit, sort = "popular", type, comic_type, genre, status } = {}) {
  return search("", { page, limit, sort, type, comic_type, genre, status });
}

/**
 * List all genres -> [{id, slug, name}].
 */
export function genres() {
  return httpGetJson("/api/genres");
}

/**
 * Chapter/series comments.
 * @param {object} opts { entity_id, unit_id, limit, offset }
 *   entity_id = series id, unit_id = chapter id (dari chapterDetail.chapter.id)
 */
export function comments({ entity_id, unit_id, limit = 20, offset = 0 } = {}) {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (entity_id) p.set("entity_id", entity_id);
  if (unit_id) p.set("unit_id", unit_id);
  return httpGetJson(`/api/comments?${p.toString()}`);
}

/**
 * Home sections (hot_weekly, popular_daily, latest_projects, latest_comic_updates).
 * latest_comic_updates[].chapters = 3 latest chapters per series (with slugs).
 */
export function homeSections() {
  return httpGetJson("/api/comic/home-sections");
}

/**
 * Series detail by slug.
 * @param {string} slug
 * @param {"comic"|"anime"|"novels"} type
 */
export function seriesDetail(slug, type = "comic") {
  return httpGetJson(`/api/series/${type}/${encodeURIComponent(slug)}`);
}

/**
 * Chapter detail by series slug + chapter slug (e.g. "chapter-49").
 * Returns { series, chapter:{..., pages:[{page_number, image_url, ...}]}, units, previous_chapter, next_chapter }
 */
export function chapterDetail(seriesSlug, chapterSlug, type = "comic") {
  return httpGetJson(
    `/api/series/${type}/${encodeURIComponent(seriesSlug)}/chapter/${encodeURIComponent(chapterSlug)}`
  );
}

/**
 * All chapters of a series (from series detail `units`), sorted asc by number.
 * @returns {Promise<Array<{id:number, number:string, slug:string, title:string, created_at:string, is_premium:boolean, is_locked:boolean}>>}
 */
export async function chapterList(seriesSlug, type = "comic") {
  const d = await seriesDetail(seriesSlug, type);
  const units = Array.isArray(d.units) ? d.units : [];
  return units
    .slice()
    .sort((a, b) => Number(a.sort_number ?? a.number) - Number(b.sort_number ?? b.number));
}

/**
 * Resolve an image URL to absolute (handles /api/uploads/... and bare paths).
 */
export function imageUrl(u) {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return "https:" + u;
  return BASE + (u.startsWith("/") ? u : "/" + u);
}

/**
 * Convenience: fetch one chapter -> normalized {title, pages: [{n, url}]}.
 */
export async function getChapterImages(seriesSlug, chapterSlug, type = "comic") {
  const d = await chapterDetail(seriesSlug, chapterSlug, type);
  const pages = (d.chapter?.pages ?? [])
    .slice()
    .sort((a, b) => Number(a.page_number) - Number(b.page_number));
  return {
    series: d.series?.title,
    seriesSlug: d.series?.slug,
    chapter: d.chapter?.title,
    chapterSlug: d.chapter?.slug,
    number: d.chapter?.number,
    pages: pages.map((p) => ({ n: p.page_number, url: imageUrl(p.image_url) })),
    prev: d.previous_chapter ? { slug: d.previous_chapter.slug, number: d.previous_chapter.number } : null,
    next: d.next_chapter ? { slug: d.next_chapter.slug, number: d.next_chapter.number } : null,
  };
}
