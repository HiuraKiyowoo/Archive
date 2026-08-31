import * as cheerio from 'cheerio';

const BASE = 'https://komikindo.ch/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// In-memory cache to avoid repeated requests
const cache = new Map();

async function fetchHTML(url, retries = 3) {
  if (cache.has(url)) return cache.get(url);
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (res.status === 403 || res.status === 429) {
        throw new Error(`Blocked (${res.status}) at ${url} — stopping retries`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

      const text = await res.text();
      if (!text || text.length < 100) throw new Error(`Empty/short response for ${url}`);

      cache.set(url, text);
      return text;
    } catch (err) {
      lastErr = err;
      if (err.message.startsWith('Blocked')) throw err;
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

const abs = (href) => (href ? new URL(href, BASE).href : null);
const text = ($, el) => $(el).text().replace(/\s+/g, ' ').trim();
const num = (s) => {
  if (!s) return null;
  const m = String(s).replace(/,/g, '.').match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

// Generic card parser for animepost-style grids
function parseCards($, scope) {
  const seen = new Set();
  const items = [];
  $(scope).find('.animepost, .listupd .bsx, article, .series').each((_, el) => {
    const card = $(el);
    const a = card.find('a').first();
    const href = abs(a.attr('href'));
    if (!href || seen.has(href)) return;
    seen.add(href);

    const img = card.find('img').first();
    const poster = abs(
      img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') ||
      img.attr('srcset')?.split(' ')[0]
    );
    const title = a.attr('title') || text($, img.attr('alt')) || text($, a);

    // type flag
    const typeEl = card.find('.typeflag');
    const type = typeEl.length ? typeEl.attr('class').replace('typeflag', '').trim() : null;

    // rating
    const rating = num(card.find('.rating, .rtg, [itemprop="ratingValue"]').first().text());

   // chapter: prefer the chapter link text (e.g. "Ch. 26")
   const ch = card.find('.adds .lsch a, .lsch a, .epx, .chapter').first();
   const latestChapter = ch.length ? text($, ch) : null;

    items.push({
      title,
      url: href,
      thumbnail: poster,
      type,
      status: null,
      latestChapter,
      rating,
    });
  });
  return items;
}

export async function home() {
  const html = await fetchHTML(BASE);
  const $ = cheerio.load(html);
  const items = parseCards($, 'body');
  // dedupe by url
  const seen = new Set();
  const out = items.filter((it) => (seen.has(it.url) ? false : (seen.add(it.url), true)));
  return { source: BASE, type: 'home', count: out.length, items: out };
}

export async function search(query, page = 1) {
  const url = `${BASE}?s=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ''}`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const items = parseCards($, 'body');
  const pagination = parsePagination($);
  return { source: url, type: 'search', query, page, count: items.length, items, pagination };
}

export async function genre(slug, page = 1) {
  const clean = slug.replace(/^\/+|\/+$/g, '');
  const url = page > 1
    ? `${BASE}genres/${clean}/page/${page}/`
    : `${BASE}genres/${clean}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const items = parseCards($, 'body');
  const pagination = parsePagination($);
  return { source: url, type: 'genre', genre: clean, page, count: items.length, items, pagination };
}

function parsePagination($) {
  const links = $('.pagination a.page-numbers, .pagination a, .page-numbers').toArray().map((el) => ({
    text: text($, el),
    url: abs($(el).attr('href')),
    current: $(el).attr('class')?.includes('current') || false,
  }));
  const current = links.find((l) => l.current) || { text: '1', url: null };
  const next = $('a.next.page-numbers').first();
  // last numeric page = last page-numbers link that is not prev/next and has numeric text
  const numericLinks = links.filter((l) => !/next|prev/i.test(l.text) && num(l.text) != null);
  const last = numericLinks.length ? numericLinks[numericLinks.length - 1] : null;
  return {
    current: num(current.text) || 1,
    next: next.length ? abs(next.attr('href')) : null,
    last: last ? last.url : null,
    totalPages: last ? (num(last.text) || null) : null,
    links,
  };
}

export async function detail(url) {
  if (!url.startsWith('http')) url = abs(url);
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const title = $('h1.entry-title').first().text().replace(/\s+/g, ' ').trim()
    || $('title').text().replace(/- KomikIndo.*$/, '').trim();

  const poster = abs(
    $('.thumb img, .anime-thumbnail img, [property="og:image"]').first().attr('src')
    || $('[property="og:image"]').attr('content')
  );

  // metadata via <b>Label:</b> pattern
  const meta = {};
  $('.spe span, .infolabel, .info-content, .spe').each((_, el) => {
    const txt = text($, el);
    const m = txt.match(/^([A-Za-z ]+?):\s*(.*)$/);
    if (m) meta[m[1].trim().toLowerCase()] = m[2].trim();
  });
  // fallback: <b>Label:</b> followed by sibling text
  $('b').each((_, el) => {
    const label = text($, el).replace(/:$/, '').trim();
    if (!label) return;
    const parent = $(el).parent();
    const full = text($, parent);
    const idx = full.indexOf(label);
    if (idx >= 0 && full.slice(idx + label.length).trim().startsWith(':')) {
      const val = full.slice(idx + label.length).replace(/^:\s*/, '').trim();
      if (val) meta[label.toLowerCase()] = val;
    }
  });

  const synopsis = $('[itemprop="description"], .entry-content, .desc').first().text()
    .replace(/\s+/g, ' ').trim();

  const genres = $('.genxed a, .genre a, .genres a, a[rel="tag"]').toArray()
    .map((el) => text($, el)).filter(Boolean);

  const rating = num($('[itemprop="ratingValue"], .ratingmanga').first().text());

  // chapters: anchors with itemprop="url" in chapter list
  const chapters = [];
  const seenCh = new Set();
  $('a[itemprop="url"], .chapter-list a, .eplister a, #chapter_list a').each((_, el) => {
    const href = abs($(el).attr('href'));
    if (!href || !/chapter/i.test(href) || seenCh.has(href)) return;
    seenCh.add(href);
    const t = text($, el);
    const numMatch = t.match(/(\d+(?:\.\d+)?)/);
    chapters.push({
      title: t || null,
      url: href,
      number: numMatch ? parseFloat(numMatch[1]) : null,
      date: null,
    });
  });
  // sort newest first (higher chapter number first)
  chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

  return {
    title,
    url,
    poster,
    alternativeTitle: meta['judul alternatif'] || null,
    synopsis: synopsis || null,
    author: meta['pengarang'] || null,
    artist: meta['ilustrator'] || null,
    status: meta['status'] || null,
    type: meta['jenis komik'] || null,
    genres,
    rating,
    releaseYear: meta['tahun'] || null,
    chapters,
    chapterCount: chapters.length,
  };
}

export async function chapter(url) {
  if (!url.startsWith('http')) url = abs(url);
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const title = $('h1.entry-title').first().text().replace(/\s+/g, ' ').trim()
    || $('title').text().replace(/- KomikIndo.*$/, '').trim();

  // images live in .chapter-image (not ad banners)
  const AD_DOMAINS = ['blogger.googleusercontent.com', 'blogspot.com', 'bp.blogspot.com'];
  const AD_KEYWORDS = ['slot', 'judi', 'casino', '777', '666', 'gacor', 'togel', 'poker', 'bet', 'depo', 'pulsa'];
  const isAd = (el) => {
    const alt = ($(el).attr('alt') || '').toLowerCase();
    if (AD_KEYWORDS.some((k) => alt.includes(k))) return true;
    return false;
  };

  const images = [];
  const seenImg = new Set();
  $('.chapter-image img, #readerarea img, .chapter-content img').each((i, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
    if (!src) return;
    const absolute = abs(src);
    if (!absolute) return;
    try {
      const host = new URL(absolute).hostname;
      if (AD_DOMAINS.some((d) => host === d || host.endsWith('.' + d))) return;
    } catch {}
    if (isAd(el)) return;

    if (seenImg.has(absolute)) return;
    seenImg.add(absolute);
    images.push({
      page: images.length + 1,
      url: absolute,
      alt: $(el).attr('alt') || null,
      title: $(el).attr('title') || null,
    });
  });

  return { title, url, pageCount: images.length, images };
}

