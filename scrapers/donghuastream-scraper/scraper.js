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
  const m = String(url || '').match(/donghuastream\.org\/([^/?#]+)\/?/);
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
    episode_count: episodes.length,
    episodes,
  };
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
      default:
        console.error(`Perintah tidak dikenal: ${cmd}`);
        console.error('Gunakan: list | series "slug" | episode "URL" | post "URL"');
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