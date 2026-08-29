import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE = 'https://donghuastream.org';
const API = `${BASE}/wp-json/wp/v2`;
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const client = axios.create({
  baseURL: BASE,
  timeout: 30000,
  maxRedirects: 5,
  headers: {
    'User-Agent': UA,
    Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
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

function cleanText(html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  const t = $('body').text().replace(/\s+/g, ' ').trim();
  return t || null;
}

function toAbs(url) {
  if (!url) return null;
  return url.startsWith('http') ? url : BASE + url;
}

function slugFromUrl(url) {
  const s = String(url || '');
  let m = s.match(/donghuastream\.org\/anime\/([^/?#]+)/);
  if (m) return m[1];
  m = s.match(/donghuastream\.org\/([^/?#]+)/);
  return m ? m[1] : null;
}

// ---- homepage (episode terbaru + featured) ----

export async function home() {
  const html = await httpGet('/', { cacheKey: 'home' });
  const $ = cheerio.load(html);

  // episode terbaru (grid .bsx)
  const recent = [];
  const seenRecent = new Set();
  $('.bsx').each((_, el) => {
    const a = $(el).find('a').first();
    const href = a.attr('href');
    if (!href || seenRecent.has(href)) return;
    seenRecent.add(href);
    const img = $(el).find('img').first();
    recent.push({
      title: decodeEntities(a.attr('title') || $(el).find('.tt h2').first().text() || null),
      url: href,
      type: $(el).find('.typez').first().text().trim() || null,
      episode_label: $(el).find('.epx').first().text().trim() || null,
      poster: img.attr('data-src') || img.attr('src') || null,
    });
  });

  // featured (slider .slide-item)
  const featured = [];
  $('.slide-item').each((_, el) => {
    const a = $(el).find('a').first();
    const href = a.attr('href');
    const img = $(el).find('img').first();
    featured.push({
      title: decodeEntities($(el).find('.title h2, .title h3, .title').first().text() || img.attr('alt') || null),
      url: href || null,
      poster: img.attr('data-src') || img.attr('src') || null,
      rating: $(el).find('.rating').first().text().trim() || null,
    });
  });

  return {
    recent_count: recent.length,
    recent,
    featured_count: featured.length,
    featured,
  };
}

// ---- daftar anime (az-lists) ----

export async function animeList(options = {}) {
  const maxPages = options.maxPages ?? 50;
  const seen = new Set();
  const items = [];

  let page = 1;
  while (page <= maxPages) {
    const path = page === 1 ? '/az-lists/' : `/az-lists/pagg/${page}/`;
    const html = await httpGet(path, { cacheKey: `az:${page}` });
    const $ = cheerio.load(html);

    let found = 0;
    $('a[href*="/anime/"]').each((_, el) => {
      const href = $(el).attr('href');
      const slug = (href.match(/\/anime\/([^/]+)\//) || [])[1];
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      found++;
      items.push({
        slug,
        url: href,
        title: decodeEntities($(el).text().trim() || slug),
      });
    });

    // cari halaman terakhir dari link pagination
    let lastPage = page;
    $('a.page-numbers[href*="/pagg/"]').each((_, el) => {
      const m = ($(el).attr('href') || '').match(/\/pagg\/(\d+)\//);
      if (m) lastPage = Math.max(lastPage, Number(m[1]));
    });

    if (page >= lastPage) break;
    page++;
  }

  return { total_items: items.length, items };
}

// ---- helper: ambil nilai dari span ber-label <b>Label:</b> di .spe ----

function speSpan($, label) {
  const want = label.toLowerCase().replace(/:\s*$/, '');
  let val = null;
  $('.spe span').each((_, el) => {
    const b = $(el).find('b').first();
    if (b.length) {
      const key = b.text().trim().toLowerCase().replace(/:\s*$/, '');
      if (key === want) {
        const clone = $(el).clone();
        clone.find('b').remove();
        val = clone.text().replace(/\s+/g, ' ').trim();
        return false;
      }
    }
  });
  return val || null;
}

// ---- daftar episode satu series ----

export async function series(slugOrUrl) {
  const slug = slugOrUrl.includes('/') ? slugFromUrl(slugOrUrl) : String(slugOrUrl).replace(/^\/+|\/+$/g, '');
  if (!slug) throw new Error('series: slug wajib diisi');
  const html = await httpGet(`/anime/${encodeURIComponent(slug)}/`, { cacheKey: `series:${slug}` });
  const $ = cheerio.load(html);

  const title = decodeEntities($('h1.entry-title').first().text() || $('h1').first().text() || slug);
  const poster =
    $('img.wp-post-image').first().attr('data-src') ||
    $('img.wp-post-image').first().attr('src') ||
    $('.thumb img').first().attr('src') ||
    null;

  const ratingMeta = $('.rating meta[itemprop="ratingValue"]').attr('content');
  const ratingText = $('.rating strong').first().text().replace(/[^0-9.]/g, '').trim();

  const genres = [];
  const seenGenres = new Set();
  $('a[href*="/genres/"]').each((_, el) => {
    if ($(el).closest('.widget, aside, #sidebar').length) return;
    const name = $(el).text().trim();
    if (!name || seenGenres.has(name)) return;
    seenGenres.add(name);
    genres.push({ name, url: $(el).attr('href') || null });
  });

  const networks = [];
  $('.spe a[href*="/network/"]').each((_, el) => {
    const name = $(el).text().trim();
    if (name) networks.push({ name, url: $(el).attr('href') || null });
  });

  const episodes = [];
  $('.eplister li').each((_, li) => {
    const a = $(li).find('a').first();
    const href = a.attr('href');
    if (!href) return;
    const num = $(li).find('.epl-num').first().text().trim() || null;
    const etitle = $(li).find('.epl-title').first().text().trim() || null;
    const date = $(li).find('.epl-date').first().text().trim() || null;
    episodes.push({
      episode: parseEpNumber(num || etitle),
      label: num,
      title: etitle,
      url: toAbs(href),
      date,
    });
  });

  return {
    slug,
    url: `${BASE}/anime/${slug}/`,
    title,
    poster,
    status: $('.status').first().text().trim() || null,
    type: speSpan($, 'Type'),
    duration: speSpan($, 'Duration'),
    released: speSpan($, 'Released'),
    fansub: speSpan($, 'Fansub'),
    rating: ratingMeta || ratingText || null,
    genres,
    networks,
    episode_count: episodes.length,
    episodes,
  };
}

// ---- jadwal tayang harian ----

export async function schedule() {
  const html = await httpGet('/schedule/', { cacheKey: 'schedule' });
  const $ = cheerio.load(html);
  const days = [];

  // Catatan jujur (diverifikasi 2026-08-29): blok harian Saturday–Friday kosong
  // di SISI SERVER — bukan sekadar di-load lewat AJAX. Tidak ada XHR/fetch ke
  // API jadwal, tidak ada JSON ter-embed, dan tidak ada script yang mengisi
  // blok harian. Satu-satunya data yang tersedia via HTTP adalah blok
  // "Random Update" (75 item .bsx statis). Blok harian tetap dikembalikan
  // sebagai objek kosong agar struktur output-nya transparan, bukan pura-pura
  // ada datanya.
  $('.bixbox').each((_, box) => {
    const h = $(box).find('h3').first().text().trim();
    if (!h) return; // blok header tanpa h3 diabaikan
    const day = h.toLowerCase();
    const items = [];
    $(box).find('.bsx').each((_, el) => {
      const a = $(el).find('a[href*="/anime/"]').first();
      const href = a.attr('href');
      if (!href) return;
      const img = $(el).find('img').first();
      items.push({
        title: decodeEntities(a.attr('title') || $(el).find('.tt h2, h2').first().text().trim() || null),
        url: href,
        episode_label: $(el).find('.epx').first().text().trim() || null,
        poster: img.attr('data-src') || img.attr('src') || null,
      });
    });
    days.push({ day, label: h, items });
  });

  return { total_days: days.length, days };
}

// ---- daftar anime berdasarkan tahun ----

export async function season(year, options = {}) {
  const y = String(year).trim();
  if (!/^\d{4}$/.test(y)) throw new Error('season: tahun wajib 4 digit (mis. 2026)');
  const maxPages = options.maxPages ?? 50;
  const seen = new Set();
  const items = [];

  let page = 1;
  while (page <= maxPages) {
    const path = page === 1
      ? `/season/${y}/`
      : `/season/${y}/pagg/${page}/`;
    const html = await httpGet(path, { cacheKey: `season:${y}:${page}` });
    const $ = cheerio.load(html);

    let found = 0;
    $('.card-box').each((_, el) => {
      const a = $(el).find('a[href*="/anime/"]').first();
      const href = a.attr('href');
      if (!href || seen.has(href)) return;
      seen.add(href);
      found++;
      const img = $(el).find('img').first();
      items.push({
        title: decodeEntities(a.attr('title') || $(el).find('.card-title, h2').first().text().trim() || null),
        url: href,
        poster: img.attr('data-src') || img.attr('src') || null,
      });
    });

    let lastPage = page;
    $('a.page-numbers[href]').each((_, el) => {
      const m = ($(el).attr('href') || '').match(/\/pagg\/(\d+)\//);
      if (m) lastPage = Math.max(lastPage, Number(m[1]));
    });

    if (found === 0 || page >= lastPage) break;
    page++;
  }

  return { year: y, total_items: items.length, items };
}

// ---- anime acak (resolve redirect /random) ----

export async function random() {
  const res = await client.get('/random', { maxRedirects: 0, validateStatus: (s) => s >= 200 && s < 400 });
  const loc = res.headers['location'];
  const finalUrl = loc ? toAbs(loc) : null;
  const slug = finalUrl ? slugFromUrl(finalUrl) : null;
  return { url: finalUrl, slug };
}

// ---- pencarian anime ----

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
    $('article.bs .bsx').each((_, el) => {
      const a = $(el).find('a[href*="/anime/"]').first();
      const href = a.attr('href');
      if (!href || seen.has(href)) return;
      seen.add(href);
      found++;
      const img = $(el).find('img').first();
      items.push({
        title: decodeEntities(a.attr('title') || $(el).find('h2').first().text().trim() || null),
        url: href,
        poster: img.attr('data-src') || img.attr('src') || null,
      });
    });

    const next = $('a.next.page-numbers, a.page-numbers.next').attr('href');
    if (found === 0 || !next) break;
    page++;
  }

  return { query, total_items: items.length, items };
}

// ---- daftar anime berdasarkan genre ----

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
    const path = page === 1
      ? `/genres/${encodeURIComponent(slug)}/`
      : `/genres/${encodeURIComponent(slug)}/pagg/${page}/`;
    const html = await httpGet(path, { cacheKey: `genre:${slug}:${page}` });
    const $ = cheerio.load(html);

    let found = 0;
    $('article.bs .bsx').each((_, el) => {
      const a = $(el).find('a[href*="/anime/"]').first();
      const href = a.attr('href');
      if (!href || seen.has(href)) return;
      seen.add(href);
      found++;
      const img = $(el).find('img').first();
      items.push({
        title: decodeEntities(a.attr('title') || $(el).find('h2').first().text().trim() || null),
        url: href,
        poster: img.attr('data-src') || img.attr('src') || null,
      });
    });

    let lastPage = page;
    $('a.page-numbers[href]').each((_, el) => {
      const m = ($(el).attr('href') || '').match(/\/pagg\/(\d+)\//);
      if (m) lastPage = Math.max(lastPage, Number(m[1]));
    });

    if (found === 0 || page >= lastPage) break;
    page++;
  }

  return { slug, total_items: items.length, items };
}

function parseEpNumber(text) {
  const t = String(text || '');
  let m = t.match(/(?:^|\s)Ep(?:isode)?\s*(\d+)/i);
  if (!m) m = t.match(/^(\d+)\s*\(/);
  return m ? Number(m[1]) : null;
}

// ---- detail episode: streaming + download ----

export async function episode(url) {
  if (!url) throw new Error('episode: URL wajib diisi');
  const abs = toAbs(url);
  const html = await httpGet(abs, { cacheKey: `ep:${abs}` });
  const $ = cheerio.load(html);

  const title = decodeEntities($('h1.entry-title').first().text() || $('title').first().text());
  const poster =
    $('img.wp-post-image').first().attr('data-src') ||
    $('img.wp-post-image').first().attr('src') ||
    null;

  const streams = [];
  $('iframe, video, source').each((_, el) => {
    const src = $(el).attr('data-litespeed-src') || $(el).attr('data-src') || $(el).attr('src');
    if (!src || /^about:blank$/i.test(src)) return;
    const u = toAbs(src);
    if (/(dailymotion|youtube|vimeo|stream|player|\.mp4|\.mkv|m3u8)/i.test(u)) {
      streams.push(u);
    }
  });

  const downloads = [];
  const seen = new Set();
  $('.soraddlx').each((_, box) => {
    const server = $(box).find('.sorattlx h3').first().text().trim() || null;
    $(box).find('.soraurlx a').each((_, a) => {
      const href = $(a).attr('href');
      if (!href || seen.has(href)) return;
      seen.add(href);
      downloads.push({
        server,
        label: $(a).text().trim() || null,
        url: href,
      });
    });
  });

  return {
    url: abs,
    title,
    poster,
    streams,
    downloads,
  };
}

// ---- detail post via REST (metadata) ----

export async function post(url) {
  if (!url) throw new Error('post: URL wajib diisi');
  const slug = slugFromUrl(url);
  if (!slug) throw new Error(`post: tidak bisa mengekstrak slug dari ${url}`);
  const list = await httpGet(`${API}/posts?slug=${encodeURIComponent(slug)}&per_page=1`, {
    json: true,
    cacheKey: `slug:${slug}`,
  });
  if (!Array.isArray(list) || list.length === 0) throw new Error(`post: tidak ditemukan untuk slug "${slug}"`);
  const p = list[0];
  return {
    id: p.id,
    title: decodeEntities(p.title?.rendered || null),
    url: p.link,
    slug: p.slug,
    date: p.date,
    modified: p.modified,
    categories: p.categories || [],
    tags: p.tags || [],
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
      case 'anime-list':
        result = await animeList();
        break;
      case 'series':
        result = await series(args[1] || '');
        break;
      case 'episode':
        result = await episode(args[1] || '');
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
      case 'schedule':
        result = await schedule();
        break;
      case 'season':
        result = await season(args[1] || '');
        break;
      case 'random':
        result = await random();
        break;
      default:
        console.error(`Perintah tidak dikenal: ${cmd}`);
        console.error('Gunakan: list | series "slug" | episode "URL" | post "URL" | search "kata" | genre "slug" | schedule | season "tahun" | random');
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
