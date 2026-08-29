import assert from 'node:assert';
import * as s from '../scraper.js';

const EP_URL = 'https://donghuastream.org/a-record-of-mortals-journey-to-immortality-season-5-episode-13-ep-189-multiple-subtitles/';
const SERIES_SLUG = 'a-record-of-mortals-journey-to-immortality-season-5';

const tests = [
  ['animeList returns items with slug/url', async () => {
    const r = await s.animeList();
    assert.ok(r.total_items > 20, `expected >20 anime, got ${r.total_items}`);
    const first = r.items[0];
    assert.ok(first.slug, 'item has slug');
    assert.ok(first.url.includes('/anime/'), 'item url points to /anime/');
  }],
  ['series parses episodes', async () => {
    const r = await s.series(SERIES_SLUG);
    assert.ok(r.title, 'series has title');
    assert.ok(r.episode_count >= 1, `expected >=1 episode, got ${r.episode_count}`);
    const ep = r.episodes[0];
    assert.ok(ep.url, 'episode has url');
    assert.ok(ep.episode >= 1, 'episode number parsed');
  }],
  ['episode extracts stream', async () => {
    const r = await s.episode(EP_URL);
    assert.ok(r.title, 'episode has title');
    const hasStream = r.streams.some((u) => /dailymotion/i.test(u));
    assert.ok(hasStream, 'dailymotion stream found: ' + JSON.stringify(r.streams));
  }],
  ['episode extracts download link', async () => {
    const r = await s.episode(EP_URL);
    assert.ok(r.downloads.length >= 1, 'at least one download link');
    const dl = r.downloads[0];
    assert.ok(dl.url, 'download has url');
    assert.ok(dl.server, 'download has server');
  }],
  ['post resolves slug via REST', async () => {
    const r = await s.post(EP_URL);
    assert.ok(r.id, 'post has id');
    assert.ok(r.slug, 'post has slug');
    assert.ok(r.title, 'post has title');
  }],
];

let pass = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    pass++;
  } catch (e) {
    console.error(`FAIL: ${name}`);
    console.error('  ' + e.message);
    process.exitCode = 1;
  }
}
console.log(`\n${pass}/${tests.length} tests passed`);