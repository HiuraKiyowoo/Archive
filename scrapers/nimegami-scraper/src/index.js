import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE = 'https://nimegami.id';
const API = `${BASE}/wp-json/wp/v2`;
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ---- HTTP helper -----------------------------------------------------------

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

// cache in-memory sederhana agar request sama tidak diulang
const cache = new Map();
const TTL = 10 * 60 * 1000; // 10 menit

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

function nullIfEmpty(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v) && v.length === 0) return [];
  return v;
}

function cleanText(html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  const t = $('body').text().replace(/\s+/g, ' ').trim();
  return t || null;
}

function parseClassList(list = []) {
  const genres = [];
  const tags = [];
  const types = [];
  let series = null;
  let abjad = null;
  for (const c of list) {
    if (c.startsWith('category-')) genres.push(c.slice('category-'.length));
    else if (c.startsWith('tag-')) tags.push(c.slice('tag-'.length));
    else if (c.startsWith('type-')) types.push(c.slice('type-'.length));
    else if (c.startsWith('series-')) series = c.slice('series-'.length);
    else if (c.startsWith('abjad-')) abjad = c.slice('abjad-'.length);
  }
  return { genres, tags, types, series, abjad };
}

// ---- normalisasi item -------------------------------------------------------

function itemFromPost(p) {
  const cls = parseClassList(p.class_list || []);
  const title = decodeEntities(p.title?.rendered || null);
  return {
    id: p.id ?? null,
    title,
    url: p.link ?? null,
    slug: p.slug ?? null,
    type: cls.types[0] || p.type || null,
    types: cls.types,
    genres: cls.genres,
    tags: cls.tags,
    series: cls.series,
    abjad: cls.abjad,
    poster: p.poster ?? null,
    thumbnail: p.poster ?? null,
    cover: p.yoast_head_json?.og_image?.[0]?.url ?? null,
    date: p.date ?? null,
    modified: p.modified ?? null,
    excerpt: cleanText(p.excerpt?.rendered || null),
    // chapter count = jumlah episode jika judul mengandung pola "Episode 1 - N"
    episode_range: parseEpisodeRange(decodeEntities(p.title?.rendered || '')),
  };
}

