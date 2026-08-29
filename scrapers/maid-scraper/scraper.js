import axios from 'axios';
import * as cheerio from 'cheerio';

// maid.my.id (WordPress + LiteSpeed, BUKAN Cloudflare).
// Catatan penting (diverifikasi 2026-08-29):
//  - Domain non-www (maid.my.id) di-redirect 301 ke www.maid.my.id.
//  - Server MEMBLOKIR User-Agent Chrome 126 dengan 403, tapi menerima UA
//    Safari. Jadi scraper WAJIB pakai UA Safari (lihat UA di bawah).
//  - Model data WordPress: Category = series manga, Post = chapter.
//  - Gambar chapter ada di CDN cdn.imgchest.com, di-load lazy (data-lazy-src).
const BASE = 'https://www.maid.my.id';
const API = `${BASE}/wp-json/wp/v2`;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

const client = axios.create({
  baseURL: BASE,
  timeout: 30000,
  maxRedirects: 5,
  headers: {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en;q=0.5',
  },
});

const cache = new Map();
const TTL = 10 * 60 * 1000;

async function httpGet(url, { json = false, cacheKey = null } = {}) {
  const key = cacheKey || url;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const res = await client.get(url, {
    responseType: json ? 'json' : 'text',
    transitional: json ? undefined : { silentJSONParsing: true },
  });
  const data = json ? res.data : String(res.data);
  cache.set(key, { at: Date.now(), data });
  return data;
}

function decodeEntities(s) {
  if (s == null) return s;
  return cheerio.load(`<span>${s}</span>`)('span').text().trim();
}

function toAbs(url) {
  if (!url) return null;
  return url.startsWith('http') ? url : BASE + url;
}

// Ambil URL gambar asli dari elemen img yang pakai lazy-load.
function imgSrc($, el) {
  const e = $(el);
  return (
    e.attr('data-lazy-src') ||
    e.attr('data-src') ||
    e.attr('data-bg') ||
    e.attr('src') ||
    null
  );
}

