// cosmicscans-scraper: API publik (library murni, tanpa dependensi).
//
// Sumber data: REST API publik cdncid.csmcscns.id (dipakai frontend SvelteKit
// 03.cosmicscans.to). Semua fungsi mengembalikan objek dengan bentuk seragam
// `{ source, url, ok, ... }` supaya enak dipakai CLI maupun konsumer lain.
//
// Pagination: API pakai CURSOR (opaque base64), bukan nomor halaman.
// Kirim `after` (maju) atau `before` (mundur) dari `cursor.nextCursor` /
// `cursor.prevCursor`. `limit` minimal 1 (limit=0 → HTTP 400 dari server).

import { apiGet, buildUrl, API_BASE, ADMIN_BASE, SITE, UA, HttpError, ApiError, clearCache, fetchRaw } from "./http.js";
import { nz, absUrl, stripHtml, imgSrc, normChapter, normCard, seriesPath, chapterPath } from "./normalize.js";

const SOURCE = "cosmicscans";

/** Bungkus hasil listing + cursor jadi bentuk seragam. */
function listResult(command, res, items) {
  const c = res.cursor || {};
  return {
    source: SOURCE,
    command,
    url: res.url,
    ok: true,
    count: items.length,
    pagination: {
      has_next: c.hasNext === true,
      has_prev: c.hasPrev === true,
      next_cursor: nz(c.nextCursor),
      prev_cursor: nz(c.prevCursor),
    },
    data: items,
  };
}

const cardsOf = (data) => (Array.isArray(data) ? data.map(normCard).filter(Boolean) : []);

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/** Update chapter terbaru. */
export async function latest({ limit = 20, after = null, before = null } = {}) {
  const res = await apiGet("/v1/manga/latest", { limit, after, before });
  return listResult("latest", res, cardsOf(res.data));
}

/** Slider utama homepage. */
export async function heroSlider({ limit = 5 } = {}) {
  const res = await apiGet("/v1/manga/heroSlider", { limit });
  return listResult("heroSlider", res, cardsOf(res.data));
}

/** Populer hari ini. */
export async function popularToday({ limit = 15, after = null, before = null } = {}) {
  const res = await apiGet("/v1/manga/popularToday", { limit, after, before });
  return listResult("popularToday", res, cardsOf(res.data));
}

/** Update terbaru khusus project sendiri. */
export async function latestProject({ limit = 18, after = null, before = null } = {}) {
  const res = await apiGet("/v1/manga/latestProject", { limit, after, before });
  return listResult("latestProject", res, cardsOf(res.data));
}

/** Seluruh daftar project. */
export async function projectAll({ limit = 20, after = null, before = null } = {}) {
  const res = await apiGet("/v1/manga/projectAll", { limit, after, before });
  return listResult("projectAll", res, cardsOf(res.data));
}

/** Katalog "All Comics". */
export async function allComics({ limit = 20, after = null, before = null } = {}) {
  const res = await apiGet("/v1/manga/allComics", { limit, after, before });
  return listResult("allComics", res, cardsOf(res.data));
}

/**
 * Katalog dengan filter.
 * @param genres  array slug genre (mis. ["action","comedy"]) — diulang sbg genres_slug
 * @param status  Ongoing | Completed | Hiatus | Dropped
 * @param type    Manga | Manhwa | Manhua
 * @param order   update | popular | az | za | latest (default update)
 * @param project true = hanya project sendiri
 */
export async function filter({
  genres = [],
  status = null,
  type = null,
  order = "update",
  project = false,
  limit = 20,
  after = null,
  before = null,
} = {}) {
  const res = await apiGet("/v1/manga/filter", {
    genres_slug: Array.isArray(genres) ? genres.map((g) => String(g).trim()).filter(Boolean) : [],
    release_status: nz(status),
    type_manga: nz(type),
    is_project: project === true ? "true" : null,
    order_by: nz(order) ?? "update",
    limit,
    after,
    before,
  });
  return listResult("filter", res, cardsOf(res.data));
}

/**
 * Mode teks: SELURUH judul dikelompokkan per abjad, tanpa pagination.
 * Ini satu-satunya cara mengambil katalog penuh dalam satu request.
 */
