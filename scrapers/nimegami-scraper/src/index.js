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

// ---- metadata dari HTML (tidak tersedia di REST) ----------------------------
//
// REST API nimegami TIDAK mengembalikan studio, rating, musim, durasi, subtitle,
// credit, maupun judul alternatif — semuanya cuma ada di tabel `div.info2` pada
// halaman HTML. `class_list` REST juga memberi type "post", padahal type asli
// (TV / ONA / Movie) ada di baris "Type" tabel tersebut.
// Diverifikasi live 2026-08-31 di /oni-no-hanayome-sub-indo/.

// Baris tabel: <td class="tablex">Label <span>:</span></td><td>nilai</td>
// Kolom nilai bisa punya class tambahan (ratingx / info_a / seriesx) dan
// isinya bisa berupa <a> (musim, type, series) — diambil teksnya saja.
export function parseInfoTable(html) {
  if (!html) return { meta: {}, categories: [] };
  const $ = cheerio.load(html);
  const meta = {};
  let categories = [];

  $('div.info2 table tr').each((_, tr) => {
    const $tr = $(tr);
    const label = $tr.find('td.tablex').first().text().replace(/\s*:\s*$/, '').trim().toLowerCase();
    if (!label) return;
    const $val = $tr.find('td').eq(1);
    const value = $val.text().replace(/\s+/g, ' ').trim();
    if (value) meta[label] = value;
    // Kategori = daftar <a> di td.info_a; dipakai sebagai fallback genre.
    if ($val.hasClass('info_a')) {
      categories = $val.find('a').toArray().map((a) => $(a).text().trim()).filter(Boolean);
    }
  });

  return { meta, categories };
}

// "7.07 [MAL]" -> { score: 7.07, source: "MAL" }
function parseRating(raw) {
  if (!raw) return { score: null, source: null };
  const m = String(raw).match(/([\d.]+)\s*\[?\s*([A-Za-z]+)?/);
  if (!m) return { score: null, source: null };
  const score = Number(m[1]);
  return { score: Number.isFinite(score) ? score : null, source: m[2] || null };
}

// "Summer 2026" -> 2026
function parseYear(raw) {
  const m = String(raw || '').match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

// "24 min per ep Menit" -> "24 min per ep"
function cleanDuration(raw) {
  if (!raw) return null;
  return String(raw).replace(/\s*Menit\s*$/i, '').trim() || null;
}

// Daftar episode + link streaming dari <li class="select-eps" data="BASE64">.
// data = base64 JSON [{format, url:[...]}, ...]. Ini SATU-SATUNYA sumber link
// streaming (path /streaming/); #LinkDownload hanya memuat link unduhan mirror.
export function parseSelectEps(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const out = [];

  $('li.select-eps').each((_, li) => {
    const raw = $(li).attr('data');
    if (!raw) return;
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
    } catch {
      return; // data rusak -> episode dilewati, bukan dilempar
    }
    if (!Array.isArray(decoded)) return;

    const label = $(li).text().replace(/\s+/g, ' ').trim();
    const num = label.match(/Episode\s*(\d+)/i) || label.match(/(\d+)/);
    out.push({
      title: label || null,
      number: num ? Number(num[1]) : null,
      streams: decoded.map((d) => ({
        quality: d.format || null,
        urls: Array.isArray(d.url) ? d.url : d.url ? [d.url] : [],
      })),
    });
  });

  out.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  return out;
}

// Gabungkan episode dari #LinkDownload (mirror unduhan) dengan li.select-eps
// (link streaming). Dicocokkan berdasarkan nomor episode; episode yang hanya
// muncul di salah satu sumber tetap ikut.
function mergeEpisodes(downloadChapters = [], streamEps = []) {
  const byNum = new Map();

  for (const c of downloadChapters) {
    const key = c.number ?? `t:${c.title}`;
    byNum.set(key, { ...c, streams: [] });
  }

  for (const e of streamEps) {
    const key = e.number ?? `t:${e.title}`;
    const hit = byNum.get(key);
    if (hit) {
      hit.streams = e.streams;
      if (!hit.title) hit.title = e.title;
    } else {
      byNum.set(key, {
        title: e.title,
        number: e.number,
        url: null,
        date: null,
        downloads: [],
        streams: e.streams,
      });
    }
  }

  return [...byNum.values()].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

// detail lengkap: REST (id, slug, tanggal, class_list) + HTML (studio, rating,
// musim, durasi, subtitle, credit, type asli, judul alternatif) + episode
// gabungan (mirror unduhan dari #LinkDownload + link streaming dari select-eps).
// Selalu fetch HTML karena metadata di atas tidak ada di REST sama sekali.
export async function detailWithDownloads(url) {
  const base = await detail(url);
  const pageUrl = base.url || url;
  const html = await httpGet(pageUrl, { cacheKey: `html:${pageUrl}` });

  const { meta, categories } = parseInfoTable(html);
  const rating = parseRating(meta['rating']);
  const streamEps = parseSelectEps(html);
  const downloadChapters = base.chapters?.length
    ? base.chapters
    : parseDownloadChaptersFromHtml(html);
  const chapters = mergeEpisodes(downloadChapters, streamEps);

  return {
    ...base,
    // judul bersih dari tabel ("Oni no Hanayome"), tanpa embel "Sub Indo : Episode 1 – 12 (End)"
    clean_title: meta['judul'] || base.title,
    alternative_title: meta['judul alternatif'] || null,
    // type REST selalu "post"; type asli (TV/ONA/Movie) ada di tabel
    type: meta['type'] || base.type,
    genres: base.genres?.length ? base.genres : categories,
    categories,
    studio: meta['studio'] || null,
    rating: rating.score,
    rating_source: rating.source,
    rating_raw: meta['rating'] || null,
    season: meta['musim / rilis'] || null,
    release_year: parseYear(meta['musim / rilis']),
    duration: cleanDuration(meta['durasi per episode']),
    subtitle: meta['subtitle'] || null,
    credit: meta['credit'] || null,
    series: meta['series'] || base.series,
    info: meta,
    chapters,
    chapter_count: chapters.length || null,
  };
}

// ---- chapter (untuk nimegami: konten chapter = daftar link download) -------
//
// Episode nimegami tidak punya halaman sendiri — semuanya inline di halaman
// series. Jadi chapter() memakai hasil detailWithDownloads() supaya tiap episode
// membawa mirror unduhan DAN link streaming sekaligus.
export async function chapter(url, options = {}) {
  if (!url) throw new Error('chapter: URL wajib diisi');
  const post = await detailWithDownloads(url);
  const only = options.number ?? null;
  const chapters = only == null ? post.chapters : post.chapters.filter((c) => c.number === only);

  return {
    id: post.id,
    title: post.title,
    clean_title: post.clean_title,
    url: post.url,
    synopsis: post.description,
    poster: post.poster,
    genres: post.genres,
    tags: post.tags,
    studio: post.studio,
    rating: post.rating,
    season: post.season,
    chapters,
  };
}

