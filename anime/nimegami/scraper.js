import * as cheerio from 'cheerio';

const BASE = 'https://nimegami.id/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      if (!text || text.length < 500) throw new Error('Empty/short response');
      cache.set(url, text);
      return text;
    } catch (err) {
      lastErr = err;
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

const abs = (href) => href ? new URL(href, BASE).href : null;
const text = ($, el) => $(el).text().replace(/\s+/g, ' ').trim();

const decodeEpisodeData = (data) => {
  try {
    const json = Buffer.from(data, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch { return null; }
};

// ---- Homepage ----
export async function home() {
  const html = await fetchHTML(BASE);
  const $ = cheerio.load(html);
  const items = [];
  $('article.stiky_post, article.post').each((_, el) => {
    const card = $(el);
    const a = card.find('.thumb a, .thumbnail a, a[rel="bookmark"]').first();
    const href = abs(a.attr('href'));
    if (!href) return;
    const title = a.attr('title') || text($, a);
    const img = card.find('.thumb img, .thumbnail img, img').first();
    const poster = abs(img.attr('src') || img.attr('data-src'));
    const meta = card.find('.meta-info, .meta, .info').text().replace(/\s+/g, ' ').trim();
    const episode = card.find('.episode, .eps').text().trim() || null;
    items.push({ title, url: href, thumbnail: poster, meta, episode });
  });
  return { source: BASE, type: 'home', count: items.length, items };
}

// ---- Detail ----
export async function detail(url) {
  if (!url.startsWith('http')) url = abs(url);
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const title = $('div.subheading h2[itemprop="name"]').first().text().trim()
    || $('h1.title').first().text().trim()
    || $('title').text().replace(/ - Nimegami$/, '').trim();

  const poster = abs($('div.coverthumbnail img').first().attr('src'));
  const synopsis = $('div.content#Sinopsis').first().text().replace(/\s+/g, ' ').trim();

  // Info table: div.info2 table tr -> label (td.tablex) + value (next td)
  const meta = {};
  $('div.info2 table tr').each((_, el) => {
    const label = text($, $(el).find('td.tablex').first()).replace(/:$/, '').trim();
    if (!label) return;
    const val = text($, $(el).find('td').eq(1));
    if (val) meta[label.toLowerCase()] = val;
  });

  const genres = $('td.info_a a').toArray().map(el => text($, el)).filter(Boolean);

  const studio = meta['studio'] || null;
  const status = meta['status'] || null;
  const type = meta['type'] || null;

  // Episode list — from li.select-eps data attribute (base64 JSON)
  const episodes = [];
  $('li.select-eps').each((_, el) => {
    const dataAttr = $(el).attr('data');
    if (!dataAttr) return;
    const decoded = decodeEpisodeData(dataAttr);
    if (!decoded || !Array.isArray(decoded)) return;
    const label = text($, el);
    const numMatch = label.match(/Episode\s*(\d+)/i) || label.match(/(\d+)/);
    const number = numMatch ? parseInt(numMatch[1]) : null;
    const qualities = decoded.map(item => ({
      quality: item.format || null,
      urls: Array.isArray(item.url) ? item.url : [item.url],
    }));
    episodes.push({ title: label || null, number, qualities });
  });
  episodes.sort((a, b) => (a.number || 0) - (b.number || 0));

  return {
    title,
    url,
    poster,
    synopsis: synopsis || null,
    studio,
    status,
    type,
    genres,
    meta,
    episodes,
    episodeCount: episodes.length,
  };
}

// ---- Episode (fetch from detail by number) ----
export async function episode(detailUrl, number = 1) {
  const det = await detail(detailUrl);
  const ep = det.episodes.find(e => e.number === number) || det.episodes[0];
  if (!ep) throw new Error(`Episode ${number} not found`);
  return { title: det.title, detailUrl: det.url, episode: ep };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , cmd, arg1] = process.argv;
  const out = obj => console.log(JSON.stringify(obj, null, 2));
  try {
    switch (cmd) {
      case 'home': out(await home()); break;
      case 'detail': out(await detail(arg1)); break;
      case 'episode': out(await episode(arg1)); break;
      default: console.log('Usage: node scraper.js <home|detail|episode> [url]');
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}