export async function textMode({ genres = [], status = null, type = null, order = "az" } = {}) {
  const res = await apiGet("/v1/manga/filter/text-mode", {
    genres_slug: Array.isArray(genres) ? genres.map((g) => String(g).trim()).filter(Boolean) : [],
    release_status: nz(status),
    type_manga: nz(type),
    order_by: nz(order) ?? "az",
  });
  const groups = Array.isArray(res.data)
    ? res.data.map((g) => ({
        label: nz(g.label),
        count: Array.isArray(g.items) ? g.items.length : 0,
        items: (Array.isArray(g.items) ? g.items : []).map((it) => ({
          title: nz(it.title),
          slug: nz(it.slug),
          url: it.slug ? seriesPath(it.slug) : null,
        })),
      }))
    : [];
  const total = groups.reduce((a, g) => a + g.count, 0);

  // Katalog situs memuat beberapa entri KEMBAR: slug sama, judul beda tipis
  // (apostrof lurus ' vs ’, tanda hubung - vs :, dsb). Diverifikasi live:
  // 4466 entri → 4456 slug unik (10 kembar). Ini data situsnya, bukan bug parser,
  // jadi entri mentah tetap dikembalikan + daftar duplikatnya dilaporkan.
  const hitung = new Map();
  for (const g of groups) {
    for (const it of g.items) {
      if (!it.slug) continue;
      hitung.set(it.slug, (hitung.get(it.slug) ?? 0) + 1);
    }
  }
  const duplicates = [...hitung.entries()].filter(([, n]) => n > 1).map(([slug]) => slug);

  return {
    source: SOURCE,
    command: "textMode",
    url: res.url,
    ok: true,
    group_count: groups.length,
    total,
    unique_total: hitung.size,
    duplicate_slugs: duplicates,
    data: groups,
  };
}

/**
 * Pencarian judul.
 *
 * Perilaku server (diverifikasi live): query DIPECAH per token dan dicocokkan
 * secara OR, bukan sebagai frasa utuh. Jadi "zzzqqqxxx-judul-tidak-ada-999"
 * tetap balas 100 hasil karena token "judul"/"ada"/"999" cocok ke judul lain.
 * Hasil juga dipatok maksimal 100 item, tanpa cursor.
 * Query kosong balas daftar default (bukan error).
 */
