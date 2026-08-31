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

  // Metadata di bawah ini TIDAK ADA di REST API — hanya di tabel div.info2 HTML.
  await check('Detail: metadata HTML (studio/rating/musim/durasi)', async () => {
    const r = await detailWithDownloads('https://nimegami.id/oni-no-hanayome-sub-indo/');
    assert.equal(r.clean_title, 'Oni no Hanayome', `clean_title salah: ${r.clean_title}`);
    assert.equal(r.alternative_title, 'Onihana', `alternative_title salah: ${r.alternative_title}`);
    assert.equal(r.type, 'TV', `type harus dari tabel (TV), dapat: ${r.type}`);
    assert.ok(r.studio, 'studio kosong');
    assert.equal(typeof r.rating, 'number', `rating bukan angka: ${r.rating}`);
    assert.ok(r.rating > 0 && r.rating <= 10, `rating di luar rentang: ${r.rating}`);
    assert.equal(r.rating_source, 'MAL', `rating_source salah: ${r.rating_source}`);
    assert.ok(r.season, 'season kosong');
    assert.equal(r.release_year, 2026, `release_year salah: ${r.release_year}`);
    assert.ok(r.duration && !/Menit$/.test(r.duration), `duration belum dibersihkan: ${r.duration}`);
    assert.ok(r.subtitle, 'subtitle kosong');
    assert.ok(r.credit, 'credit kosong');
    assert.ok(Object.keys(r.info).length >= 8, `tabel info terlalu sedikit: ${Object.keys(r.info).length}`);
    return `studio="${r.studio}" rating=${r.rating} ${r.season} ${r.duration}`;
  });

  // Link streaming (/streaming/) hanya ada di li.select-eps data-base64,
  // sedangkan mirror unduhan ada di #LinkDownload. Episode harus punya keduanya.
  await check('Detail: episode bawa stream + download sekaligus', async () => {
    const r = await detailWithDownloads('https://nimegami.id/oni-no-hanayome-sub-indo/');
    const ep1 = r.chapters.find((c) => c.number === 1);
    assert.ok(ep1, 'episode 1 tidak ada');
    assert.ok(ep1.streams?.length > 0, 'streams kosong');
    assert.ok(ep1.downloads?.length > 0, 'downloads kosong');
    const q = ep1.streams.map((s) => s.quality);
    assert.ok(q.includes('1080p'), `kualitas 1080p tidak ada: ${q.join(',')}`);
    const urls = ep1.streams.flatMap((s) => s.urls);
    assert.ok(urls.length >= 4, `url stream terlalu sedikit: ${urls.length}`);
    assert.ok(urls.every((u) => /^https?:\/\//.test(u)), 'ada url stream tidak absolut');
    assert.ok(urls.some((u) => u.includes('/streaming/')), 'tidak ada url path /streaming/');
    const dlLinks = ep1.downloads.flatMap((d) => d.links);
    assert.ok(dlLinks.length >= urls.length, 'mirror unduhan hilang setelah merge');
    return `stream=${urls.length} url, download=${dlLinks.length} link`;
  });

  // Sebagian series memang punya select-eps lebih sedikit dari blok download
  // (mis. Asako Get You: 2 stream vs 3 unduhan) — itu data situs, bukan bug.
  // Yang wajib: tidak ada episode yang hilang total setelah merge.
  await check('Detail: merge tidak menghilangkan episode', async () => {
    const cases = [
      ['https://nimegami.id/asako-get-you-sub-indo/', 3],
      ['https://nimegami.id/kimetsu-no-yaiba-katanakaji-no-sato-hen-sub-indo/', 12],
    ];
    const out = [];
    for (const [url, expected] of cases) {
      const r = await detailWithDownloads(url);
      assert.equal(r.chapters.length, expected, `${url} -> ${r.chapters.length}, harusnya ${expected}`);
      const nums = r.chapters.map((c) => c.number);
      assert.equal(new Set(nums).size, nums.length, 'ada nomor episode duplikat');
      assert.ok(r.chapters.every((c) => c.downloads.length > 0 || c.streams.length > 0),
        'ada episode tanpa stream maupun download');
      out.push(`${r.chapters.length}ep`);
    }
    return out.join(' / ');
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
    assert.ok(r.chapters[0].streams?.length > 0, 'tidak ada streams');
    assert.ok(r.studio, 'chapter() tidak membawa metadata studio');
    assert.equal(typeof r.rating, 'number', 'chapter() tidak membawa rating');
    return `chapters=${r.chapters.length} studio="${r.studio}"`;
  });

  // options.number = ambil satu episode saja
  await check('Chapter: filter satu episode (number)', async () => {
    const r = await chapter('https://nimegami.id/oni-no-hanayome-sub-indo/', { number: 3 });
    assert.equal(r.chapters.length, 1, `harus 1 episode, dapat ${r.chapters.length}`);
    assert.equal(r.chapters[0].number, 3, `nomor salah: ${r.chapters[0].number}`);
    assert.ok(r.chapters[0].streams.length > 0, 'streams kosong');
    return `ep=${r.chapters[0].number} stream=${r.chapters[0].streams.length}q`;
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

  // AUDIT: field hasil gabungan REST+HTML tidak boleh null tanpa alasan.
  // Field yang SAH null: alternative_title/season/rating (tidak semua series
  // punya di tabel situs), chapter.url & chapter.date (situs tidak menyediakan).
  await check('AUDIT: tidak ada null tak terduga di detail', async () => {
    const r = await detailWithDownloads('https://nimegami.id/oni-no-hanayome-sub-indo/');
    const wajib = ['id', 'title', 'clean_title', 'url', 'slug', 'type', 'studio',
      'rating', 'season', 'release_year', 'duration', 'subtitle', 'credit',
      'series', 'poster', 'synopsis', 'chapter_count'];
    const kosong = wajib.filter((k) => r[k] === null || r[k] === undefined || r[k] === '');
    assert.equal(kosong.length, 0, `field kosong: ${kosong.join(', ')}`);
    assert.ok(Array.isArray(r.genres) && r.genres.length > 0, 'genres kosong');
    assert.ok(Array.isArray(r.categories) && r.categories.length > 0, 'categories kosong');

    for (const c of r.chapters) {
      assert.ok(c.title, `episode tanpa title: ${JSON.stringify(c).slice(0, 80)}`);
      assert.equal(typeof c.number, 'number', `nomor episode bukan angka: ${c.number}`);
      for (const s of c.streams) {
        assert.ok(s.quality, 'stream tanpa quality');
        assert.ok(s.urls.length > 0, `stream ${s.quality} tanpa url`);
      }
      for (const d of c.downloads) {
        assert.ok(d.quality, 'download tanpa quality');
        assert.ok(d.links.every((l) => l.url), 'ada link download tanpa url');
      }
    }
    return `${wajib.length} field terisi, ${r.chapters.length} episode bersih`;
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