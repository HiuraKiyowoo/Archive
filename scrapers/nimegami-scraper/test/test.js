import assert from 'node:assert/strict';
import { home, search, genre, genres, detailWithDownloads, chapter } from '../src/index.js';

function fail(name, err) {
  console.error(`  ${name}  FAIL  ${err.message}`);
  return false;
}

function pass(name, extra = '') {
  console.log(`  ${name}  PASS${extra ? '  ' + extra : ''}`);
  return true;
}

const results = [];
let allPass = true;

function check(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then((msg) => {
      pass(name, msg);
      results.push([name, true]);
    })
    .catch((err) => {
      fail(name, err);
      results.push([name, false]);
      allPass = false;
    });
}

async function run() {
  console.log('=== NIMEGAMI SCRAPER TEST ===\n');

  await check('Homepage', async () => {
    const r = await home();
    assert.ok(r.items?.length > 0, 'items kosong');
    for (const it of r.items.slice(0, 3)) {
      assert.ok(it.title, 'title kosong');
      assert.ok(it.url, 'url kosong');
    }
    return `items=${r.items.length}`;
  });

  await check('Search #1 ("naruto")', async () => {
    const r = await search('naruto');
    assert.ok(r.items?.length > 0, 'hasil kosong');
    assert.ok(r.items[0].url, 'url kosong');
    return `items=${r.items.length}`;
  });

  await check('Search #2 ("kimetsu")', async () => {
    const r = await search('kimetsu');
    assert.ok(r.items?.length > 0, 'hasil kosong');
    assert.ok(r.items[0].title, 'title kosong');
    return `items=${r.items.length}`;
  });

  await check('Genre #1 (action)', async () => {
    const r = await genre('action');
    assert.ok(r.items?.length > 0, 'items kosong');
    assert.ok(r.items[0].url, 'url kosong');
    return `items=${r.items.length}`;
  });

  await check('Genre #2 (comedy)', async () => {
    const r = await genre('comedy');
    assert.ok(r.items?.length > 0, 'items kosong');
    assert.ok(r.items[0].title, 'title kosong');
    return `items=${r.items.length}`;
  });

  await check('Genres list', async () => {
    const g = await genres();
    assert.ok(g.length > 50, `genre terlalu sedikit: ${g.length}`);
    return `genres=${g.length}`;
  });

  // detail: gunakan post dengan daftar episode lengkap
  await check('Detail #1 (Oni no Hanayome)', async () => {
    const r = await detailWithDownloads('https://nimegami.id/oni-no-hanayome-sub-indo/');
    assert.ok(r.title, 'title kosong');
    assert.ok(r.chapters?.length > 0, 'chapters kosong');
    assert.ok(r.chapters[0].downloads?.length > 0, 'downloads episode kosong');
    return `title="${r.title}" chapters=${r.chapters.length}`;
  });

  await check('Detail #2 (Kimetsu Hashira)', async () => {
    const r = await detailWithDownloads('https://nimegami.id/kimetsu-no-yaiba-hashira-geiko-hen-sub-indo/');
    assert.ok(r.title, 'title kosong');
    assert.ok(r.genres?.length > 0, 'genres kosong');
    return `genres=${r.genres.length}`;
  });

  await check('Detail #3 (Asako Get You)', async () => {
    const r = await detailWithDownloads('https://nimegami.id/asako-get-you-sub-indo/');
    assert.ok(r.title, 'title kosong');
    assert.ok(r.url, 'url kosong');
    return `series=${r.series ?? '-'}`;
  });

  await check('Chapter #1 (Oni no Hanayome)', async () => {
    const r = await chapter('https://nimegami.id/oni-no-hanayome-sub-indo/');
    assert.ok(r.chapters?.length > 0, 'chapters kosong');
    assert.ok(r.chapters[0].downloads, 'tidak ada downloads');
    return `chapters=${r.chapters.length}`;
  });

  await check('Chapter #2 (Asako Get You)', async () => {
    const r = await chapter('https://nimegami.id/asako-get-you-sub-indo/');
    assert.ok(r.chapters, 'chapters null');
    return `chapters=${r.chapters.length}`;
  });

  await check('Chapter #3 (Kimetsu Katanakaji)', async () => {
    const r = await chapter('https://nimegami.id/kimetsu-no-yaiba-katanakaji-no-sato-hen-sub-indo/');
    assert.ok(r.title, 'title kosong');
    return `title="${r.title.slice(0, 30)}"`;
  });

  await check('Pagination (posts page 2)', async () => {
    const r = await search('', 2, { perPage: 5 });
    // search kosong = semua post; total pasti > 5 sehingga ada halaman 2
    assert.ok(r.page === 2, 'page bukan 2');
    assert.ok(r.total_pages >= 2, 'total_pages < 2');
    return `page=${r.page} total_pages=${r.total_pages} total=${r.total}`;
  });

  console.log('\n=== HASIL ===');
  let passCount = 0;
  for (const [name, ok] of results) {
    if (ok) passCount++;
  }
  console.log(`${passCount}/${results.length} tes lolos`);
  if (!allPass) process.exitCode = 1;
}

run();