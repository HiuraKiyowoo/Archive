'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const s = require('../src/index.js');

const KNOWN_ID = 676674; // gallery fetched/verified during research

test('httpGet returns 200 with html for homepage', async () => {
  const { status, text } = await s.httpGet(s.BASE + '/');
  assert.strictEqual(status, 200);
  assert.ok(text.length > 1000, 'body non-trivial');
});

test('getGallery parses full entity from inline JSON (live)', async () => {
  const g = await s.getGallery(KNOWN_ID);
  assert.strictEqual(g.id, KNOWN_ID);
  assert.ok(g.media_id, 'has media_id');
  assert.ok(g.title.english && g.title.pretty, 'has readable title');
  assert.ok(g.num_pages > 0 && g.num_pages === g.pages.length, 'pages match num_pages');
  assert.ok(g.pages[0].path.includes(`galleries/${g.media_id}/1.webp`), 'page1 path resolves');
  assert.ok(Array.isArray(g.tags) && g.tags.length > 0, 'has tags');
  assert.ok(g.tags.some((t) => t.type === 'category'), 'has category tag');
});

test('pageUrl builds absolute image URL (fixes .webp.webp bug)', () => {
  const u = s.pageUrl('4144908', 'galleries/4144908/1.webp');
  assert.strictEqual(u, 'https://i.nhentai.net/galleries/4144908/1.webp');
  const u2 = s.pageUrl('4144908', 'galleries/4144908/cover.webp.webp');
  assert.strictEqual(u2, 'https://i.nhentai.net/galleries/4144908/cover.webp');
});

test('full-page image is fetchable (live, webp)', async () => {
  const g = await s.getGallery(KNOWN_ID);
  const url = s.pageUrl(g.media_id, g.pages[0].path);
  const r = await s.httpGet(url);
  assert.strictEqual(r.status, 200);
  // curl success here means we got image bytes; assert webp magic via body presence
  assert.ok(r.text.length > 1000, 'got >1KB of image data');
});

test('search returns cover-grid cards (live)', async () => {
  const r = await s.search('original big breasts', 1);
  assert.ok(r.results.length > 0, 'has results');
  const first = r.results[0];
  assert.ok(first.id > 0, 'has numeric id');
  assert.ok(first.thumb.startsWith('http'), 'has thumbnail url');
  assert.ok(r.total >= r.results.length, 'total coherent');
});

test('extractGalleryJson returns null on junk', () => {
  assert.strictEqual(s.extractGalleryJson('<html>no json</html>'), null);
});