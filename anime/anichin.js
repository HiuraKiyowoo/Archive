#!/usr/bin/env node
/**
 * anichin.moe scraper — structured homepage → detail → episode/stream
 *
 * Usage:
 *   node anichin.js home                 # scrape homepage only
 *   node anichin.js detail <url>         # scrape one detail page
 *   node anichin.js stream <url>         # scrape one episode/stream page
 *   node anichin.js all                  # home -> sample details -> one stream
 */
'use strict';

const cheerio = require('cheerio');
const { writeFileSync, mkdirSync, existsSync } = require('fs');
const path = require('path');

const BASE = 'https://anichin.moe';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const OUT_DIR = path.join(__dirname, 'output');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

/* ----------------------------- HTTP helpers ----------------------------- */

async function fetchHtml(url, referer) {
  const headers = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
  };
  if (referer) headers['Referer'] = referer;
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const abs = (u) => (u ? (u.startsWith('http') ? u : BASE + u) : null);

const clean = (s) =>
  (s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const cleanP = (s) => (s || '').replace(/\s+/g, ' ').trim();

/* ------------------------------ HOME section ----------------------------- */

/**
 * Parse a single homepage "card" (article.bs / .bsx).
 * Used by Terpopuler, Rilisan Terbaru, Movie, Upcoming, Dropped, Rekomendasi.
 */
function parseBsCard($, el) {
  const $el = $(el);
  const $a = $el.find('a').first();
  const $img = $el.find('.limit img').first();
  // .tt is: <short-title> <h2>full-title</h2> -> take the first text node
  const title =
    cleanP($el.find('.tt').contents().first().text()) ||
    cleanP($el.find('.tt h2').text()) ||
    cleanP($a.attr('title'));
  return {
    title,
    url: abs($a.attr('href')),
    image: $img.attr('src') || $img.attr('data-src') || null,
    metadata: {
      type: cleanP($el.find('.typez').text()) || null, // Donghua / Movie
      status: cleanP($el.find('.epx').text()) || null, // Ongoing / Ep 10 / Movie / Tamat
      sub: cleanP($el.find('.sb').text()) || null, // Sub
      hot: $el.find('.hotbadge').length > 0,
      completed: cleanP($el.find('.status').text()) || null, // Completed badge
    },
  };
}

/** Extract a section's cards from a .listupd container. */
function parseListupd($, $container) {
  const cards = [];
  $container.find('article.bs').each((i, el) => {
    cards.push(parseBsCard($, el));
  });
  return cards;
}

/**
 * Scrape the homepage, organised into sections.
 * Returns { url, title, sections: [{ name, items }] }
 */
async function scrapeHome() {
  const html = await fetchHtml(BASE);
  const $ = cheerio.load(html);
  const sections = [];

  /* 1) Jadwal Rilis (schedule) — day blocks with series links */
  const schedule = [];
  $('.box_schh .listSchh, .container.schedule .listSchh').each((i, el) => {
    const $el = $(el);
    const day = cleanP($el.find('h2').first().text());
    const links = [];
    $el.find('.subSchh a').each((j, a) => {
      links.push({
        label: cleanP($(a).text()).replace(/^\[[^\]]*\]\s*/, ''), // strip [SVIP] etc
        badge: (cleanP($(a).text()).match(/^\[([^\]]*)\]/) || [])[1] || null,
        url: abs($(a).attr('href')),
      });
    });
    if (day) schedule.push({ day, items: links });
  });
  if (schedule.length) sections.push({ name: 'Jadwal Rilis', items: schedule });

  /* 2) Featured slider */
  const featured = [];
  $('#slidertwo .swiper-slide.item').each((i, el) => {
    const $el = $(el);
    const style = $el.find('.backdrop').attr('style') || '';
    const m = style.match(/url\(['"]?(.*?)['"]?\)/);
    featured.push({
      title: cleanP($el.find('.info h2 a').text()),
      url: abs($el.find('.info h2 a').attr('href') || $el.find('a.watch').attr('href')),
      image: m ? m[1] : null,
      description: cleanP($el.find('.info p').text()).slice(0, 400),
    });
  });
  if (featured.length) sections.push({ name: 'Featured (Slider)', items: featured });

  /* 3) Terpopuler Hari Ini */
  const pop = parseListupd($, $('.releases.hothome').next('.listupd').length ? $('.releases.hothome').next('.listupd') : $('.bixbox').filter((i, el) => cleanP($(el).find('.releases h2, .releases h3').first().text()).toLowerCase().includes('terpopuler')).first().find('.listupd'));
  if (pop.length) sections.push({ name: 'Terpopuler Hari Ini', items: pop });

  /* 4-8) Named sections: Rilisan Terbaru, Movie, Upcoming, Dropped, Rekomendasi, Blog */
  const namedMap = [
    ['rilisan terbaru', 'Rilisan Terbaru'],
    ['movie', 'Movie'],
    ['upcoming', 'Upcoming Donghua'],
    ['dropped', 'Dropped Project'],
    ['rekomendasi', 'Rekomendasi'],
    ['blog terbaru', 'Blog Terbaru'],
  ];
  $('.bixbox.bbnofrm').each((i, el) => {
    const $el = $(el);
    const h = cleanP($el.find('.releases h2, .releases h3').first().text()).toLowerCase();
    if (!h) return;
    const found = namedMap.find(([key]) => h.includes(key));
    if (!found) return;
    const [key, name] = found;

    if (key === 'rekomendasi') {
      // Rekomendasi has genre tabs
      const tabs = [];
      $el.find('.series-gen .nav-tabs li').each((j, li) => {
        const $li = $(li);
        const tabName = cleanP($li.text());
        const target = $li.find('a').attr('href');
        const pane = $(target || '');
        tabs.push({
          name: tabName,
          items: pane.length ? parseListupd($, pane) : [],
        });
      });
      // fallback: parse all visible listupd under the section
      if (!tabs.length) {
        const items = parseListupd($, $el.find('.listupd'));
        sections.push({ name, items });
      } else {
        sections.push({ name, tabs });
      }
      return;
    }

    if (key === 'blog terbaru') {
      const blogs = [];
      $el.find('.bloglist .blogbox').each((j, b) => {
        const $b = $(b);
        blogs.push({
          title: cleanP($b.find('.entry-title a').text()),
          url: abs($b.find('.entry-title a').attr('href')),
          image: $b.find('.thumb img').attr('src') || null,
          excerpt: cleanP($b.find('.entry-content').text()).slice(0, 300),
          author: cleanP($b.find('.author .fn').text()) || null,
          date: cleanP($b.find('time').text()) || null,
        });
      });
      if (blogs.length) sections.push({ name, items: blogs });
      return;
    }

    const items = parseListupd($, $el.find('.listupd'));
    if (items.length) sections.push({ name, items });
  });

  /* 9) Sidebar widgets */
  const sidebar = {};
  $('#sidebar .section, #sidebar .widget').each((i, el) => {
    const $el = $(el);
    const h = cleanP($el.find('h3').first().text());

    if (h.toLowerCase().includes('ongoing series')) {
      const items = [];
      $el.find('.ongoingseries ul li a').each((j, a) => {
        items.push({
          title: cleanP($(a).find('.l').text()),
          episode: cleanP($(a).find('.r').text()) || null,
          url: abs($(a).attr('href')),
        });
      });
      sidebar['Ongoing Series'] = items;
    } else if (h.toLowerCase().includes('donghua paling populer')) {
      const tabs = [];
      const tabNames = $el.find('.ts-wpop-tab').map((x, t) => cleanP($(t).text())).get();
      $el.find('#wpop-items .wpop').each((j, pane) => {
        const items = [];
        $(pane).find('ul li').each((k, li) => {
          const $li = $(li);
          items.push({
            rank: cleanP($li.find('.ctr').text()) || null,
            title: cleanP($li.find('.leftseries h4 a').text()) || cleanP($li.find('.leftseries a').first().text()),
            url: abs($li.find('.leftseries h4 a, .leftseries a').first().attr('href')),
            image: $li.find('.imgseries img').attr('src') || null,
            genres: $li.find('.leftseries span a[rel="tag"], .leftseries span a').map((x, g) => cleanP($(g).text())).get(),
            score: cleanP($li.find('.numscore').text()) || cleanP($li.find('.score').text()) || null,
          });
        });
        const cls = ($(pane).attr('class') || '').match(/wpop-(\w+)/);
        const range = cls ? cls[1] : '';
        const name = range && tabNames.length ? tabNames[['weekly', 'monthly', 'alltime'].indexOf(range)] || range : range;
        tabs.push({ name, items });
      });
      sidebar['Donghua Paling Populer'] = tabs.length ? tabs : (sidebar['Donghua Paling Populer'] || []);
    } else if (h.toLowerCase().includes('donghua baru')) {
      const items = [];
      $el.find('.serieslist li').each((j, li) => {
        const $li = $(li);
        items.push({
          title: cleanP($li.find('.leftseries h4 a').text()) || cleanP($li.find('.leftseries a').first().text()),
          url: abs($li.find('.leftseries h4 a, .leftseries a').first().attr('href')),
          image: $li.find('.imgseries img').attr('src') || null,
          genres: $li.find('.leftseries span a[rel="tag"], .leftseries span a').map((x, g) => cleanP($(g).text())).get(),
          studio: $li.find('.leftseries span:last').text().replace(/^[^:]*:/, '').trim() || null,
        });
      });
      sidebar['Donghua Baru'] = items;
    } else if (h.toLowerCase().includes('movie baru')) {
      const items = [];
      $el.find('.serieslist li').each((j, li) => {
        const $li = $(li);
        items.push({
          title: cleanP($li.find('.leftseries h4 a').text()) || cleanP($li.find('.leftseries a').first().text()),
          url: abs($li.find('.leftseries h4 a, .leftseries a').first().attr('href')),
          image: $li.find('.imgseries img').attr('src') || null,
          genres: $li.find('.leftseries span a[rel="tag"], .leftseries span a').map((x, g) => cleanP($(g).text())).get(),
          date: $li.find('.leftseries span:last').text().replace(/^[^:]*:/, '').trim() || null,
        });
      });
      sidebar['Movie Baru'] = items;
    }
  });

  for (const [name, items] of Object.entries(sidebar)) {
    if (items && items.length) sections.push({ name, items });
  }

  return {
    url: BASE,
    title: cleanP($('title').text()),
    sections,
  };
}

/* ------------------------------ DETAIL ------------------------------ */

/**
 * Scrape a detail page (series or movie).
 * Returns { url, title, poster, bigcover, rating, followers, alternativeNames,
 *           info{}, genres[], tags[], description, synopsis, episodes[], download[] }
 */
async function scrapeDetail(url) {
  const html = await fetchHtml(url, BASE);
  const $ = cheerio.load(html);

  const poster =
    $('.thumbook .thumb img').attr('src') ||
    $('.single-info .thumb img').attr('src') ||
    $('.bigcover .ime img').attr('src') ||
    null;
  const bigcover = $('.bigcover .ime img').attr('src') || null;

  // rating
  const ratingEl = $('.rt .rating strong').first();
  const ratingText = cleanP(ratingEl.text());
  const ratingValue = $('meta[itemprop="ratingValue"]').attr('content') || null;
  const ratingCount = $('meta[itemprop="ratingCount"]').attr('content') || null;

  // info fields: Status, Network, Studio, Tanggal rilis, Durasi, Season, Negara, Tipe, Episode, ...
  const info = {};
  $('.spe span, .info-content .spe span').each((i, s) => {
    const $s = $(s);
    const b = cleanP($s.find('b').first().text()).replace(/:$/, '');
    if (b) {
      $s.find('b').first().remove();
      info[b] = cleanP($s.text());
    }
  });

  const genres = $('.genxed a').map((i, g) => ({
    name: cleanP($(g).text()),
    url: abs($(g).attr('href')),
  })).get();

  const tags = $('.bottom.tags a').map((i, t) => ({
    name: cleanP($(t).text()),
    url: abs($(t).attr('href')),
  })).get();

  const description = cleanP($('.infox .desc').first().text()) || null;

  const synopsis =
    cleanP($('.synp .entry-content').first().text()) ||
    cleanP($('meta[property="og:description"]').attr('content')) ||
    null;

  // episodes
  const episodes = [];
  $('.eplister ul li').each((i, li) => {
    const $li = $(li);
    const $a = $li.find('a').first();
    episodes.push({
      number: cleanP($li.find('.epl-num').text()) || null,
      title: cleanP($li.find('.epl-title').text()) || null,
      sub: cleanP($li.find('.epl-sub').text()) || null,
      date: cleanP($li.find('.epl-date').text()) || null,
      url: abs($a.attr('href')),
    });
  });

  // download links (movie pages etc.)
  const download = [];
  $('.download a, .soraurlx a, .sorabox a').each((i, a) => {
    download.push({
      label: cleanP($(a).text()),
      url: abs($(a).attr('href')),
    });
  });

  return {
    url,
    title: cleanP($('h1.entry-title').first().text()) || cleanP($('meta[property="og:title"]').attr('content')),
    poster,
    bigcover,
    rating: {
      text: ratingText || (ratingValue ? `Rating ${ratingValue}` : null),
      value: ratingValue,
      count: ratingCount,
    },
    followers: cleanP($('.bmc').text()) || null,
    alternativeNames: cleanP($('.alter').first().text()) || null,
    info,
    genres,
    tags,
    description,
    synopsis,
    episodes,
    download,
  };
}

/* ------------------------------ STREAM ------------------------------ */

/**
 * Follow one hop in the iframe chain and return {url, type}.
 * type: 'page' | 'iframe-embed'
 */
async function followStream(url, referer) {
  const html = await fetchHtml(url, referer || BASE);
  const $ = cheerio.load(html);
  // direct iframe child
  const iframe = $('iframe[src]').first().attr('src');
  if (iframe) return { pageUrl: url, iframeSrc: abs(iframe) };

  // also try meta refresh or redirect patterns
  const m = html.match(/<meta\s+http-equiv=["']refresh["'][^>]*content=["']\d+;\s*url=([^"']+)/i);
  if (m) return { pageUrl: url, iframeSrc: abs(m[1]) };

  return { pageUrl: url, iframeSrc: null };
}

/**
 * Extract HLS URL from Ok.ru video embed page.
 */
function extractOkRuStream(html) {
  // The data is in a complex escaped format inside a data-options attribute
  // Pattern: hlsManifestUrl\&quot;:\&quot;URL\&quot;
  const m = html.match(/hlsManifestUrl\\&quot;:\\&quot;(.*?)\\&quot;/);
  if (m) {
    let url = m[1];
    url = url.replace(/\\\\u0026/g, '&');
    url = url.replace(/\\u0026/g, '&');
    return { url, type: 'hls' };
  }
  // also try videoSrc
  const m2 = html.match(/\\&quot;videoSrc\\&quot;:\\&quot;(.*?)\\&quot;/);
  if (m2) {
    return { url: m2[1], type: 'videoSrc' };
  }
  return null;
}

/**
 * Scrape an episode page's stream sources.
 * Returns {
 *   url, title,
 *   player: { iframe, mirrors: [{name, iframe, src}] },
 *   chain: [{ pageUrl, iframeSrc, resolved? }]
 * }
 */
async function scrapeStream(url) {
  const html = await fetchHtml(url, BASE);
  const $ = cheerio.load(html);

  const title = cleanP($('h1.entry-title').first().text()) || cleanP($('title').text());

  // main player iframe
  const mainIframe = $('.player-embed iframe[src], #embed_holder iframe[src]').first().attr('src') || null;

  // mirror servers (base64-encoded iframe HTML)
  const mirrors = [];
  $('.mirror option').each((i, opt) => {
    const $opt = $(opt);
    const val = $opt.attr('value');
    const name = cleanP($opt.text());
    if (!val) return;
    let decoded = null;
    let src = null;
    try {
      decoded = Buffer.from(val, 'base64').toString('utf-8');
      const m = decoded.match(/src="([^"]+)"/);
      src = m ? m[1] : null;
    } catch (e) {
      /* ignore */
    }
    mirrors.push({ name, iframeHtml: decoded, src: abs(src) });
  });

  // Follow chain: episode -> /stream/<token> -> external player -> final embed
  const chain = [];
  let current = abs(mainIframe);
  let referer = url;
  const seen = new Set();
  let depth = 0;
  while (current && !seen.has(current) && depth < 4) {
    seen.add(current);
    try {
      const hop = await followStream(current, referer);
      chain.push({ url: current, next: hop.iframeSrc, type: 'iframe' });
      current = hop.iframeSrc;
      referer = current || referer;
    } catch (e) {
      chain.push({ url: current, error: e.message });
      break;
    }
    depth += 1;
  }

  // Extract direct HLS/video sources when the chain lands on an Ok.ru embed page
  const resolvedStreams = [];
  for (const hop of chain) {
    if (hop.error) continue;
    if (/ok\.ru\/videoembed/.test(hop.url)) {
      try {
        const embedHtml = await fetchHtml(hop.url, referer || url);
        const s = extractOkRuStream(embedHtml);
        if (s) resolvedStreams.push({ host: 'ok.ru', ...s });
      } catch (e) {
        /* skip */
      }
    }
  }

  return { url, title, player: { iframe: abs(mainIframe), mirrors }, chain, resolvedStreams };
}

/* ------------------------------ CLI / pipeline ------------------------------ */

async function main() {
  const [cmd, arg] = process.argv.slice(2);

  if (cmd === 'home') {
    const home = await scrapeHome();
    write('home.json', home);
    console.log(JSON.stringify(home, null, 2));
    return;
  }

  if (cmd === 'detail') {
    if (!arg) throw new Error('Usage: node anichin.js detail <url>');
    const d = await scrapeDetail(arg);
    write('detail.json', d);
    console.log(JSON.stringify(d, null, 2));
    return;
  }

  if (cmd === 'stream') {
    if (!arg) throw new Error('Usage: node anichin.js stream <url>');
    const s = await scrapeStream(arg);
    write('stream.json', s);
    // summary only (full data is in the file; avoids echoing signed CDN URLs to stdout)
    console.log(
      JSON.stringify({
        url: s.url,
        title: s.title,
        playerIframe: s.player && s.player.iframe,
        mirrors: (s.player && s.player.mirrors || []).map((m) => m.name),
        chain: s.chain.map((c) => ({ url: c.url, next: c.next ? '→' + new URL(c.next).host : null, error: c.error || null })),
        resolvedStreams: (s.resolvedStreams || []).map((r) => ({ host: r.host, type: r.type })),
      }, null, 2)
    );
    return;
  }

  if (cmd === 'all') {
    const out = await runAll();
    write('all.json', out);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  throw new Error(
    'Usage: node anichin.js {home|detail <url>|stream <url>|all}'
  );
}

/**
 * Full pipeline: home -> pick sample detail pages -> stream from first episode.
 * Keeps scraping bounded (does not crawl the whole site).
 */
async function runAll() {
  const home = await scrapeHome();

  // Collect candidate detail links from several sections (dedupe, skip episode/blog pages)
  const candidates = [];
  const push = (items) => {
    for (const it of items || []) {
      if (!it.url) continue;
      if (/\/(blog|upcoming|drop|network|studio|genres|country|season)\//.test(it.url)) continue;
      if (/-episode-|episode-\d+/.test(it.url)) continue; // episode pages -> pick the series page instead
      if (candidates.some((c) => c.url === it.url)) continue;
      candidates.push(it);
    }
  };

  for (const sec of home.sections) {
    if (sec.name === 'Jadwal Rilis') continue; // only day links
    if (sec.name === 'Featured (Slider)') {
      push(sec.items);
    } else if (sec.items && sec.items.length) {
      push(sec.items);
    } else if (sec.tabs) {
      for (const t of sec.tabs) push(t.items);
    }
  }

  // Normalise: series detail pages often end with a trailing slug without "-episode-"
  const seriesCandidates = candidates.filter((c) => !/-episode-\d+/.test(c.url));
  const sampleUrls = [...new Set(seriesCandidates.slice(0, 8).map((c) => c.url))];

  const details = [];
  const errors = [];
  for (const u of sampleUrls) {
    try {
      details.push(await scrapeDetail(u));
    } catch (e) {
      errors.push({ url: u, error: e.message });
    }
  }

  // stream: first available episode of the first successful detail
  let stream = null;
  for (const d of details) {
    if (d.episodes && d.episodes.length) {
      try {
        stream = await scrapeStream(d.episodes[0].url);
      } catch (e) {
        stream = { error: e.message, episode: d.episodes[0].url };
      }
      break;
    }
  }

  return { home, sampleCount: sampleUrls.length, details, errors, stream };
}

function write(name, obj) {
  const p = path.join(OUT_DIR, name);
  writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8');
  return p;
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