export async function search(q, { genres = "" } = {}) {
  const res = await apiGet("/v1/manga/search", { q: q ?? "", genres });
  const items = cardsOf(res.data);
  return {
    source: SOURCE,
    command: "search",
    url: res.url,
    ok: true,
    query: q ?? "",
    count: items.length,
    limit_capped: items.length >= 100,
    data: items,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/** Detail series + SELURUH daftar chapter (urut terbaru → terlama). */
export async function seriesDetail(slug) {
  if (!nz(slug)) throw new TypeError("slug series wajib diisi");
  const res = await apiGet(`/v1/manga/mangaDetail/${encodeURIComponent(slug)}`);
  const d = res.data || {};
  const chapters = Array.isArray(d.chapters) ? d.chapters.map(normChapter).filter(Boolean) : [];
  const genres = Array.isArray(d.genre)
    ? d.genre.filter(Boolean)
    : typeof d.genre === "string" && d.genre.trim()
      ? d.genre.split(",").map((g) => g.trim()).filter(Boolean)
      : [];
  return {
    source: SOURCE,
    command: "series",
    url: res.url,
    site_url: seriesPath(slug),
    ok: true,
    data: {
      title: nz(d.title),
      slug: nz(d.slug) ?? nz(slug),
      cover: absUrl(d.cover),
      big_cover: absUrl(d.big_cover),
      synopsis: stripHtml(d.sinopsis),
      badge: nz(d.badge),
      rating: nz(d.rating),
      status: nz(d.status),
      published: nz(d.published),
      author: nz(d.author),
      artist: nz(d.artist),
      serialization: nz(d.serialization),
      views: typeof d.views === "number" ? d.views : null,
      genres,
      chapter_count: chapters.length,
      first_chapter: chapters.length ? chapters[chapters.length - 1] : null,
      last_chapter: chapters.length ? chapters[0] : null,
      chapters,
    },
  };
}

/** Series terkait. */
export async function related(slug, { limit = 10 } = {}) {
  if (!nz(slug)) throw new TypeError("slug series wajib diisi");
  const res = await apiGet(`/v1/manga/related/${encodeURIComponent(slug)}`, { limit });
  const items = cardsOf(res.data);
  return { source: SOURCE, command: "related", url: res.url, ok: true, count: items.length, data: items };
}

/**
 * Halaman baca: gambar + navigasi.
 * PENTING: field API `chapters` = daftar GAMBAR (string `<img src>`),
 * sedangkan daftar chapter ada di `otherChapters`.
 */
export async function chapter(slug) {
  if (!nz(slug)) throw new TypeError("slug chapter wajib diisi");
  const res = await apiGet(`/v1/manga/readingPage/${encodeURIComponent(slug)}`);
  const d = res.data || {};
  const images = (Array.isArray(d.chapters) ? d.chapters : []).map(imgSrc).filter(Boolean);
  const all = Array.isArray(d.otherChapters) ? d.otherChapters.map(normChapter).filter(Boolean) : [];
  const seriesSlug = nz(d.slugSeries) ?? nz(d.slugManga);

  const idx = all.findIndex((c) => c.slug === slug);
  const newer = idx > 0 ? all[idx - 1] : null;
  const older = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;

  return {
    source: SOURCE,
    command: "chapter",
    url: res.url,
    site_url: chapterPath(slug),
    ok: true,
    data: {
      slug,
      title: nz(d.title),
      chapter_title: nz(d.chapterTitle),
      chapter: nz(d.chapterNum),
      series_slug: seriesSlug,
      series_url: seriesSlug ? seriesPath(seriesSlug) : null,
      time: nz(d.time),
      cover: absUrl(d.cover),
      redirect_link: nz(d.redirect_link),
      background_music_url: absUrl(d.background_music_url),
      image_count: images.length,
      images,
      nav: { index: idx, prev: older, next: newer },
      chapter_list_count: all.length,
      chapter_list: all,
    },
  };
}

/** Hanya URL gambar sebuah chapter. */
export async function chapterImages(slug) {
  const c = await chapter(slug);
  return {
    source: SOURCE,
    command: "images",
    url: c.url,
    ok: true,
    count: c.data.image_count,
    data: c.data.images,
  };
}

// ---------------------------------------------------------------------------
// Ekstra
// ---------------------------------------------------------------------------

/** Pengaturan situs publik (nama, menu, homepage) dari panel admin. */
export async function settings(kind = "general") {
  const allowed = ["general", "homepage", "menu", "ads"];
  if (!allowed.includes(kind)) {
    throw new TypeError(`kind harus salah satu dari: ${allowed.join(", ")}`);
  }
  const res = await apiGet(`/api/public/settings/${kind}`, {}, { base: ADMIN_BASE });
  return { source: SOURCE, command: "settings", kind, url: res.url, ok: true, data: res.data };
}

/** Pengumuman situs. */
export async function announcements({ limit = 20, offset = 0 } = {}) {
  const res = await apiGet("/v1/announcement", { limit, offset });
  const d = res.data || {};
  return {
    source: SOURCE,
    command: "announcements",
    url: res.url,
    ok: true,
    count: Array.isArray(d.items) ? d.items.length : 0,
    pagination: d.pagination ?? null,
    data: Array.isArray(d.items) ? d.items : [],
  };
}

/**
 * Susuri katalog memakai cursor sampai `pages` halaman.
 * Dipakai buat ambil banyak item tanpa mikir cursor manual.
 */
export async function walk({ pages = 2, limit = 20, kind = "filter", ...opts } = {}) {
  const fns = { filter, allComics, latest, projectAll, popularToday };
  const fn = fns[kind];
  if (!fn) throw new TypeError(`kind harus salah satu dari: ${Object.keys(fns).join(", ")}`);

  const items = [];
  const seen = new Set();
  let cursor = null;
  let visited = 0;

  for (let i = 0; i < pages; i++) {
    const page = await fn({ ...opts, limit, after: cursor });
    visited++;
    for (const it of page.data) {
      if (it.slug && seen.has(it.slug)) continue;
      if (it.slug) seen.add(it.slug);
      items.push(it);
    }
    if (!page.pagination.has_next || !page.pagination.next_cursor) break;
    cursor = page.pagination.next_cursor;
  }

  return {
    source: SOURCE,
    command: "walk",
    ok: true,
    kind,
    pages_visited: visited,
    count: items.length,
    data: items,
  };
}

export {
  API_BASE,
  ADMIN_BASE,
  SITE,
  UA,
  HttpError,
  ApiError,
  clearCache,
  fetchRaw,
  apiGet,
  buildUrl,
  seriesPath,
  chapterPath,
  normCard,
  normChapter,
  stripHtml,
  imgSrc,
  nz,
  absUrl,
};