function parseEpisodeRange(title) {
  if (!title) return null;
  const m = title.match(/Episode\s+(\d+)\s*(?:&#8211;|–|-)\s*(\d+)/i);
  if (m) return { from: Number(m[1]), to: Number(m[2]) };
  return null;
}

function itemFromSearchHit(hit) {
  return {
    id: hit.id ?? null,
    title: decodeEntities(hit.title || null),
    url: hit.url ?? null,
    type: hit.subtype ?? hit.type ?? null,
  };
}

// ---- homepage ---------------------------------------------------------------

export async function home(options = {}) {
  const perPage = options.perPage ?? 18;
  const url = `${API}/posts?per_page=${perPage}&orderby=date&order=desc`;
  const data = await httpGet(url, { json: true, cacheKey: `home:${perPage}` });
  const items = data.map(itemFromPost);
  return {
    total_items: items.length,
    items,
  };
}

// ---- search -----------------------------------------------------------------

export async function search(query, page = 1, options = {}) {
  const perPage = options.perPage ?? 10;
  const url = `${API}/search?search=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}&_fields=id,title,url,type,subtype`;
  const res = await client.get(url, { timeout: 30000 });
  const data = res.data;
  const total = Number(res.headers['x-wp-total'] ?? data.length);
  const totalPages = Number(res.headers['x-wp-totalpages'] ?? (total ? Math.ceil(total / perPage) : 1));
  return {
    query,
    page,
    per_page: perPage,
    total,
    total_pages: totalPages,
    items: data.map(itemFromSearchHit),
  };
}

// ---- genre ------------------------------------------------------------------

export async function genre(slug, page = 1, options = {}) {
  if (!slug || typeof slug !== 'string') throw new Error('genre: slug wajib diisi');
  const safe = slug.replace(/^\/+|\/+$/g, '');
  const url = `/category/${encodeURIComponent(safe)}/${page > 1 ? `page/${page}/` : ''}`;
  const html = await httpGet(url, { cacheKey: `genre:${safe}:${page}` });
  const $ = cheerio.load(html);

  const items = [];
  $('article').each((_, el) => {
    const a = $(el).find('a').first();
    const href = a.attr('href');
    const img = $(el).find('img').first();
    const titleEl = $(el).find('h2 a').first();
    const title = titleEl.text().trim() || img.attr('alt') || null;
    const poster = img.attr('src') || img.attr('data-src') || null;
    const eps = $(el).find('.eps-archive').first().text().trim() || null;
    const rating = $(el).find('.rating-archive').first().text().trim() || null;
    const status = $(el).find('.term_tag-a a').first().text().trim() || null;
    const type = $(el).find('.terms_tag a').first().text().trim() || null;

    if (!href) return;
    items.push({
      title: title ? decodeEntities(title) : null,
      url: href.startsWith('http') ? href : BASE + href,
      image: poster,
      thumbnail: poster,
      eps,
      rating,
      status,
      type,
    });
  });

  // pagination: cari halaman terakhir dari link /category/slug/page/N/
  let lastPage = page;
  const pages = [];
  $('a[href*="/page/"]').each((_, el) => {
    const m = ($(el).attr('href') || '').match(/\/page\/(\d+)\/$/);
    if (m) pages.push(Number(m[1]));
  });
  if (pages.length) lastPage = Math.max(...pages);

  return {
    genre: safe,
    page,
    last_page: lastPage,
    has_next: page < lastPage,
    items,
  };
}

// ---- genres -----------------------------------------------------------------

export async function genres() {
  const html = await httpGet('/genre-category-list/', { cacheKey: 'genres' });
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $('a[href*="/category/"]').each((_, el) => {
    const href = $(el).attr('href');
    const m = href.match(/\/category\/([^/]+)\/$/);
    if (!m || seen.has(m[1])) return;
    seen.add(m[1]);
    out.push({ slug: m[1], name: $(el).text().trim() || m[1], url: href });
  });
  return out;
}

// ---- detail -----------------------------------------------------------------

export async function detail(url) {
  if (!url) throw new Error('detail: URL wajib diisi');
  let id = extractId(url);
  if (id == null) {
    // resolve slug ke ID via REST
    const slug = extractSlug(url);
    if (!slug) throw new Error(`detail: tidak bisa mengekstrak ID/slug dari ${url}`);
    const list = await httpGet(
      `${API}/posts?slug=${encodeURIComponent(slug)}&_fields=id&per_page=1`,
      { json: true, cacheKey: `slug:${slug}` }
    );
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(`detail: post tidak ditemukan untuk slug "${slug}"`);
    }
    id = list[0].id;
  }

  const [post, media] = await Promise.all([
    httpGet(`${API}/posts/${id}?_fields=id,title,content,excerpt,link,slug,date,modified,poster,tags,class_list,type,yoast_head_json,featured_media`, { json: true, cacheKey: `post:${id}` }),
    client.get(`${API}/media?parent=${id}&per_page=100`, { timeout: 30000 }).catch(() => ({ data: [] })),
  ]);

  const cls = parseClassList(post.class_list || []);
  const yoast = post.yoast_head_json || {};

  const chapters = parseDownloadChapters(post.content?.rendered || null);

  return {
    id: post.id ?? null,
    title: decodeEntities(post.title?.rendered || null),
    alternative_title: null,
    url: post.link ?? url,
    slug: post.slug ?? null,
    type: cls.types[0] || post.type || null,
    types: cls.types,
    status: cls.tags.includes('complete') ? 'Completed' : cls.tags.includes('on-going') ? 'On-going' : null,
    genres: cls.genres,
    tags: cls.tags,
    series: cls.series,
    abjad: cls.abjad,
    description: cleanText(post.content?.rendered || null),
    synopsis: cleanText(post.excerpt?.rendered || null),
    poster: post.poster ?? null,
    cover: yoast.og_image?.[0]?.url ?? null,
    rating: null,
    release_year: null,
    author: null,
    artist: null,
    date: post.date ?? null,
    modified: post.modified ?? null,
    episode_range: parseEpisodeRange(decodeEntities(post.title?.rendered || '')),
    chapter_count: chapters.length || null,
    chapters,
    media: Array.isArray(media.data)
      ? media.data.map((m) => ({
          id: m.id,
          url: m.source_url ?? null,
          title: decodeEntities(m.title?.rendered || null),
          mime: m.mime_type ?? null,
        }))
      : [],
  };
}

function extractId(url) {
  // pola: /?p=30520
  let m = String(url).match(/[?&]p=(\d+)/);
  if (m) return Number(m[1]);
  // pola: /wp-json/.../posts/30520
  m = String(url).match(/\/posts\/(\d+)/);
  if (m) return Number(m[1]);
  return null;
}

function extractSlug(url) {
  // pola: /{slug}/ atau /{slug}
  let m = String(url).match(/https?:\/\/[^/]+\/([^/?#]+)\/?/);
  if (m) return m[1];
  // pola path relatif
  m = String(url).match(/^\/([^/?#]+)\/?/);
  return m ? m[1] : null;
}

// parse daftar episode dari HTML content (link download tidak ada di REST,
// hanya ada di HTML halaman posting, jadi kita fetch halaman HTML-nya)
async function parseDownloadChaptersFromUrl(postUrl) {
  if (!postUrl) return [];
  const html = await httpGet(postUrl, { cacheKey: `html:${postUrl}` });
  return parseDownloadChaptersFromHtml(html);
}

export function parseDownloadChaptersFromHtml(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const chapters = [];
  let current = null;

  $('#LinkDownload .download').find('h4, ul').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'h4') {
      if (current) chapters.push(current);
      current = { title: $(el).text().trim(), number: parseEpisodeNumber($(el).text()), url: null, date: null, downloads: [] };
    } else if (tag === 'ul' && current) {
      $(el).find('li').each((_, li) => {
        const $li = $(li);
        const quality = $li.find('strong').first().text().trim() || null;
        const links = [];
        $li.find('a').each((_, a) => {
          const href = $(a).attr('href');
          if (href) links.push({ label: $(a).text().trim() || null, url: href });
        });
        current.downloads.push({ quality, links });
      });
    }
  });
  if (current) chapters.push(current);
  return chapters;
}

// dipakai detail() bila konten REST ternyata berisi struktur download
function parseDownloadChapters(contentHtml) {
  if (!contentHtml) return [];
  return parseDownloadChaptersFromHtml(contentHtml);
}

function parseEpisodeNumber(text) {
  const m = String(text || '').match(/Episode\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

// detail dengan fetch HTML bila perlu (untuk link download)
export async function detailWithDownloads(url) {
  const base = await detail(url);
  if (base.chapters?.length) return base;
  const htmlChapters = await parseDownloadChaptersFromUrl(base.url || url);
  return { ...base, chapters: htmlChapters, chapter_count: htmlChapters.length || null };
}

// ---- chapter (untuk nimegami: konten chapter = daftar link download) -------

export async function chapter(url, options = {}) {
  if (!url) throw new Error('chapter: URL wajib diisi');
  const fetchHtml = options.fetchDownloads ?? true;
  const post = await detail(url);

  let chapters = post.chapters || [];
  if (fetchHtml && chapters.length === 0) {
    chapters = await parseDownloadChaptersFromUrl(post.url || url);
  }

  return {
    id: post.id,
    title: post.title,
    url: post.url,
    synopsis: post.description,
    poster: post.poster,
    genres: post.genres,
    tags: post.tags,
    chapters,
  };
}