// Ekstrak slug series dari URL /manga/{slug}/
function seriesSlugFromUrl(url) {
  const m = String(url || '').match(/maid\.my\.id\/manga\/([^/?#]+)/);
  return m ? m[1] : null;
}

// Ekstrak slug chapter dari URL (segmen terakhir sebelum /)
function chapterSlugFromUrl(url) {
  const s = String(url || '').replace(/\/+$/, '');
  const m = s.match(/maid\.my\.id\/([^/?#]+)$/);
  return m ? m[1] : null;
}

// ---- homepage: manga + chapter terbaru ----

export async function home() {
  const html = await httpGet('/', { cacheKey: 'home' });
  const $ = cheerio.load(html);

  const items = [];
  const seen = new Set();
  $('.flexbox3-item').each((_, el) => {
    const titleA = $(el).find('.title a').first();
    const url = titleA.attr('href');
    if (!url || seen.has(url)) return;
    seen.add(url);
    const poster = imgSrc($, $(el).find('img').first());
    const chapters = [];
    $(el).find('ul.chapter li').each((__, li) => {
      const a = $(li).find('a').first();
      const href = a.attr('href');
      if (!href) return;
      chapters.push({
        label: a.text().trim() || null,
        url: toAbs(href),
        date: $(li).find('.date').first().text().trim() || null,
      });
    });
    items.push({
      title: decodeEntities(titleA.text() || titleA.attr('title') || null),
      url: toAbs(url),
      poster,
      chapters,
    });
  });

  return { total_items: items.length, items };
}

// ---- daftar semua manga (/manga/, ber-pagination) ----

export async function mangaList(options = {}) {
  const maxPages = options.maxPages ?? 60;
  const seen = new Set();
  const items = [];

  let page = 1;
  while (page <= maxPages) {
    const path = page === 1 ? '/manga/' : `/manga/page/${page}/`;
    const html = await httpGet(path, { cacheKey: `list:${page}` });
    const $ = cheerio.load(html);

    let found = 0;
    $('.flexbox2-item').each((_, el) => {
      const a = $(el).find('a[href*="/manga/"]').first();
      const href = a.attr('href');
      const slug = href ? seriesSlugFromUrl(href) : null;
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      found++;
      items.push({
        slug,
        title: decodeEntities(a.attr('title') || a.text().trim() || slug),
        url: toAbs(href),
        poster: imgSrc($, $(el).find('img').first()),
      });
    });

    let lastPage = page;
    $('a.page-numbers[href]').each((_, el) => {
      const m = ($(el).attr('href') || '').match(/\/page\/(\d+)\//);
      if (m) lastPage = Math.max(lastPage, Number(m[1]));
    });

    if (found === 0 || page >= lastPage) break;
    page++;
  }

  return { total_items: items.length, items };
}

// ---- detail series: metadata + daftar chapter ----

export async function series(slugOrUrl) {
  const slug = slugOrUrl.includes('/')
    ? seriesSlugFromUrl(slugOrUrl)
    : String(slugOrUrl).replace(/^\/+|\/+$/g, '');
  if (!slug) throw new Error('series: slug wajib diisi');
  const html = await httpGet(`/manga/${encodeURIComponent(slug)}/`, {
    cacheKey: `series:${slug}`,
  });
  const $ = cheerio.load(html);

  const title =
    decodeEntities($('.series-title').first().text() || $('h1').first().text() || slug);
  const poster =
    $('.series-cover [data-bg]').first().attr('data-bg') ||
    imgSrc($, $('.series-cover img').first()) ||
    imgSrc($, $('img.wp-post-image').first()) ||
    null;

  const score =
    $('.series-infoz.score span[itemprop="ratingValue"]').first().text().trim() ||
    $('.series-infoz.score').first().text().replace(/[^\d.]/g, '').trim() ||
    null;

  // info list: Published / Author / Total Chapter (label di <b> atau teks pertama)
  const info = {};
  $('.series-infolist li').each((_, li) => {
    const b = $(li).find('b, strong').first();
    const label = (b.text() || $(li).text().split(/\s+/)[0] || '').replace(/:\s*$/, '').trim();
    const clone = $(li).clone();
    clone.find('b, strong').remove();
    const val = clone.text().replace(/\s+/g, ' ').trim();
    if (label) info[label.toLowerCase()] = val || null;
  });

  const genres = [];
  const seenGenres = new Set();
  $('.series-genres a').each((_, el) => {
    const name = $(el).text().trim();
    if (!name || seenGenres.has(name)) return;
    seenGenres.add(name);
    genres.push({ name, url: toAbs($(el).attr('href')) });
  });

  const chapters = [];
  const seenChap = new Set();
  $('.series-chapterlist .flexch-infoz a, .series-chapterlist a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || seenChap.has(href)) return;
    seenChap.add(href);
    const date = $(el).find('.date').first().text().trim() || null;
    const clone = $(el).clone();
    clone.find('.date').remove();
    const label = clone.text().replace(/\s+/g, ' ').trim() || null;
    chapters.push({
      label,
      url: toAbs(href),
      date,
    });
  });

  return {
    slug,
    url: `${BASE}/manga/${slug}/`,
    title,
    poster,
    score: score || null,
    author: info['author'] || null,
    published: info['published'] || null,
    total_chapter: info['total chapter'] || null,
    genres,
    chapter_count: chapters.length,
    chapters,
  };
}

// ---- detail chapter: daftar gambar ----

export async function chapter(url) {
  if (!url) throw new Error('chapter: URL wajib diisi');
  const abs = toAbs(url);
  const html = await httpGet(abs, { cacheKey: `chap:${abs}` });
  const $ = cheerio.load(html);

  let title = decodeEntities(
    $('h1.entry-title').first().text() || $('h1').first().text() || $('title').first().text()
  );
  // Buang suffix nama situs dari <title> (mis. " - Maid - Manga Indonesia").
  title = title ? title.replace(/\s*-\s*Maid\s*-\s*Manga Indonesia.*$/i, '').trim() : title;

  const images = [];
  const seen = new Set();
  // Gambar chapter ada di .reader-area, di-load lazy via data-lazy-src.
  $('.reader-area img').each((_, el) => {
    const src = $(el).attr('data-lazy-src') || $(el).attr('data-src') || $(el).attr('src');
    if (!src || src.startsWith('data:') || seen.has(src)) return;
    seen.add(src);
    images.push({ url: src, alt: $(el).attr('alt') || null });
  });

  // Fallback: kalau .reader-area kosong, ambil semua img cdn.imgchest.com.
  if (images.length === 0) {
    $('img').each((_, el) => {
      const src = $(el).attr('data-lazy-src') || $(el).attr('src');
      if (src && /cdn\.imgchest\.com/i.test(src) && !seen.has(src)) {
        seen.add(src);
        images.push({ url: src, alt: $(el).attr('alt') || null });
      }
    });
  }

  return {
    url: abs,
    title,
    image_count: images.length,
    images,
  };
}

// ---- pencarian manga ----

export async function search(query, options = {}) {
  if (!query) throw new Error('search: query wajib diisi');
  const maxPages = options.maxPages ?? 10;
  const seen = new Set();
  const items = [];

  let page = 1;
  while (page <= maxPages) {
    const path = `/?s=${encodeURIComponent(query)}${page === 1 ? '' : `&paged=${page}`}`;
    const html = await httpGet(path, { cacheKey: `search:${query}:${page}` });
    const $ = cheerio.load(html);

    let found = 0;
    $('a[href*="/manga/"]').each((_, el) => {
      const href = $(el).attr('href');
      const slug = href ? seriesSlugFromUrl(href) : null;
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      found++;
      const img = $(el).find('img').first();
      const poster = img.length ? imgSrc($, img) : null;
      items.push({
        slug,
        title: decodeEntities($(el).attr('title') || $(el).text().trim() || slug),
        url: toAbs(href),
        poster,
      });
    });

    const next = $('a.next.page-numbers, a.page-numbers.next').attr('href');
    if (found === 0 || !next) break;
    page++;
  }

  return { query, total_items: items.length, items };
}

// ---- daftar manga berdasarkan genre ----

export async function genre(slugOrUrl, options = {}) {
  const slug = slugOrUrl.includes('/')
    ? (String(slugOrUrl).match(/genres\/([^/]+)/) || [])[1]
    : String(slugOrUrl).replace(/^\/+|\/+$/g, '');
  if (!slug) throw new Error('genre: slug wajib diisi');
  const maxPages = options.maxPages ?? 50;
  const seen = new Set();
  const items = [];

  let page = 1;
  while (page <= maxPages) {
    const path =
      page === 1
        ? `/genres/${encodeURIComponent(slug)}/`
        : `/genres/${encodeURIComponent(slug)}/page/${page}/`;
    const html = await httpGet(path, { cacheKey: `genre:${slug}:${page}` });
    const $ = cheerio.load(html);

    let found = 0;
    $('.flexbox2-item').each((_, el) => {
      const a = $(el).find('a[href*="/manga/"]').first();
      const href = a.attr('href');
      const slug2 = href ? seriesSlugFromUrl(href) : null;
      if (!slug2 || seen.has(slug2)) return;
      seen.add(slug2);
      found++;
      items.push({
        slug: slug2,
        title: decodeEntities(a.attr('title') || a.text().trim() || slug2),
        url: toAbs(href),
        poster: imgSrc($, $(el).find('img').first()),
      });
    });

    let lastPage = page;
    $('a.page-numbers[href]').each((_, el) => {
      const m = ($(el).attr('href') || '').match(/\/page\/(\d+)\//);
      if (m) lastPage = Math.max(lastPage, Number(m[1]));
    });

    if (found === 0 || page >= lastPage) break;
    page++;
  }

  return { slug, total_items: items.length, items };
}

// ---- metadata chapter via REST (id, tanggal, kategori) ----

export async function post(url) {
  if (!url) throw new Error('post: URL wajib diisi');
  const slug = chapterSlugFromUrl(url);
  if (!slug) throw new Error(`post: tidak bisa mengekstrak slug dari ${url}`);
  const list = await httpGet(`${API}/posts?slug=${encodeURIComponent(slug)}&per_page=1`, {
    json: true,
    cacheKey: `slug:${slug}`,
  });
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`post: tidak ditemukan untuk slug "${slug}"`);
  }
  const p = list[0];
  return {
    id: p.id,
    title: decodeEntities(p.title?.rendered || null),
    url: p.link,
    slug: p.slug,
    date: p.date,
    modified: p.modified,
    categories: p.categories || [],
  };
}

// ---- CLI ----

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'list';
  try {
    let result;
    switch (cmd) {
      case 'home':
        result = await home();
        break;
      case 'list':
      case 'manga-list':
        result = await mangaList();
        break;
      case 'series':
        result = await series(args[1] || '');
        break;
      case 'chapter':
      case 'episode':
        result = await chapter(args[1] || '');
        break;
      case 'post':
        result = await post(args[1] || '');
        break;
      case 'search':
        result = await search(args[1] || '');
        break;
      case 'genre':
        result = await genre(args[1] || '');
        break;
      default:
        console.error(`Perintah tidak dikenal: ${cmd}`);
        console.error(
          'Gunakan: home | list | series "slug" | chapter "URL" | post "URL" | search "kata" | genre "slug"'
        );
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
