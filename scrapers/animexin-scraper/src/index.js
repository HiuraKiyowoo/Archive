// animexin-scraper — API publik.
//
// Situs: https://animexin.dev/ (donghua / anime China, sub Indonesia+English).
// Transport: HTTP murni (fetch bawaan Node >= 18), tanpa dependency & tanpa browser.
//
// PENTING (hasil recon live 2026-08-31):
//  - Semua path yang diawali /anime/ dijaga Cloudflare dan SELALU balas
//    403 "Just a moment" — termasuk arsip /anime/ dan /anime/{slug}/.
//    Karena itu listing series memakai /?post_type=anime dan halaman series
//    memakai URL tanpa prefix: /{slug}/.
//  - Situs tidak punya REST API yang bisa dipakai: /wp-json/ balas 401
//    (`rest_login_required`). Jadi semua data diambil dari HTML SSR.
import { fetchText, BASE, UA, HttpError, BlockedError, clearCache } from './http.js';
import { parseCards, parseSeasonCards, parseSchedule } from './cards.js';
import { parseSeries, parseEpisode } from './detail.js';
import { text, slugOf } from './html.js';

export { BASE, UA, HttpError, BlockedError, clearCache, fetchText };
export { parseCards, parseSeasonCards, parseSchedule, parseSeries, parseEpisode };
export { text, decodeEntities, slugOf, episodeNumberFromSlug } from './html.js';

/** Envelope hasil yang konsisten. */
function envelope(command, url, data, extra = {}) {
  return { source: 'animexin.dev', command, url, ok: true, ...extra, data };
}

/**
 * Halaman depan: rilis episode terbaru + berbagai section.
 * @returns {Promise<object>} envelope, `data` = array kartu episode/series.
 */
export async function home() {
  const url = `${BASE}/`;
  const html = await fetchText(url);
  const cards = parseCards(html);
  return envelope('home', url, cards, {
    count: cards.length,
    episodes: cards.filter((c) => c.kind === 'episode').length,
    series: cards.filter((c) => c.kind === 'series').length,
  });
}

/**
 * Daftar semua series (arsip custom post type `anime`).
 * @param {number} [page=1] Halaman, 1-based. Situs memakai `&page=N`.
 * @param {{order?: string, genre?: string|string[], status?: string,
 *          type?: string}} [opt] Filter opsional.
 *   order: title | titlereverse | update | latest | popular | rating | oldest
 */
export async function series(page = 1, opt = {}) {
  const q = new URLSearchParams({ post_type: 'anime' });
  if (page > 1) q.set('page', String(page));
  if (opt.order) q.set('order', opt.order);
  if (opt.status) q.append('status[]', opt.status);
  if (opt.type) q.set('type', opt.type);
  if (opt.genre) {
    for (const g of [].concat(opt.genre)) q.append('genre[]', g);
  }
  const url = `${BASE}/?${q}`;
  const html = await fetchText(url);
  const cards = parseCards(html);
  return envelope('series', url, cards, {
    page,
    count: cards.length,
    has_next: cards.length > 0,
    filters: {
      order: opt.order || null,
      genre: opt.genre ? [].concat(opt.genre) : [],
      status: opt.status || null,
      type: opt.type || null,
    },
  });
}

/**
 * Pencarian judul.
 * @param {string} query Kata kunci.
 * @param {number} [page=1]
 */
export async function search(query, page = 1) {
  const q = new URLSearchParams({ s: String(query ?? '') });
  if (page > 1) q.set('page', String(page));
  const url = `${BASE}/?${q}`;
  const html = await fetchText(url);
  const cards = parseCards(html);
  return envelope('search', url, cards, {
    query: String(query ?? ''),
    page,
    count: cards.length,
  });
}

/**
 * Detail satu series + daftar episodenya.
 * @param {string} slugOrUrl Slug (`renegade-immortal`) atau URL penuh.
 *   Prefix `/anime/` otomatis dibuang karena diblokir Cloudflare.
 */
export async function seriesDetail(slugOrUrl) {
  const url = toSeriesUrl(slugOrUrl);
  const html = await fetchText(url);
  const data = parseSeries(html, url);
  return envelope('series-detail', url, data, {
    chapter_count: data.chapter_count,
  });
}

/**
 * Detail satu episode: mirror stream, tautan unduhan, navigasi.
 * @param {string} slugOrUrl Slug episode atau URL penuh.
 */
export async function episode(slugOrUrl) {
  const url = toEpisodeUrl(slugOrUrl);
  const html = await fetchText(url);
  const data = parseEpisode(html, url);
  return envelope('episode', url, data, {
    mirror_count: data.mirror_count,
    download_count: data.download_count,
  });
}

/**
 * Daftar genre lengkap.
 *
 * Halaman /genres/ hanya menampilkan genre yang dipakai series di halaman itu
 * (12 unik saja). Sumber yang lengkap adalah `genres-sitemap.xml` → 41 genre.
 */
export async function genres() {
  return taxonomyList('genres');
}

/**
 * Daftar entri sebuah taxonomy dari sitemap-nya (sumber terlengkap).
 * @param {'genres'|'studio'|'season'|'network'|'country'|'label'|'cast'|'director'} tax
 */
