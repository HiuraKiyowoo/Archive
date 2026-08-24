'use strict';

const BASE = 'https://animeinweb.com';
const PROXY = `${BASE}/api/proxy`;
const CLIENT_HEADER = 'animein-secure-proxy-key-123';
const USER_AGENT = 'animein-api-client-js/1.0';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_DELAY_MS = 250;

class ApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ApiError';
    Object.assign(this, details);
  }
}

const clean = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
};

const positiveInt = (value, label = 'ID') => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) throw new ApiError(`${label} harus berupa angka positif.`);
  return n;
};

const pageNumber = (value, fallback = 0) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const limitNumber = (value, fallback = 16) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 100);
};

const normalizeDay = (value = 'MINGGU') => {
  const day = String(value).trim().toUpperCase();
  const allowed = new Set(['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'MINGGU', 'RANDOM']);
  if (!allowed.has(day)) throw new ApiError(`day tidak valid. Pilih: ${[...allowed].join(', ')}`);
  return day;
};

const asQuery = (params = {}) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, String(item));
    } else {
      query.set(key, String(value));
    }
  }
  return query;
};

const unwrapEnvelope = (payload, url) => {
  if (!payload || typeof payload !== 'object') {
    throw new ApiError(`Respons bukan object dari ${url}.`, { url, payload });
  }
  if (payload.error || (payload.status !== undefined && Number(payload.status) !== 200)) {
    throw new ApiError(payload.message || `API error dari ${url}.`, { url, payload });
  }
  return payload.data ?? payload;
};

const summary = (value) => {
  if (Array.isArray(value)) {
    return {
      type: 'array',
      count: value.length,
      itemKeys: value[0] && typeof value[0] === 'object' ? Object.keys(value[0]) : []
    };
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = summary(item);
    return out;
  }
  return typeof value;
};

class AnimeInApiClient {
  constructor(options = {}) {
    this.base = options.base || BASE;
    this.proxy = options.proxy || `${this.base}/api/proxy`;
    this.timeout = Number(options.timeout || DEFAULT_TIMEOUT_MS);
    this.minDelayMs = Number(options.minDelayMs ?? DEFAULT_DELAY_MS);
    this.lastRequestAt = 0;
    this.clientHeader = options.clientHeader || CLIENT_HEADER;
    this.userId = clean(options.userId ?? process.env.ANIMEIN_USER_ID);
    this.keyClient = clean(options.keyClient ?? process.env.ANIMEIN_KEY_CLIENT);
    this.userAgent = options.userAgent || USER_AGENT;
  }

  async throttle() {
    const wait = this.minDelayMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }

  makeUrl(route, params = {}) {
    const target = route.startsWith('http') ? route : `${this.proxy}/${String(route).replace(/^\/+/, '')}`;
    const url = new URL(target);
    const query = asQuery(params);
    for (const [key, value] of query.entries()) url.searchParams.append(key, value);
    return url;
  }

  headers(extra = {}) {
    return {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': this.userAgent,
      Referer: `${this.base}/`,
      'x-proxy-secret': this.clientHeader,
      ...extra
    };
  }

  authBody(body = {}) {
    const out = { ...body };
    if (this.userId && this.keyClient) {
      out.id_user ??= this.userId;
      out.key_client ??= this.keyClient;
    }
    return out;
  }

