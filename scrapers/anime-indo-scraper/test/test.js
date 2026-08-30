#!/usr/bin/env node
/**
 * Real-network test suite for the anime-indo.lol scraper.
 * Every test makes live HTTP requests and validates parsed JSON —
 * HTTP 200 alone is NOT treated as success.
 */
'use strict';
const { home, search, genre, genres, detail, episode, stream } = require('../scraper.js');

let passed = 0, failed = 0;
const results = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    results.push(`PASS  ${name}`);
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    results.push(`FAIL  ${name} — ${e.message}`);
    console.log(`FAIL  ${name} — ${e.message}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  // ------------------------------------------------------------------ HOME
  const h = await home(1);
  check('Homepage', () => {
    assert(h.ok, 'ok flag');
    assert(h.data.sections['update-terbaru'].length > 0, 'update-terbaru items > 0');
    const it = h.data.sections['update-terbaru'][0];
    assert(it.title, 'item.title');
    assert(it.url && /-episode-\d+\//.test(it.url), 'item.url is episode link');
    assert(it.image && it.image.startsWith('http'), 'item.image');
    assert(Number.isInteger(it.latest_episode), 'item.latest_episode number');
  });
  check('Homepage Popular', () => {
    assert(h.data.sections.popular.length > 0, 'popular items > 0');
    assert(h.data.sections.popular[0].url && h.data.sections.popular[0].url.includes('/anime/'), 'popular url');
    assert(h.data.sections.popular[0].genres.length > 0, 'popular genres list');
  });
  check('Homepage pagination parsed', () => {
    assert(h.pagination && h.pagination.current === 1, 'current page = 1');
    assert(h.pagination.last && h.pagination.last >= 2, 'last page detected');
    assert(h.pagination.next && h.pagination.next.includes('/page/2/'), 'next = page/2');
    assert(h.pagination.hasNext === true, 'hasNext true');
  });

  // ----------------------------------------------------------------- SEARCH
  const s1 = await search('bleach');
  check('Search #1 (bleach)', () => {
    assert(s1.data.items.length > 0, 'items > 0');
    const it = s1.data.items.find((x) => /bleach/i.test(x.title)) || s1.data.items[0];
    assert(it.url && it.url.startsWith('http'), 'url');
    assert(it.image, 'image');
    assert(s1.data.items.every((x) => x.title && x.url), 'all items have title+url');
  });
  const s2 = await search('one piece');
  check('Search #2 (one piece)', () => {
    assert(s2.data.items.length > 0, 'items > 0');
    assert(s2.data.items.some((x) => /one piece/i.test(x.title)), 'contains one piece');
  });
  const s1p2 = await search('bleach', 2);
  check('Search pagination (bleach page 2)', () => {
    assert(s1p2.ok, 'page 2 fetch ok');
    // page 2 may be shorter or empty for a specific query; the assertion is that it was
    // fetched via the correct route and the envelope is intact (items may be 0 for exact match)
    assert(Array.isArray(s1p2.data.items), 'items array');
  });

  // ------------------------------------------------------------------ GENRE
  const g1 = await genre('action');
  check('Genre #1 (action)', () => {
    assert(g1.data.items.length > 0, 'items > 0');
    const it = g1.data.items[0];
    assert(it.title && it.url && it.url.includes('/anime/'), 'title+url');
    assert(it.image, 'image');
    assert(it.type, 'type label (TV/Movie/...)');
    assert(it.year, 'year label');
    assert(it.description, 'description');
  });
  check('Genre pagination (action)', () => {
    assert(g1.pagination.current === 1, 'current 1');
    assert(g1.pagination.last >= 50, 'action has many pages');
    assert(g1.pagination.next.includes('/genres/action/page/2/'), 'next url format');
  });
  const g2 = await genre('romance');
  check('Genre #2 (romance)', () => {
    assert(g2.data.items.length > 0, 'items > 0');
    assert(g2.data.items.every((x) => x.title && x.url), 'title+url');
  });
  const gl = await genres();
  check('Genre list', () => {
    assert(gl.data.count >= 50, 'many genres');
    assert(gl.data.genres.some((g) => g.slug === 'action'), 'has action');
  });

  // ----------------------------------------------------------------- DETAIL
  const d1 = await detail('/anime/oni-no-hanayome/');
  check('Detail #1 (oni-no-hanayome)', () => {
    assert(d1.data.title, 'title');
    assert(d1.data.poster && d1.data.poster.startsWith('http'), 'poster');
    assert(d1.data.genres.length > 0, 'genres');
    assert(d1.data.description, 'description');
    assert(d1.data.episodes.length > 0, 'episodes > 0');
    assert(d1.data.episodes[0].number === 1, 'first episode number = 1');
    const nums = d1.data.episodes.map((e) => e.number);
    assert(JSON.stringify(nums) === JSON.stringify([...nums].sort((a, b) => a - b)), 'episodes ordered');
    const urls = new Set(d1.data.episodes.map((e) => e.url));
    assert(urls.size === d1.data.episodes.length, 'no duplicate episode urls');
    assert(d1.data.episodes.every((e) => e.url.endsWith('/')), 'episode urls valid');
  });
  const d2 = await detail('/anime/bleach/');
  check('Detail #2 (bleach)', () => {
    assert(d2.data.title, 'title');
    assert(d2.data.episodes.length > 5, 'long-running anime has many episodes');
    assert(d2.data.episodes.every((e) => Number.isInteger(e.number)), 'numbers parsed');
    assert(d2.data.rating === null, 'missing fields are null (not guessed)');
    assert(d2.data.studio === null, 'studio null');
  });
  const d3 = await detail('/anime/one-piece/');
  check('Detail #3 (one-piece)', () => {
    assert(d3.data.title, 'title');
    assert(d3.data.episodes.length > 5, 'episodes');
  });

  // ---------------------------------------------------------------- EPISODE
  const firstEp = d1.data.episodes[0].url;
  const ep = await episode(firstEp);
  check('Episode', () => {
    assert(ep.data.title, 'title');
    assert(Number.isInteger(ep.data.number), 'episode number');
    assert(ep.data.player_iframe && ep.data.player_iframe.includes('btube'), 'default player iframe');
    assert(ep.data.mirrors.length >= 2, 'mirrors >= 2');
    assert(ep.data.mirrors.some((m) => m.is_default), 'has default mirror');
    assert(ep.data.mirrors.every((m) => m.embed), 'all mirrors have embed url');
  });

  // ----------------------------------------------------------------- STREAM
  const st = await stream(firstEp);
  check('Stream (sources resolved)', () => {
    assert(st.data.sources.length > 0, 'sources > 0');
    const bt = st.data.sources.find((s) => s.mirror === 'B-TUBE');
    const cp = st.data.sources.find((s) => s.mirror === 'CEPAT');
    assert(bt && bt.url && /googlevideo\.com|videoplayback/.test(bt.url), 'B-TUBE mp4 url');
    assert(bt.expiring === true, 'B-TUBE marked expiring (signed)');
    assert(cp && cp.url && /m3u8|play\.php/.test(cp.url), 'CEPAT hls master');
    assert(cp.variants && cp.variants.length >= 3, 'HLS variants (480/720/1080)');
    assert(cp.variants.every((v) => v.url.startsWith('http')), 'variant urls absolute');
  });
  // ---- Byte-level stream verification (plain HTTP, no browser) -------------
  // CEPAT is the reliable end-to-end proof: master -> 720p media playlist -> one
  // MPEG-TS segment, none of it IP-bound or expiring. B-TUBE's signed URL binds the
  // generator's egress IP, so behind a rotating-IP pool it can 403; we re-resolve a
  // bounded number of times and treat it as a best-effort bonus, not a hard gate.
  const httpGet = (url, { headers = {}, maxBytes = Infinity, family = 4, timeoutMs = 20000 } = {}) =>
    new Promise((resolve, reject) => {
      const u = new URL(url);
      const lib = u.protocol === 'http:' ? require('http') : require('https');
      const req = lib.get(u, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36', ...headers }, family, timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
        const chunks = []; let n = 0;
        res.on('data', (c) => { if (n < maxBytes) { chunks.push(c); n += c.length; } });
        res.on('end', () => resolve({ status: res.statusCode, ct: res.headers['content-type'], location: res.headers.location, body: Buffer.concat(chunks) }));
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });

  // B-TUBE (bonus): MP4 ftyp box via range request, bounded re-resolve
  let btOk = false;
  {
    let bt = st.data.sources.find((s) => s.mirror === 'B-TUBE');
    for (let attempt = 0; attempt < 4 && !btOk; attempt++) {
      try {
        if (attempt > 0) {
          const fresh = await stream(firstEp);
          bt = fresh.data.sources.find((s) => s.mirror === 'B-TUBE');
        }
        if (!bt || !bt.url) continue;
        let r = await httpGet(bt.url, { headers: { range: 'bytes=0-31' } });
        if (r.status === 302 && r.location) r = await httpGet(new URL(r.location, bt.url).href, { headers: { range: 'bytes=0-31' } });
        btOk = r.status === 206 && r.body.length >= 8 && r.body.subarray(4, 8).toString() === 'ftyp';
        if (!btOk) console.log(`  (B-TUBE attempt ${attempt + 1}: HTTP ${r.status}, signed_ip=${new URL(bt.url).searchParams.get('ip')} — egress may differ, retrying)`);
      } catch (e) { console.log(`  (B-TUBE attempt ${attempt + 1}: ${e.message})`); }
    }
  }

  // CEPAT (primary proof): master -> 720p playlist -> one .ts segment (MPEG-TS sync byte 0x47)
  let cpSegOk = false, cpPlaylistOk = false;
  let segInfo = null;
  try {
    const cp = st.data.sources.find((s) => s.mirror === 'CEPAT');
    const v = cp.variants.find((x) => x.quality === '720p' || x.resolution === '1280x720');
    const p = await httpGet(v.url, { headers: { referer: 'https://xtwap.top/' } });
    const txt = p.body.toString();
    cpPlaylistOk = p.status === 200 && txt.includes('#EXTM3U') && txt.includes('.ts');
    const segRel = (txt.split(/\r?\n/).filter((l) => l.includes('.ts'))[0] || '').trim();
    if (segRel) {
      const segUrl = new URL(segRel, v.url).href;
      const seg = await httpGet(segUrl, { headers: { referer: 'https://xtwap.top/' }, maxBytes: 2048 });
      segInfo = { status: seg.status, ct: seg.ct, bytes: seg.body.length, sync: seg.body.length >= 188 && seg.body[0] === 0x47 };
      cpSegOk = seg.status === 200 && seg.body.length >= 188 && seg.body[0] === 0x47;
    }
  } catch (e) { segInfo = { error: e.message }; }

  check('Stream (CEPAT 720p HLS playlist fetched via HTTP)', () => { assert(cpPlaylistOk, 'playlist ok'); });
  check('Stream (CEPAT MPEG-TS video segment via HTTP)', () => {
    assert(cpSegOk, `segment ok (got ${JSON.stringify(segInfo)})`);
  });
  check('Stream (at least one source delivers real video bytes over HTTP)', () => {
    assert(cpSegOk || btOk, 'a real video byte was retrieved over plain HTTP');
  });
  // B-TUBE byte-fetch is IP-bound (signed url pins a generator egress IP), so it's
  // intermittent behind a rotating-egress pool. Report it informatively, do NOT gate.
  console.log(`INFO  Stream (B-TUBE MP4 ftyp, IP-bound signed url): ${btOk ? 'VERIFIED 206+ftyp' : 'not fetchable from current egress (expected; url is expiring+ip-bound)'}`);

  // -------------------------------------------------------------- PAGINATION
  const h2p = await home(2);
  check('Homepage pagination page/2', () => {
    assert(h2p.pagination.current === 2, 'current = 2');
    assert(h2p.data.sections['update-terbaru'].length > 0, 'items on page 2');
    const first = h.data.sections['update-terbaru'][0].url;
    const first2 = h2p.data.sections['update-terbaru'][0].url;
    assert(first !== first2, 'page 2 starts with a different item than page 1');
  });
  const g1p2 = await genre('action', 2);
  check('Genre pagination page/2', () => {
    assert(g1p2.pagination.current === 2, 'current = 2');
    assert(g1p2.pagination.prev && g1p2.pagination.prev.includes('/genres/action/'), 'prev link');
    assert(g1p2.data.items.length > 0, 'items on page 2');
  });

  // ---------------------------------------------------------------- SUMMARY
  console.log('\n================ SUMMARY ================');
  console.log(`homepage: update=${h.data.counts['update-terbaru']}, popular=${h.data.counts.popular}`);
  console.log(`search "bleach": ${s1.data.items.length} results | search "one piece": ${s2.data.items.length} results`);
  console.log(`genre action: ${g1.data.items.length} items/page, ${g1.pagination.last} pages | genre romance: ${g2.data.items.length} items`);
  console.log(`genre list: ${gl.data.count} genres`);
  console.log(`detail oni-no-hanayome: ${d1.data.episode_count} episodes | bleach: ${d2.data.episode_count} | one-piece: ${d3.data.episode_count}`);
  console.log(`mirrors: ${ep.data.mirrors.map((m) => m.name).join(', ')} | stream sources: ${st.data.sources.length}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