export async function taxonomyList(tax) {
  const url = `${BASE}/${tax}-sitemap.xml`;
  const xml = await fetchText(url);
  const seen = new Map();
  const re = new RegExp(
    `<loc>https?://animexin\\.dev/${tax}/([^/<]+)/</loc>(?:\\s*<lastmod>([^<]+)</lastmod>)?`,
    'gi'
  );
  for (const m of xml.matchAll(re)) {
    const slug = m[1];
    if (!seen.has(slug)) {
      seen.set(slug, {
        name: slug
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' '),
        slug,
        url: `${BASE}/${tax}/${slug}/`,
        lastmod: m[2] || null,
      });
    }
  }
  const data = [...seen.values()];
  return envelope('taxonomy-list', url, data, { taxonomy: tax, count: data.length });
}

/**
 * Listing berdasarkan taxonomy.
 * @param {'genres'|'studio'|'country'|'network'|'season'|'label'} tax
 * @param {string} slug
 * @param {number} [page=1]
 *
 * Catatan: taxonomy `season` memakai markup kartu berbeda (.listseries .card)
 * dan mengembalikan field tambahan (episode_total, alternative_title, synopsis).
 */
export async function taxonomy(tax, slug, page = 1) {
  const allowed = ['genres', 'studio', 'country', 'network', 'season', 'label'];
  if (!allowed.includes(tax)) {
    throw new Error(`taxonomy tidak dikenal: ${tax} (pilih: ${allowed.join(', ')})`);
  }
  const url =
    page > 1
      ? `${BASE}/${tax}/${slug}/page/${page}/`
      : `${BASE}/${tax}/${slug}/`;
  const html = await fetchText(url, { allow404: true });
  if (html === null) {
    return envelope('taxonomy', url, [], {
      taxonomy: tax,
      slug,
      page,
      count: 0,
      not_found: true,
    });
  }
  const data = tax === 'season' ? parseSeasonCards(html) : parseCards(html);
  return envelope('taxonomy', url, data, {
    taxonomy: tax,
    slug,
    page,
    count: data.length,
  });
}

/**
 * Jadwal rilis mingguan (/schedule/), dikelompokkan per hari.
 */
export async function schedule() {
  const url = `${BASE}/schedule/`;
  const html = await fetchText(url);
  const days = parseSchedule(html);
  return envelope('schedule', url, days, {
    days: days.length,
    total_series: days.reduce((n, d) => n + d.count, 0),
  });
}

/**
 * Daftar URL series dari sitemap (`anime-sitemap.xml`) — cara termurah
 * untuk mendapat katalog lengkap tanpa memutar paginasi.
 */
export async function sitemap() {
  const url = `${BASE}/anime-sitemap.xml`;
  const xml = await fetchText(url);
  const data = [];
  for (const m of xml.matchAll(
    /<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/gi
  )) {
    const loc = m[1];
    // buang URL arsip itu sendiri (https://animexin.dev/anime/) — bukan series
    if (/\/anime\/?$/.test(loc)) continue;
    data.push({ url: loc, slug: slugOf(loc), lastmod: m[2] || null });
  }
  return envelope('sitemap', url, data, { count: data.length });
}

/**
 * Iterasi paginasi sampai habis (default aman: maxPages 20).
 * @param {(page:number)=>Promise<object>} fn Fungsi yang menerima nomor halaman.
 * @param {{maxPages?: number}} [opt]
 */
export async function walk(fn, opt = {}) {
  const maxPages = opt.maxPages ?? 20;
  const items = [];
  const seen = new Set();
  let pages = 0;
  let stopped_at = '';
  for (let p = 1; p <= maxPages; p++) {
    const res = await fn(p);
    pages = p;
    const batch = res.data || [];
    if (batch.length === 0) {
      stopped_at = `halaman ${p} kosong`;
      break;
    }
    let baru = 0;
    for (const it of batch) {
      const key = it.url || it.slug;
      if (key && !seen.has(key)) {
        seen.add(key);
        items.push(it);
        baru++;
      }
    }
    if (baru === 0) {
      stopped_at = `halaman ${p} duplikat penuh`;
      break;
    }
    if (p === maxPages) stopped_at = `batas maxPages (${maxPages})`;
  }
  return { count: items.length, pages, stopped_at, data: items };
}

// ---- util URL --------------------------------------------------------------

/** Ubah slug/URL apa pun menjadi URL series yang valid (tanpa /anime/). */
export function toSeriesUrl(slugOrUrl) {
  const s = String(slugOrUrl || '').trim();
  if (!s) throw new Error('slug series kosong');
  if (s.startsWith('http')) return s.replace('/anime/', '/');
  return `${BASE}/${s.replace(/^\/+|\/+$/g, '').replace(/^anime\//, '')}/`;
}

/** Ubah slug/URL menjadi URL post episode. */
export function toEpisodeUrl(slugOrUrl) {
  const s = String(slugOrUrl || '').trim();
  if (!s) throw new Error('slug episode kosong');
  if (s.startsWith('http')) return s;
  return `${BASE}/${s.replace(/^\/+|\/+$/g, '')}/`;
}