  async request(method, route, options = {}) {
    await this.throttle();
    const url = this.makeUrl(route, options.params || {});
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);
    const headers = this.headers(options.headers || {});
    let body;
    if (options.body !== undefined && options.body !== null) {
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(this.authBody(options.body))) {
        if (value !== undefined && value !== null) form.set(key, String(value));
      }
      body = form.toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
        redirect: 'follow'
      });
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }
      if (!response.ok) {
        throw new ApiError(`${method} ${url} gagal (HTTP ${response.status}).`, {
          status: response.status,
          url: String(url),
          payload
        });
      }
      return { status: response.status, headers: response.headers, payload };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const message = error.name === 'AbortError' ? `timeout ${this.timeout}ms` : error.message;
      throw new ApiError(`${method} ${url} gagal: ${message}`, { cause: error, url: String(url) });
    } finally {
      clearTimeout(timeout);
    }
  }

  async get(route, params = {}) {
    const response = await this.request('GET', route, { params });
    return unwrapEnvelope(response.payload, String(this.makeUrl(route, params)));
  }

  async post(route, body = {}, options = {}) {
    if (options.allowSideEffects !== true) {
      throw new ApiError(`POST ${route} diblokir default. Gunakan { allowSideEffects: true } secara sadar.`);
    }
    const response = await this.request('POST', route, { body });
    return unwrapEnvelope(response.payload, String(this.makeUrl(route)));
  }

  routes() {
    return {
      base: this.base,
      proxy: this.proxy,
      header: 'x-proxy-secret',
      read: {
        home: '/3/2/home/data',
        schedule: '/3/2/schedule/data',
        genres: '/3/2/explore/genre',
        search: '/3/2/explore/movie',
        animeDetail: '/3/2/movie/detail/{id_movie}',
        episodes: '/3/2/movie/episode/{id_movie}',
        stream: '/3/2/episode/streamnew/{id_episode}',
        comments: '/3/2/comment/data',
        chat: '/3/2/chat/data',
        ads: '/data/ads/show',
        trailers: '/data/movie/trailer/list'
      },
      write: {
        recordStream: '/3/2/user/stream/do',
        commentAction: '/3/2/comment/action',
        commentDo: '/3/2/comment/do',
        chatDo: '/3/2/chat/do',
        adClick: '/data/ads/click'
      }
    };
  }

  async home(options = {}) {
    const day = normalizeDay(options.day || 'MINGGU');
    const limit = limitNumber(options.limit, 16);
    return this.get('/3/2/home/data', { day, limit });
  }

  async schedule(day = 'SENIN') {
    return this.get('/3/2/schedule/data', { day: normalizeDay(day) });
  }

  async genres() {
    return this.get('/3/2/explore/genre');
  }

  async search(options = {}) {
    const page = pageNumber(options.page, 0);
    const sort = clean(options.sort) || 'views';
    const keyword = options.keyword ?? options.query ?? '';
    const genreIds = Array.isArray(options.genreIds)
      ? options.genreIds.filter((id) => clean(id)).join(',')
      : clean(options.genre_in) || '';
    return this.get('/3/2/explore/movie', {
      page,
      sort,
      keyword: String(keyword),
      genre_in: genreIds
    });
  }

  async anime(id) {
    return this.get(`/3/2/movie/detail/${positiveInt(id, 'Anime ID')}`);
  }

  async episodes(id, options = {}) {
    const params = { page: pageNumber(options.page, 0) };
    if (clean(options.search)) params.search = String(options.search);
    return this.get(`/3/2/movie/episode/${positiveInt(id, 'Anime ID')}`, params);
  }

  async stream(episodeId) {
    return this.get(`/3/2/episode/streamnew/${positiveInt(episodeId, 'Episode ID')}`);
  }

  async comments(options = {}) {
    const episodeId = positiveInt(options.episodeId ?? options.id_episode, 'Episode ID');
    const sort = clean(options.sort) || 'top';
    if (!['top', 'new'].includes(sort)) throw new ApiError('sort komentar harus top atau new.');
    return this.get('/3/2/comment/data', {
      id_episode: episodeId,
      sort,
      page: pageNumber(options.page, 0)
    });
  }

  async chat(options = {}) {
    const params = {};
    if (clean(options.highestId ?? options.highest_id)) params.highest_id = options.highestId ?? options.highest_id;
    if (clean(options.lowestId ?? options.lowest_id)) params.lowest_id = options.lowestId ?? options.lowest_id;
    return this.get('/3/2/chat/data', params);
  }

  async trailers(options = {}) {
    return this.get('/data/movie/trailer/list', options);
  }

  async ads() {
    return this.get('/data/ads/show');
  }

  async recordStream(body, options = {}) {
    const payload = {
      minutes: body.minutes,
      type: body.type,
      episode_server_id: body.episode_server_id ?? body.episodeServerId
    };
    if (!payload.minutes || !payload.type || !payload.episode_server_id) {
      throw new ApiError('recordStream membutuhkan minutes, type, dan episode_server_id.');
    }
    return this.post('/3/2/user/stream/do', payload, options);
  }

  async commentAction(body, options = {}) {
    const type = String(body.type ?? '').toUpperCase();
    if (!['Y', 'N', '-'].includes(type)) throw new ApiError('type commentAction harus Y, N, atau -.');
    return this.post('/3/2/comment/action', {
      id_comment: positiveInt(body.id_comment ?? body.idComment, 'Comment ID'),
      type
    }, options);
  }

  async commentDo(body, options = {}) {
    const text = clean(body.text);
    if (!text) throw new ApiError('text komentar wajib diisi.');
    return this.post('/3/2/comment/do', {
      text,
      id_episode: positiveInt(body.id_episode ?? body.episodeId, 'Episode ID')
    }, options);
  }

  async chatDo(body, options = {}) {
    const text = clean(body.text);
    if (!text) throw new ApiError('text chat wajib diisi.');
    return this.post('/3/2/chat/do', {
      text,
      id_chat_replay: body.id_chat_replay ?? body.idChatReplay ?? 0
    }, options);
  }

  async adClick(idAds, options = {}) {
    return this.post('/data/ads/click', { id_ads: positiveInt(idAds, 'Ads ID') }, options);
  }

  async test() {
    const tests = [];
    const safe = async (name, fn) => {
      try {
        const value = await fn();
        tests.push({ name, status: 'PASS', detail: summary(value) });
        return value;
      } catch (error) {
        tests.push({ name, status: 'FAIL', detail: error.message });
        return null;
      }
    };

    await safe('routes map', async () => this.routes());
    const home = await safe('home', () => this.home({ day: 'MINGGU', limit: 2 }));
    if (home) tests.push({ name: 'home.data', status: home.hot || home.new ? 'PASS' : 'FAIL', detail: 'kategori home terdeteksi' });
    const schedule = await safe('schedule', () => this.schedule('SENIN'));
    if (schedule) tests.push({ name: 'schedule.movie', status: Array.isArray(schedule.movie) ? 'PASS' : 'FAIL', detail: `${schedule.movie?.length ?? 0} item` });
    const genres = await safe('genres', () => this.genres());
    if (genres) tests.push({ name: 'genres.genre', status: Array.isArray(genres.genre) ? 'PASS' : 'FAIL', detail: `${genres.genre?.length ?? 0} item` });
    const search = await safe('search', () => this.search({ keyword: 'conan', page: 0, sort: 'views' }));
    if (search) tests.push({ name: 'search.movie', status: Array.isArray(search.movie) ? 'PASS' : 'FAIL', detail: `${search.movie?.length ?? 0} item` });
    const anime = await safe('anime detail', () => this.anime(1755));
    if (anime) tests.push({ name: 'anime.movie', status: Boolean(anime.movie?.id) ? 'PASS' : 'FAIL', detail: anime.movie?.title || '' });
    const episodes = await safe('episodes', () => this.episodes(1755, { page: 0 }));
    if (episodes) tests.push({ name: 'episodes.episode', status: Array.isArray(episodes.episode) ? 'PASS' : 'FAIL', detail: `${episodes.episode?.length ?? 0} item` });
    const stream = await safe('stream', () => this.stream(30302));
    if (stream) tests.push({ name: 'stream.server', status: Array.isArray(stream.server) ? 'PASS' : 'FAIL', detail: `${stream.server?.length ?? 0} server` });
    const comments = await safe('comments', () => this.comments({ episodeId: 30302, page: 0 }));
    if (comments) tests.push({ name: 'comments.comment', status: Array.isArray(comments.comment) ? 'PASS' : 'FAIL', detail: `${comments.comment?.length ?? 0} item` });
    const chat = await safe('chat', () => this.chat());
    if (chat) tests.push({ name: 'chat.chat', status: Array.isArray(chat.chat) ? 'PASS' : 'FAIL', detail: `${chat.chat?.length ?? 0} item` });
    const ads = await safe('ads', () => this.ads());
    if (ads) tests.push({ name: 'ads.ad', status: Boolean(ads.ad) ? 'PASS' : 'FAIL', detail: ads.ad?.name || '' });
    const trailers = await safe('trailers', () => this.trailers());
    if (trailers) tests.push({ name: 'trailers.trailer', status: Array.isArray(trailers.trailer) ? 'PASS' : 'FAIL', detail: `${trailers.trailer?.length ?? 0} item` });

    const passed = tests.filter((test) => test.status === 'PASS').length;
    const failed = tests.filter((test) => test.status === 'FAIL').length;
    return { ok: failed === 0, passed, failed, tests };
  }
}

