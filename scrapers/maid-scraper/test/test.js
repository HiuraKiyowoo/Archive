import assert from 'node:assert';
import * as s from '../scraper.js';

const SERIES_SLUG = 'furoufushi-shoujo-no-naedoko-ryokouki';
const CHAPTER_URL =
  'https://www.maid.my.id/furoufushi-shoujo-no-naedoko-ryokouki-chapter-22-2-bahasa-indonesia/';

const tests = [
  ['home returns manga with latest chapters', async () => {
    const r = await s.home();
    assert.ok(r.total_items >= 1, `expected >=1 manga, got ${r.total_items}`);
    const first = r.items[0];
    assert.ok(first.title, 'item has title');
    assert.ok(first.url.includes('/manga/'), 'item url points to /manga/');
    assert.ok(first.chapters.length >= 1, 'item has at least one chapter');
  }],
  ['mangaList returns items with slug/url', async () => {
    const r = await s.mangaList({ maxPages: 2 });
    assert.ok(r.total_items >= 10, `expected >=10 manga, got ${r.total_items}`);
    const first = r.items[0];
    assert.ok(first.slug, 'item has slug');
    assert.ok(first.url.includes('/manga/'), 'item url points to /manga/');
  }],
  ['series parses metadata + chapters', async () => {
    const r = await s.series(SERIES_SLUG);
    assert.ok(r.title, 'series has title');
    assert.ok(r.poster, 'series has poster');
    assert.ok(r.chapter_count >= 1, `expected >=1 chapter, got ${r.chapter_count}`);
    assert.ok(r.genres.length >= 1, 'series has genres');
    const ch = r.chapters[0];
    assert.ok(ch.url, 'chapter has url');
    assert.ok(ch.label, 'chapter has label');
  }],
  ['chapter extracts images', async () => {
    const r = await s.chapter(CHAPTER_URL);
    assert.ok(r.title, 'chapter has title');
    assert.ok(r.image_count >= 1, `expected >=1 image, got ${r.image_count}`);
    const img = r.images[0];
    assert.ok(img.url.startsWith('http'), 'image url is absolute');
    assert.ok(/cdn\.imgchest\.com/i.test(img.url), 'image from imgchest CDN');
  }],
  ['search returns manga', async () => {
    const r = await s.search('solo');
    assert.ok(r.total_items >= 1, `expected >=1 result, got ${r.total_items}`);
    assert.ok(r.items[0].url.includes('/manga/'), 'result url points to /manga/');
  }],
  ['genre returns manga', async () => {
    const r = await s.genre('ecchi', { maxPages: 1 });
    assert.ok(r.total_items >= 1, `expected >=1 manga, got ${r.total_items}`);
    assert.ok(r.items[0].url.includes('/manga/'), 'item url points to /manga/');
  }],
  ['post resolves chapter via REST', async () => {
    const r = await s.post(CHAPTER_URL);
    assert.ok(r.id, 'post has id');
    assert.ok(r.slug, 'post has slug');
    assert.ok(r.title, 'post has title');
  }],
  ['genreList returns genres with counts', async () => {
    const r = await s.genreList();
    assert.ok(r.total_genres >= 20, `expected >=20 genres, got ${r.total_genres}`);
    const g = r.genres[0];
    assert.ok(g.slug, 'genre has slug');
    assert.ok(g.name, 'genre has name');
    assert.ok(g.count >= 0, 'genre has count');
  }],
  ['mangaListAZ returns all manga with type+id', async () => {
    const r = await s.mangaListAZ();
    assert.ok(r.total_items >= 100, `expected >=100 manga, got ${r.total_items}`);
    const first = r.items[0];
    assert.ok(first.slug, 'item has slug');
    assert.ok(first.type, 'item has type');
    assert.ok(first.id, 'item has id');
  }],
  ['advancedSearch filters by type+genre', async () => {
    const r = await s.advancedSearch({ type: 'Manhwa', genre: 'romance', order: 'latest' });
    assert.ok(r.total_items >= 1, `expected >=1 result, got ${r.total_items}`);
    assert.ok(r.items[0].url.includes('/manga/'), 'result url points to /manga/');
    // hasil harus subset dari semua manga (filter bekerja)
    assert.ok(r.total_items < 100, 'filter reduced results');
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
