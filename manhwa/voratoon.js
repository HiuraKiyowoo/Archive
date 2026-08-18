#!/usr/bin/env node
/**
 * Voratoon Public Catalog Scraper CLI
 *
 * PERSYARATAN:
 * - Node.js 18+ (menggunakan native fetch; tidak perlu axios/node-fetch).
 * - Tidak ada login/token yang diperlukan untuk endpoint katalog publik.
 * - Token opsional dapat diberikan melalui environment VORATOON_TOKEN.
 *
 * CONTOH TERMUX:
 *   node voratoon-cli.js home --json | jq
 *   node voratoon-cli.js search "solo leveling" --json | jq '.data[]?.data.title'
 *   node voratoon-cli.js detail magic-emperor --json | jq '.data.data'
 *   node voratoon-cli.js chapters magic-emperor --limit 20 --json | jq '.data'
 *   node voratoon-cli.js series 2 --take 24 --preset rilisan_terbaru --save series.json
 *   node voratoon-cli.js popular --json > popular.json
 *
 * CATATAN:
 * - API backend publik: https://api.voratoon.com
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

const API_BASE = (process.env.VORATOON_API || 'https://api.voratoon.com').replace(/\/+$/, '');
const CACHE_DIR = process.env.VORATOON_CACHE_DIR || path.join(process.cwd(), '.voratoon-cache');
const CACHE_TTL_MS = Number(process.env.VORATOON_CACHE_TTL || 300) * 1000;
const REQUEST_TIMEOUT_MS = Number(process.env.VORATOON_TIMEOUT || 30000);
const USER_AGENT = 'Mozilla/5.0 (compatible; VoratoonCatalogCLI/1.0; +https://v1.voratoon.com/)';

const HELP = `
Voratoon Public Catalog Scraper

Usage:
  node voratoon-cli.js <command> [argument] [options]

Commands:
  home                         Ringkasan data beranda dengan fallback
  popular                     Popular series
  trending                    Trending bulan ini
  recommendations             Rekomendasi editor
  genres                      Semua genre
  presets                     Preset katalog API
  series [page]               Daftar series; default page 1
  detail <slug>               Detail metadata satu series
  chapters <slug>             Semua chapter metadata sebuah series
  chapter <slug> <number>     Detail chapter + images, contoh chapter magic-emperor 897
  search <query>              Cari series memakai parameter title
  best-manga                  Top manga
  best-manhwa                 Best manhwa
  best-manhua                 Best manhua
  anime-adaptations           Series dengan adaptasi anime
  most-bookmarked             Series paling banyak dibookmark
  most-read                   Hall of fame / paling banyak dibaca
  banners                     Banner katalog; fallback ke preset banner jika 401
  popular-all                 Popular sepanjang waktu
  popular-week                Popular minggu ini
  popular-genre <id>          Popular berdasarkan genre
  genre <id>                  Detail satu genre
  ads                         Metadata iklan publik
  placements                 Alias metadata iklan publik
  announcements [id]          Daftar/detail pengumuman publik
  series-views <slug>        Jumlah unique viewers series
  series-visitors <slug>     Jumlah unique visitors series
  chapter-visitors <slug> <chapter>  Unique visitors chapter
  comments <slug>             Endpoint komentar read-only
  reactions <slug>            Endpoint reaksi read-only
  ranking                     Endpoint ranking (status aktual API)
  user-history                Riwayat user; perlu token jika server meminta
  user-bookmarks              Bookmark user; perlu token jika server meminta
  user-comments               Komentar user; perlu token jika server meminta
  read-lists                  Read list user; perlu token jika server meminta

Options:
  --json                      JSON compact untuk pipe/jq
  --save <file>               Simpan response ke file JSON
  --take <n>                  Jumlah item untuk endpoint paginated (default 20)
  --limit <n>                 Batasi array chapters setelah response diterima
  --preset <name>             Filter preset untuk command series
  --status <value>            Filter status series
  --sort <field>              Field sorting untuk command series
  --sort-order <value>        Urutan sorting, misalnya asc/desc
  --filter <expression>       Filter API, misalnya slug==magic-emperor
  --no-cache                  Lewati cache baca/tulis
  --cache-ttl <seconds>       TTL cache untuk command ini
  --help                      Tampilkan bantuan

Environment:
  VORATOON_API                Mengganti base API
  VORATOON_TOKEN              Bearer token opsional
  VORATOON_CACHE_DIR          Direktori cache
  VORATOON_CACHE_TTL          TTL cache default dalam detik
  VORATOON_TIMEOUT            Timeout request dalam milidetik
`;

function die(message, details) {
  const error = new Error(message);
  if (details !== undefined) error.details = details;
  throw error;
}

function parseArgs(argv) {
  const positionals = [];
  const options = {
    json: false,
    save: null,
    take: 20,
    limit: null,
    preset: null,
    status: null,
    sort: null,
    sortOrder: null,
    filter: null,
    noCache: false,
    cacheTtl: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--no-cache') options.noCache = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--save') options.save = argv[++i] || die('--save membutuhkan nama file');
    else if (arg === '--take') options.take = positiveInt(argv[++i], '--take');
    else if (arg === '--limit') options.limit = positiveInt(argv[++i], '--limit');
    else if (arg === '--preset') options.preset = argv[++i] || die('--preset membutuhkan nilai');
    else if (arg === '--status') options.status = argv[++i] || die('--status membutuhkan nilai');
    else if (arg === '--sort') options.sort = argv[++i] || die('--sort membutuhkan nilai');
    else if (arg === '--sort-order') options.sortOrder = argv[++i] || die('--sort-order membutuhkan nilai');
    else if (arg === '--filter') options.filter = argv[++i] || die('--filter membutuhkan nilai');
    else if (arg === '--cache-ttl') options.cacheTtl = positiveInt(argv[++i], '--cache-ttl');
    else if (arg.startsWith('--')) die(`Option tidak dikenal: ${arg}`);
    else positionals.push(arg);
  }
  return { positionals, options };
}

function positiveInt(value, flag) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) die(`${flag} harus berupa integer >= 1`);
  return n;
}

function encodePath(value) {
  return encodeURIComponent(String(value)).replace(/%2F/gi, '/');
}

function buildUrl(route, query = {}) {
  const url = new URL(route.startsWith('/') ? route : `/${route}`, API_BASE);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)));
    else url.searchParams.set(key, String(value));
  }
  return url;
}

function cacheKey(url) {
  return Buffer.from(url).toString('base64url').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function readCache(url, ttlMs) {
  try {
    const file = path.join(CACHE_DIR, `${cacheKey(url)}.json`);
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > ttlMs) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(url, payload) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${cacheKey(url)}.json`), JSON.stringify(payload), 'utf8');
  } catch {
    // Cache bersifat opsional; kegagalan menulis tidak menggagalkan scraper.
  }
}

async function request(route, query, options = {}) {
  const url = buildUrl(route, query);
  const ttlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
  if (!options.noCache) {
    const cached = readCache(url.toString(), ttlMs);
    if (cached) return { ...cached, _meta: { ...(cached._meta || {}), cached: true, url: url.toString() } };
  }

  const headers = {
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
  };
  if (process.env.VORATOON_TOKEN) headers.Authorization = `Bearer ${process.env.VORATOON_TOKEN}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  let payload;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });
    const contentType = response.headers.get('content-type') || '';
    payload = contentType.includes('application/json') ? await response.json() : await response.text();
  } catch (error) {
    const reason = error.name === 'AbortError' ? `timeout setelah ${REQUEST_TIMEOUT_MS}ms` : error.message;
    throw Object.assign(new Error(`Request gagal: ${reason}`), { route, url: url.toString(), cause: error });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const message = payload && typeof payload === 'object' ? (payload.error || payload.message) : String(payload).slice(0, 200);
    if (options.allowHttpError) {
      return {
        status: response.status,
        error: message || `HTTP ${response.status}`,
        data: payload,
        _meta: { cached: false, url: url.toString(), httpErrorReported: true },
      };
    }
    throw Object.assign(new Error(`HTTP ${response.status}${message ? `: ${message}` : ''}`), {
      status: response.status,
      route,
      url: url.toString(),
      payload,
    });
  }

  const result = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...payload, _meta: { ...(payload._meta || {}), cached: false, url: url.toString() } }
    : { status: response.status, data: payload, _meta: { cached: false, url: url.toString() } };
  if (!options.noCache) writeCache(url.toString(), result);
  return result;
}

async function firstWorking(candidates, options = {}) {
  const errors = [];
  for (const candidate of candidates) {
    try {
      const result = await request(candidate.route, candidate.query, options);
      if (candidate.fallbackFrom) {
        result._meta = { ...(result._meta || {}), fallbackFrom: candidate.fallbackFrom };
      }
      return result;
    } catch (error) {
      errors.push({ route: candidate.route, status: error.status || 0, message: error.message });
    }
  }
  const error = new Error('Semua endpoint fallback gagal');
  error.errors = errors;
  throw error;
}

function paginatedQuery(options, extra = {}) {
  return {
    take: options.take,
    page: extra.page ?? 1,
    includeMeta: true,
    ...extra,
  };
}

function popularQuery(options, page = 1) {
  // `/popular` saat ini error jika menerima includeMeta; frontend juga tidak wajib mengirimnya.
  return { take: options.take, page };
}

function seriesQuery(options, extra = {}) {
  const query = paginatedQuery(options, {
    // 0 berarti jangan minta payload chapter/gambar pada endpoint katalog.
    takeChapter: 0,
    ...extra,
  });
  if (options.preset) query.preset = options.preset;
  if (options.status) query.status = options.status;
  if (options.sort) query.sort = options.sort;
  if (options.sortOrder) query.sortOrder = options.sortOrder;
  if (options.filter) query.filter = options.filter;
  return query;
}

async function commandHome(options) {
  const results = await Promise.allSettled([
    firstWorking([
      { route: '/popular/today', query: popularQuery(options), label: 'popular/today' },
      { route: '/popular', query: popularQuery(options), fallbackFrom: '/popular/today', label: 'popular' },
    ], options),
    request('/series', seriesQuery(options, { preset: 'rilisan_terbaru' }), options),
    request('/series/trending', paginatedQuery(options), options),
    request('/series/recommendations', paginatedQuery(options), options),
    request('/genres', {}, options),
    request('/series/presets', {}, options),
  ]);
  const names = ['popularToday', 'latestSeries', 'trending', 'recommendations', 'genres', 'presets'];
  const data = {};
  const errors = {};
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') data[names[index]] = result.value;
    else errors[names[index]] = serializeError(result.reason);
  });
  return { status: Object.keys(errors).length ? 207 : 200, message: 'Voratoon home catalog', data, errors, _meta: { partial: Object.keys(errors).length > 0 } };
}

async function commandSeries(page, options) {
  const pageNumber = page ? positiveInt(page, 'page') : 1;
  return request('/series', seriesQuery(options, { page: pageNumber }), options);
}

async function commandSearch(query, options) {
  if (!query || !query.trim()) die('search membutuhkan query, contoh: search "solo leveling"');
  return request('/series', seriesQuery(options, { title: query.trim(), page: 1 }), options);
}

async function commandDetail(slug, options) {
  if (!slug) die('detail membutuhkan slug, contoh: detail magic-emperor');
  return firstWorking([
    { route: `/series/${encodePath(slug)}`, query: {} },
    { route: '/series', query: seriesQuery(options, { take: 1, page: 1, filter: `slug==${slug}` }), fallbackFrom: `/series/${slug}` },
  ], options);
}

function normalizeChapterItem(item, seriesSlug) {
  const source = item && typeof item === 'object' ? item : {};
  const data = source.data && typeof source.data === 'object' ? source.data : {};
  const index = Number(source.chapterIndex ?? data.index ?? source.index ?? null);
  const chapterIndex = Number.isFinite(index) ? index : null;
  const title = data.title || source.title || (chapterIndex != null ? `Chapter ${chapterIndex}` : null);
  const slug = data.slug || source.slug || (chapterIndex != null ? `${seriesSlug}/${chapterIndex}` : null);
  return {
    id: source.id ?? null,
    seriesId: source.seriesId ?? data.seriesId ?? null,
    chapterIndex,
    index: chapterIndex,
    title,
    slug,
    isDraft: Boolean(source.isDraft ?? data.isDraft ?? false),
    isRead: Boolean(source.isRead ?? false),
    images: Array.isArray(data.images) ? data.images : [],
    thumbnail: data.thumbnail ?? source.thumbnail ?? null,
    createdAt: source.createdAt ?? null,
    updatedAt: source.updatedAt ?? null,
    views: source.views ?? null,
    data,
    apiPath: chapterIndex != null ? `/series/${encodePath(seriesSlug)}/chapters/${chapterIndex}` : null,
  };
}

function normalizeChapterResponse(result, seriesSlug) {
  const items = Array.isArray(result?.data) ? result.data.map((item) => normalizeChapterItem(item, seriesSlug)) : [];
  return {
    ...result,
    data: items,
    chapters: items,
    count: items.length,
    _meta: { ...(result?._meta || {}), normalized: true, seriesSlug }
  };
}

async function commandChapters(slug, options) {
  if (!slug) die('chapters membutuhkan slug, contoh: chapters magic-emperor');
  const result = await request(`/series/${encodePath(slug)}/chapters`, { page: 1 }, options);
  const normalized = normalizeChapterResponse(result, slug);
  if (options.limit && Array.isArray(normalized.data)) {
    normalized.data = normalized.data.slice(0, options.limit);
    normalized.chapters = normalized.data;
    normalized.count = normalized.data.length;
    normalized._meta = { ...(normalized._meta || {}), limited: options.limit };
  }
  return normalized;
}

async function commandChapter(slug, chapter, options) {
  if (!slug || !chapter) die('chapter membutuhkan slug series dan nomor chapter, contoh: chapter magic-emperor 897');
  const index = positiveInt(chapter, 'chapter');
  const result = await request(`/series/${encodePath(slug)}/chapters/${index}`, {}, options);
  const item = normalizeChapterItem(result?.data, slug);
  return { ...result, data: item, chapter: item, _meta: { ...(result?._meta || {}), normalized: true, seriesSlug: slug, chapterIndex: index } };
}

async function commandBanners(options) {
  return firstWorking([
    { route: '/series/banners', query: paginatedQuery(options) },
    { route: '/series', query: seriesQuery({ ...options, preset: 'banner' }), fallbackFrom: '/series/banners' },
  ], options);
}

async function commandReadOnly(route, positionals, options, label) {
  const args = positionals;
  const required = label || route;
  if (route.includes('{slug}') && !args[0]) die(`${required} membutuhkan slug`);
  return request(route.replace('{slug}', encodePath(args[0] || '')), {}, { ...options, allowHttpError: true });
}

async function commandAnnouncements(positionals, options) {
  const route = positionals[0] ? `/announcements/${encodePath(positionals[0])}` : '/announcements';
  return request(route, {}, { ...options, allowHttpError: true });
}

async function commandChapterVisitors(positionals, options) {
  if (!positionals[0] || !positionals[1]) die('chapter-visitors membutuhkan slug dan nomor chapter');
  return request(`/analytics/series/${encodePath(positionals[0])}/chapters/${encodePath(positionals[1])}/unique-visitors`, {}, { ...options, allowHttpError: true });
}

async function commandRunExtra(command, positionals, options) {
  const paged = { ...options, allowHttpError: true };
  if (command === 'popular-all') return request('/popular/all', popularQuery(options), paged);
  if (command === 'popular-week') return request('/popular/week', popularQuery(options), paged);
  if (command === 'popular-genre') {
    if (!positionals[0]) die('popular-genre membutuhkan genre id');
    return request(`/popular/genre/${encodePath(positionals[0])}`, popularQuery(options), paged);
  }
  if (command === 'genre') {
    if (!positionals[0]) die('genre membutuhkan genre id');
    return request(`/genres/${encodePath(positionals[0])}`, {}, paged);
  }
  if (command === 'ads') return request('/ads', {}, paged);
  if (command === 'placements') return request('/placements', {}, paged);
  if (command === 'announcements' || command === 'announcement') return commandAnnouncements(positionals, options);
  if (command === 'series-views') {
    if (!positionals[0]) die('series-views membutuhkan slug');
    return request(`/series/${encodePath(positionals[0])}/unique-views`, {}, paged);
  }
  if (command === 'series-visitors') {
    if (!positionals[0]) die('series-visitors membutuhkan slug');
    return request(`/analytics/series/${encodePath(positionals[0])}/unique-visitors`, {}, paged);
  }
  if (command === 'chapter-visitors') return commandChapterVisitors(positionals, options);
  if (command === 'comments' || command === 'reactions') {
    if (!positionals[0]) die(`${command} membutuhkan slug`);
    return request(`/series/${encodePath(positionals[0])}/${command}`, {}, paged);
  }
  if (command === 'ranking') return request('/ranking', { period: 'daily' }, paged);
  const userRoutes = {
    'user-history': '/user/series/history',
    'user-bookmarks': '/user/series/bookmark',
    'user-comments': '/user/comments',
    'read-lists': '/user/read-lists',
  };
  if (userRoutes[command]) return request(userRoutes[command], paginatedQuery(options), paged);
  return null;
}

async function runCommand(command, positionals, options) {
  if (command === 'home') return commandHome(options);
  if (command === 'popular') return firstWorking([
    { route: '/popular', query: popularQuery(options) },
    { route: '/series', query: seriesQuery(options, { preset: 'popular_day' }), fallbackFrom: '/popular' },
  ], options);
  if (command === 'trending') return request('/series/trending', paginatedQuery(options), options);
  if (command === 'recommendations') return request('/series/recommendations', paginatedQuery(options), options);
  if (command === 'genres') return request('/genres', {}, options);
  if (command === 'presets') return request('/series/presets', {}, options);
  if (command === 'series') return commandSeries(positionals[0], options);
  if (command === 'detail') return commandDetail(positionals[0], options);
  if (command === 'chapters') return commandChapters(positionals[0], options);
  if (command === 'chapter') return commandChapter(positionals[0], positionals[1], options);
  if (command === 'search') return commandSearch(positionals.join(' '), options);
  if (command === 'banners') return commandBanners(options);
  const extra = await commandRunExtra(command, positionals, options);
  if (extra) return extra;

  const routes = {
    'best-manga': '/series/best-manga',
    'best-manhwa': '/series/best-manhwa',
    'best-manhua': '/series/best-manhua',
    'anime-adaptations': '/series/anime-adaptations',
    'most-bookmarked': '/series/most-bookmarked',
    'most-read': '/series/most-read',
  };
  if (routes[command]) return request(routes[command], paginatedQuery(options), options);
  die(`Command tidak dikenal: ${command}. Gunakan --help.`);
}

function serializeError(error) {
  return {
    message: error?.message || String(error),
    status: error?.status || undefined,
    route: error?.route,
    url: error?.url,
    errors: error?.errors,
  };
}

function output(result, options) {
  const json = JSON.stringify(result, null, options.json ? 0 : 2);
  if (options.save) {
    const file = path.resolve(options.save);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stderr.write(`Tersimpan: ${file}\n`);
  }
  process.stdout.write(`${json}\n`);
}

async function main() {
  const { positionals, options } = parseArgs(process.argv.slice(2));
  if (options.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return;
  }
  const [command, ...args] = positionals;
  const result = await runCommand(command, args, options);
  output(result, options);
}

main().catch((error) => {
  const payload = { status: 500, error: error.message, ...serializeError(error) };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 1;
});