const getOption = (args, names, fallback = null) => {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    const index = args.indexOf(name);
    if (index >= 0 && index + 1 < args.length) return args[index + 1];
  }
  return fallback;
};

const hasFlag = (args, name) => args.includes(name);

const printJson = (value) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const usage = () => {
  console.log(`Penggunaan:
  node animein_api.js routes
  node animein_api.js home [--day MINGGU] [--limit 16]
  node animein_api.js schedule --day SENIN
  node animein_api.js genres
  node animein_api.js search --query conan [--page 0] [--sort views] [--genre-in 1,2]
  node animein_api.js anime --id 1755
  node animein_api.js episodes --id 1755 [--page 0] [--search 1209]
  node animein_api.js stream --episode-id 30302
  node animein_api.js comments --episode-id 30302 [--sort top] [--page 0]
  node animein_api.js chat [--highest-id ID] [--lowest-id ID]
  node animein_api.js trailers [--page 0] [--limit 16]
  node animein_api.js ads
  node animein_api.js test

POST eksplisit, tidak dipanggil oleh command default:
  const api = new AnimeInApiClient({ userId, keyClient });
  await api.chatDo({ text: 'halo', id_chat_replay: 0 }, { allowSideEffects: true });
`);
};

const main = async (argv = process.argv.slice(2)) => {
  const command = argv[0];
  if (!command || command === 'help' || command === '--help') return usage();

  const api = new AnimeInApiClient({
    userId: process.env.ANIMEIN_USER_ID,
    keyClient: process.env.ANIMEIN_KEY_CLIENT
  });

  let result;
  switch (command) {
    case 'routes':
      result = api.routes();
      break;
    case 'home':
      result = await api.home({ day: getOption(argv, '--day', 'MINGGU'), limit: getOption(argv, '--limit', 16) });
      break;
    case 'schedule':
      result = await api.schedule(getOption(argv, '--day', 'SENIN'));
      break;
    case 'genres':
      result = await api.genres();
      break;
    case 'search':
      result = await api.search({
        query: getOption(argv, ['--query', '-q'], ''),
        page: getOption(argv, '--page', 0),
        sort: getOption(argv, '--sort', 'views'),
        genre_in: getOption(argv, '--genre-in', '')
      });
      break;
    case 'anime':
      result = await api.anime(getOption(argv, '--id'));
      break;
    case 'episodes':
      result = await api.episodes(getOption(argv, '--id'), {
        page: getOption(argv, '--page', 0),
        search: getOption(argv, '--search', '')
      });
      break;
    case 'stream':
      result = await api.stream(getOption(argv, '--episode-id'));
      break;
    case 'comments':
      result = await api.comments({
        episodeId: getOption(argv, '--episode-id'),
        sort: getOption(argv, '--sort', 'top'),
        page: getOption(argv, '--page', 0)
      });
      break;
    case 'chat':
      result = await api.chat({
        highest_id: getOption(argv, '--highest-id', ''),
        lowest_id: getOption(argv, '--lowest-id', '')
      });
      break;
    case 'trailers':
      result = await api.trailers({
        page: getOption(argv, '--page', ''),
        limit: getOption(argv, '--limit', '')
      });
      break;
    case 'ads':
      result = await api.ads();
      break;
    case 'test':
      result = await api.test();
      break;
    default:
      throw new ApiError(`Command tidak dikenal: ${command}`);
  }
  printJson(result);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      error: error.name,
      message: error.message,
      status: error.status,
      url: error.url
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { AnimeInApiClient, ApiError, summary, BASE, PROXY };
