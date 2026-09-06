/**
 * RyuKomik Scraper & API Client
 * Target: https://ryukomik.my.id/ & https://api.ryukomik.web.id/
 * Pure HTTP, Zero external dependencies (Node.js 18+).
 */

const BASE_WEB = 'https://ryukomik.my.id';
const BASE_API = 'https://api.ryukomik.web.id';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'id,en-US;q=0.9,en;q=0.8',
};

async function httpFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...DEFAULT_HEADERS,
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP Error ${res.status}: ${res.statusText} on ${url}`);
  }
  return res;
}

async function fetchJson(url, options = {}) {
  const res = await httpFetch(url, options);
  return res.json();
}

async function fetchHtml(url, options = {}) {
  const res = await httpFetch(url, options);
  return res.text();
}

// Helper query params
function buildQuery(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      q.append(k, String(v));
    }
  }
  const str = q.toString();
  return str ? `?${str}` : '';
}

/* =========================================================================
   1. RYUKOMIK ORIGINAL PROJECT (API + SSR)
   ========================================================================= */

/**
 * Mendapatkan daftar filter yang didukung katalog Project (tipe, status, genre, genre2)
 */
export async function getProjectFilters() {
  const res = await fetchJson(`${BASE_WEB}/api/project/filters`);
  return res.data || res;
}

/**
 * Mendapatkan katalog komik project RyuKomik
 * @param {Object} opts { page, tipe, status, genre, genre2 }
 */
export async function getProjectPustaka(opts = {}) {
  const query = buildQuery({
    page: opts.page || 1,
    tipe: opts.tipe,
    status: opts.status,
    genre: opts.genre,
    genre2: opts.genre2
  });
  const res = await fetchJson(`${BASE_WEB}/api/project/pustaka${query}`);
  return {
    success: res.success ?? true,
    total: res.total || (res.data ? res.data.length : 0),
    hasMore: res.hasMore ?? false,
    data: res.data || []
  };
}

/**
 * Mendapatkan detail komik project RyuKomik (Metadata Schema.org + Chapter List)
 * @param {string} slug Contoh: 'sicario'
 */
export async function getProjectDetail(slug) {
  const cleanSlug = slug.replace(/^.*\/komik\/project\//, '').replace(/\/$/, '');
  const url = `${BASE_WEB}/komik/project/${encodeURIComponent(cleanSlug)}`;
  const html = await fetchHtml(url);

  // 1. Ekstrak Schema.org ComicSeries JSON-LD
  let meta = {};
  const ldMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const block of ldMatches) {
    try {
      const jsonStr = block.replace(/<\/?script[^>]*>/g, '');
      const parsed = JSON.parse(jsonStr);
      if (parsed['@type'] === 'ComicSeries') {
        meta = parsed;
        break;
      }
    } catch {
      // ignore JSON parse error
    }
  }

  // 2. Ekstrak Chapters dari DOM
  const chapters = [];
  const chRegex = /<a[^>]+href="(\/chapter\/project\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = chRegex.exec(html)) !== null) {
    const chUrl = m[1];
    const inner = m[2];
    const texts = (inner.match(/>([^<]+)</g) || [])
      .map(t => t.replace(/[><]/g, '').trim())
      .filter(Boolean);

    const title = texts[0] || '';
    const time = texts[1] || '';
    const chSlug = chUrl.split('/').filter(Boolean).pop();

    chapters.push({
      title,
      slug: chSlug,
      url: `${BASE_WEB}${chUrl}`,
      time
    });
  }

  return {
    source: 'project',
    title: meta.name || cleanSlug,
    slug: cleanSlug,
    url,
    image: meta.image || null,
    author: meta.author ? meta.author.name : null,
    description: meta.description || null,
    genres: meta.genre || [],
    total_chapters: chapters.length,
    chapters
  };
}

/**
 * Membaca chapter komik project (Daftar Gambar)
 * @param {string} slug Contoh: 'sicario'
 * @param {string} chapterSlug Contoh: 'chapter-1'
 */
export async function getProjectChapter(slug, chapterSlug) {
  const s = slug.replace(/^.*\/komik\/project\//, '').replace(/\/$/, '');
  const ch = chapterSlug.replace(/^.*\/chapter\/project\/[^/]+\//, '').replace(/\/$/, '');
  const url = `${BASE_WEB}/api/project/chapter/${encodeURIComponent(s)}/${encodeURIComponent(ch)}`;
  const res = await fetchJson(url);
  return {
    success: res.success ?? true,
    title: res.title || '',
    currentChapter: res.currentChapter || ch,
    mangaId: res.mangaId || s,
    series: res.series || null,
    prev: res.prev || null,
    next: res.next || null,
    total_images: (res.images || []).length,
    images: res.images || []
  };
}

/* =========================================================================
   2. KOMIKU SOURCE (API)
   ========================================================================= */

/**
 * Komik terbaru dari source Komiku
 */
export async function getKomikuTerbaru() {
  return fetchJson(`${BASE_API}/komiku/terbaru`);
}

/**
 * Katalog komik Komiku berpaginasi & filter
 * @param {Object} opts { page, orderby, tipe, genre, genre2, status }
 */
export async function getKomikuPustaka(opts = {}) {
  const query = buildQuery({
    page: opts.page || 1,
    orderby: opts.orderby,
    tipe: opts.tipe,
    genre: opts.genre,
    genre2: opts.genre2,
    status: opts.status
  });
  return fetchJson(`${BASE_API}/komiku/pustaka-filter${query}`);
}

/**
 * Cari komik di Komiku
 * @param {string} query Kata kunci
 */
export async function searchKomiku(query) {
  return fetchJson(`${BASE_API}/komiku/search?q=${encodeURIComponent(query)}`);
}

/**
 * Detail komik dari source Komiku
 * @param {string} slug Contoh: 'magic-emperor'
 */
export async function getKomikuDetail(slug) {
  const clean = slug.replace(/^.*\/komik\/komiku\//, '').replace(/\/$/, '');
  return fetchJson(`${BASE_API}/komiku/detail/${encodeURIComponent(clean)}`);
}

/**
 * Baca chapter komik Komiku (Daftar Gambar)
 * @param {string} chapterSlug Contoh: 'magic-emperor-chapter-905'
 */
export async function getKomikuChapter(chapterSlug) {
  const clean = chapterSlug.replace(/^.*\/chapter\/komiku\//, '').replace(/\/$/, '');
  return fetchJson(`${BASE_API}/komiku/chapter/${encodeURIComponent(clean)}`);
}

/* =========================================================================
   3. DOUJINDESU SOURCE (API)
   ========================================================================= */

/**
 * Doujin rilis terbaru
 */
export async function getDoujinTerbaru() {
  return fetchJson(`${BASE_API}/doujindesu/terbaru`);
}

/**
 * Manhwa dewasa rilis terbaru
 */
export async function getDoujinManhwaTerbaru() {
  return fetchJson(`${BASE_API}/doujindesu/manhwa/terbaru`);
}

/**
 * Pustaka katalog Doujindesu
 * @param {Object} opts { page, tipe, genre, status }
 */
export async function getDoujinPustaka(opts = {}) {
  const query = buildQuery({
    page: opts.page || 1,
    tipe: opts.tipe,
    genre: opts.genre,
    status: opts.status
  });
  return fetchJson(`${BASE_API}/doujindesu/pustaka-filter${query}`);
}

/**
 * Cari di Doujindesu
 * @param {string} query Kata kunci
 */
export async function searchDoujin(query) {
  return fetchJson(`${BASE_API}/doujindesu/search?q=${encodeURIComponent(query)}`);
}

/**
 * Detail doujin
 * @param {string} slug Contoh: 'i-love-you-very-much'
 */
export async function getDoujinDetail(slug) {
  const clean = slug.replace(/^.*\/doujindesu\/detail\//, '').replace(/\/$/, '');
  return fetchJson(`${BASE_API}/doujindesu/detail/${encodeURIComponent(clean)}`);
}

/**
 * Baca chapter doujin (Daftar Gambar)
 * @param {string} chapterSlug
 */
export async function getDoujinChapter(chapterSlug) {
  const clean = chapterSlug.replace(/^.*\/doujindesu\/chapter\//, '').replace(/\/$/, '');
  return fetchJson(`${BASE_API}/doujindesu/chapter/${encodeURIComponent(clean)}`);
}

/* =========================================================================
   4. KOMIKID SOURCE (API)
   ========================================================================= */

/**
 * Katalog Komikid
 * @param {Object} opts { page, tipe, genre, status }
 */
export async function getKomikidPustaka(opts = {}) {
  const hasFilter = opts.tipe || opts.genre || opts.status;
  const endpoint = hasFilter ? 'pustaka-filter' : 'pustaka';
  const query = buildQuery({
    page: opts.page || 1,
    tipe: opts.tipe,
    genre: opts.genre,
    status: opts.status
  });
  return fetchJson(`${BASE_API}/komikid/${endpoint}${query}`);
}

/**
 * Detail Komikid
 * @param {string} slug Contoh: 'the-villain-wants-to-live'
 */
export async function getKomikidDetail(slug) {
  const clean = slug.replace(/^.*\/komik\/komikid\//, '').replace(/\/$/, '');
  return fetchJson(`${BASE_API}/komikid/detail/${encodeURIComponent(clean)}`);
}

/**
 * Baca chapter Komikid
 * @param {string} chapterSlug Contoh: 'the-villain-wants-to-live-chapter-66'
 */
export async function getKomikidChapter(chapterSlug) {
  const clean = chapterSlug.replace(/^.*\/chapter\/komikid\//, '').replace(/\/$/, '');
  return fetchJson(`${BASE_API}/komikid/chapter/${encodeURIComponent(clean)}`);
}

/* =========================================================================
   5. KIRYUU SOURCE (API)
   ========================================================================= */

/**
 * Katalog Kiryuu
 * @param {Object} opts { page, tipe, genre, status }
 */
export async function getKiryuuPustaka(opts = {}) {
  const query = buildQuery({
    page: opts.page || 1,
    tipe: opts.tipe,
    genre: opts.genre,
    status: opts.status
  });
  return fetchJson(`${BASE_API}/kiryuu/pustaka-filter${query}`);
}

/* =========================================================================
   6. ANIME ENGINE (SSR HTML PARSING)
   ========================================================================= */

function parseAnimeCards(html) {
  const items = [];
  const cardRegex = /<a[^>]+href="(\/anime\/detail\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = cardRegex.exec(html)) !== null) {
    const href = m[1];
    const inner = m[2];
    const slug = href.replace('/anime/detail/', '').replace(/\/$/, '');

    // Ekstrak gambar
    const imgMatch = inner.match(/<img[^>]+src="([^"]+)"/);
    const image = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : null;

    // Ekstrak judul (bisa di teks atau atribut alt)
    const altMatch = inner.match(/alt="([^"]+)"/);
    const titleMatch = inner.match(/<h\d[^>]*>(.*?)<\/h\d>/i);
    const title = titleMatch ? titleMatch[1].trim() : (altMatch ? altMatch[1].trim() : slug.replace(/-/g, ' '));

    // Episode text jika ada
    const epMatch = inner.match(/Episode\s*(\d+)/i) || inner.match(/(\d+)\s*Eps/i);
    const episode = epMatch ? epMatch[0] : null;

    items.push({
      title,
      slug,
      url: `${BASE_WEB}${href}`,
      image,
      episode
    });
  }
  return items;
}

/**
 * Anime rilis terbaru
 */
export async function getAnimeTerbaru() {
  const html = await fetchHtml(`${BASE_WEB}/anime/terbaru`);
  return {
    source: 'anime',
    category: 'terbaru',
    data: parseAnimeCards(html)
  };
}

/**
 * Anime sedang tayang (Ongoing)
 */
export async function getAnimeOngoing() {
  const html = await fetchHtml(`${BASE_WEB}/anime/ongoing`);
  return {
    source: 'anime',
    category: 'ongoing',
    data: parseAnimeCards(html)
  };
}

/**
 * Jadwal rilis anime mingguan
 */
export async function getAnimeJadwal() {
  const html = await fetchHtml(`${BASE_WEB}/anime/jadwal`);
  const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const schedule = {};

  // Parse card anime jadwal
  const cards = parseAnimeCards(html);
  return {
    source: 'anime',
    category: 'jadwal',
    total: cards.length,
    data: cards
  };
}

/**
 * Detail Anime & Daftar Episode
 * @param {string} slug Contoh: 'kaijuu-8-gou-narumi-no-heijitsu'
 */
export async function getAnimeDetail(slug) {
  const clean = slug.replace(/^.*\/anime\/detail\//, '').replace(/\/$/, '');
  const url = `${BASE_WEB}/anime/detail/${encodeURIComponent(clean)}`;
  const html = await fetchHtml(url);

  // Title
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : clean;

  // Cover image
  const imgMatch = html.match(/<img[^>]+src="([^"]+)"[^>]*alt="[^"]*cover[^"]*"/i) ||
                   html.match(/<img[^>]+src="([^"]+)"/i);
  const image = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : null;

  // Episodes
  const episodes = [];
  const epRegex = /<a[^>]+href="(\/anime\/episode\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  const seen = new Set();
  while ((m = epRegex.exec(html)) !== null) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);

    const inner = m[2].replace(/<[^>]+>/g, '').trim();
    const epSlug = href.replace('/anime/episode/', '').replace(/\/$/, '');
    episodes.push({
      title: inner || epSlug,
      slug: epSlug,
      url: `${BASE_WEB}${href}`
    });
  }

  return {
    source: 'anime',
    title,
    slug: clean,
    url,
    image,
    total_episodes: episodes.length,
    episodes
  };
}

/**
 * Ambil streaming embed episode anime
 * @param {string} episodeSlug Contoh: 'kaijuu-8-gou-narumi-no-heijitsu-episode-1'
 */
export async function getAnimeEpisode(episodeSlug) {
  const clean = episodeSlug.replace(/^.*\/anime\/episode\//, '').replace(/\/$/, '');
  const url = `${BASE_WEB}/anime/episode/${encodeURIComponent(clean)}`;
  const html = await fetchHtml(url);

  // Iframe player
  const iframes = [];
  const iframeRegex = /<iframe[^>]+src="([^"]+)"/g;
  let m;
  while ((m = iframeRegex.exec(html)) !== null) {
    iframes.push(m[1].replace(/&amp;/g, '&'));
  }

  // Next/Prev episode navigation
  const prevMatch = html.match(/href="(\/anime\/episode\/[^"]+)"[^>]*>[\s\S]*?Previous/i) ||
                    html.match(/href="(\/anime\/episode\/[^"]+)"[^>]*>[\s\S]*?Prev/i);
  const nextMatch = html.match(/href="(\/anime\/episode\/[^"]+)"[^>]*>[\s\S]*?Next/i);

  return {
    source: 'anime',
    episode_slug: clean,
    url,
    players: iframes,
    video_proxy_url: iframes[0] || null,
    prev_episode: prevMatch ? prevMatch[1] : null,
    next_episode: nextMatch ? nextMatch[1] : null
  };
}

/* =========================================================================
   7. SOCIAL & GAMIFICATION (API)
   ========================================================================= */

/**
 * Peringkat Pembaca (XP Leaderboard)
 */
export async function getLeaderboard() {
  return fetchJson(`${BASE_WEB}/api/leaderboard`);
}
