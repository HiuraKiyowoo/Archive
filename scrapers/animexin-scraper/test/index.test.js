// Test live animexin-scraper. Semua request nyata ke situs, dan yang divalidasi
// adalah ISI JSON hasil parsing — bukan sekadar HTTP 200.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  home,
  series,
  seriesDetail,
  search,
  episode,
  genres,
  taxonomy,
  schedule,
  sitemap,
  walk,
  fetchText,
} from '../src/index.js';

const SERIES_SLUG = 'renegade-immortal';
const EP_SLUG = 'renegade-immortal-episode-156-indonesia-english-sub';

test('Homepage: kartu terisi & field wajib lengkap', async () => {
  const r = await home();
  assert.equal(r.ok, true);
  assert.ok(r.count >= 20, `kartu homepage cuma ${r.count}`);
  assert.ok(r.episodes > 0, 'tidak ada kartu episode di homepage');
  for (const c of r.data.slice(0, 10)) {
    assert.ok(c.title.length > 0, 'judul kosong');
    assert.match(c.url, /^https:\/\/animexin\.dev\//);
    assert.ok(c.slug.length > 0, 'slug kosong');
    assert.match(c.poster, /^https?:\/\//, `poster tidak valid: ${c.poster}`);
    assert.ok(['episode', 'series'].includes(c.kind));
  }
  for (const e of r.data.filter((c) => c.kind === 'episode').slice(0, 5)) {
    assert.ok(e.episode > 0, `nomor episode nol untuk ${e.slug}`);
  }
});

test('Series list: 30 kartu per halaman & paginasi benar-benar beda', async () => {
  const p1 = await series(1);
  const p2 = await series(2);
  assert.equal(p1.count, 30, `halaman 1 dapat ${p1.count}`);
  assert.equal(p2.count, 30, `halaman 2 dapat ${p2.count}`);
  const s2 = new Set(p2.data.map((x) => x.slug));
  const overlap = p1.data.map((x) => x.slug).filter((x) => s2.has(x));
  assert.equal(overlap.length, 0, `halaman 1 & 2 tumpang tindih: ${overlap}`);
  for (const c of p1.data) {
    assert.equal(c.kind, 'series', `${c.slug} terdeteksi sbg ${c.kind}`);
  }
});

test('Series list: halaman melewati batas mengembalikan nol kartu', async () => {
  const r = await series(12);
  assert.equal(r.count, 0, `halaman 12 mestinya kosong, dapat ${r.count}`);
  assert.equal(r.has_next, false);
});

test('Filter order: mengubah urutan hasil (bukan diterima-lalu-diabaikan)', async () => {
  const def = await series(1);
  const rev = await series(1, { order: 'titlereverse' });
  const pop = await series(1, { order: 'popular' });
  assert.equal(rev.count, 30);
  assert.equal(pop.count, 30);
  assert.notEqual(def.data[0].slug, rev.data[0].slug, 'order=titlereverse tidak berefek');
  assert.notEqual(def.data[0].slug, pop.data[0].slug, 'order=popular tidak berefek');
  assert.equal(rev.filters.order, 'titlereverse');
});

test('Filter status & type: mengubah isi hasil', async () => {
  const def = await series(1);
  const ong = await series(1, { status: 'ongoing' });
  const tv = await series(1, { type: 'TV' });
  assert.notEqual(def.data[0].slug, ong.data[0].slug, 'status[] tidak berefek');
  assert.ok(tv.count > 0 && tv.count < 30, `type=TV dapat ${tv.count}`);
  for (const c of tv.data) {
    assert.equal(c.type, 'TV', `${c.slug} bertipe ${c.type}, bukan TV`);
  }
});

test('Search #1 "immortal": hasil relevan & field valid', async () => {
  const r = await search('immortal');
  assert.ok(r.count >= 5, `hasil cuma ${r.count}`);
  const cocok = r.data.filter((c) => /immortal/i.test(c.title));
  assert.ok(cocok.length >= 3, `judul relevan cuma ${cocok.length}`);
  for (const c of r.data) {
    assert.match(c.url, /^https:\/\/animexin\.dev\//);
    assert.ok(c.title.length > 0);
  }
});

test('Search #2 "renegade": menemukan series target', async () => {
  const r = await search('renegade');
  const slugs = r.data.map((x) => x.slug);
  assert.ok(slugs.includes(SERIES_SLUG), `${SERIES_SLUG} tidak ada: ${slugs}`);
});

test('Search: kata kunci tanpa hasil tidak melempar error', async () => {
  const r = await search('zzzqqqxxx-tidak-ada-judul-ini');
  assert.equal(r.ok, true);
  assert.equal(r.count, 0, `mestinya nol, dapat ${r.count}`);
});

test('Detail series #1: metadata terisi (bukan cuma "ada")', async () => {
  const r = await seriesDetail(SERIES_SLUG);
  const s = r.data;

  assert.equal(r.command, 'series-detail');
  assert.equal(r.chapter_count, s.chapters.length);
  assert.ok(s.id > 0, 'id WP tidak ketemu');
  assert.equal(s.title, 'Renegade Immortal');
  assert.equal(s.alternative_title, '仙逆');
  assert.equal(s.status, 'Ongoing');
  assert.equal(s.type, 'ONA');
  assert.equal(s.network, 'Tencent Penguin Pictures');
  assert.equal(s.studio, 'Build Dream');
  assert.equal(s.country, 'China');
  assert.equal(s.duration, '25 min');
  assert.equal(s.episodes_declared, 180);
  assert.equal(s.fansub, 'AnimeXin');
  assert.equal(s.posted_by, 'AnimeXin');
  assert.ok(s.released_on, 'released_on kosong');
  assert.ok(s.updated_on, 'updated_on kosong');
  assert.match(s.date_published, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(s.date_modified, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(s.rating > 0 && s.rating <= 5, `rating ${s.rating}`);
  assert.ok(s.rating_votes > 0, 'rating_votes kosong');
  assert.match(s.poster, /^https:\/\/animexin\.dev\/wp-content\//);
  assert.ok(s.genres.length >= 3, `genre cuma ${s.genres.length}`);
  assert.ok(s.synopsis && s.synopsis.length > 100, 'sinopsis terlalu pendek');
  assert.ok(s.synopsis_en && s.synopsis_en.length > 50, 'sinopsis EN kosong');
  assert.ok(s.synopsis_id && s.synopsis_id.length > 50, 'sinopsis ID kosong');

  // daftar episode: harus ratusan (156+), urutan DESC (situs), nomor unik
  assert.ok(s.chapter_count >= 100, `chapter cuma ${s.chapter_count}`);
  assert.ok(
    s.chapters[0].number > s.chapters[s.chapters.length - 1].number,
    'urutan chapter tidak DESC'
  );
  const nums = new Set(s.chapters.map((c) => c.number));
  assert.equal(nums.size, s.chapters.length, 'ada nomor chapter duplikat');
  for (const c of s.chapters.slice(0, 5)) {
    assert.match(c.url, /^https:\/\/animexin\.dev\/[^/]*episode-\d+-/i);
    assert.ok(c.title, 'judul chapter kosong');
  }
});

test('Detail series #2: slug lain konsisten (martial-inverse)', async () => {
  const r = await seriesDetail('martial-inverse');
  const s = r.data;
  assert.equal(s.title, 'Martial Inverse');
  assert.equal(s.status, 'Completed');
  assert.ok(s.id > 0);
  assert.ok(s.poster, 'poster kosong');
  assert.ok(s.genres.length >= 1, 'genre kosong');
  assert.ok(s.synopsis_en || s.synopsis_id, 'sinopsis dua-duanya kosong');
  assert.ok(s.chapter_count >= 1, 'chapter kosong');
  assert.ok(r.data.released_on || r.data.updated_on, 'tanggal kosong semua');
});

test('Detail: slug dengan prefix /anime/ tetap ter-open (redirect logika)', async () => {
  const r = await seriesDetail('/anime/renegade-immortal');
  assert.equal(r.data.title, 'Renegade Immortal');
  // URL yang benar-benar dipakai harus TANPA prefix /anime/
  assert.ok(!r.url.includes('/anime/'), `masih pakai prefix: ${r.url}`);
});

test('Detail: slug tidak ada -> 404 (bukan silent)', async () => {
  await assert.rejects(
    () => seriesDetail('ini-tidak-benar-benar-ada-999'),
    (err) => {
      assert.match(err.message, /404|tidak/i);
      return true;
    }
  );
});

test('Episode: mirror, download, navigasi, series induk', async () => {
  const r = await episode(EP_SLUG);
  const e = r.data;

  assert.equal(r.command, 'episode');
  assert.equal(e.episode, 156);
  assert.equal(e.type, 'ONA');
  assert.equal(e.series.slug ?? e.series.title, 'Renegade Immortal');
  assert.equal(e.series.url, 'https://animexin.dev/renegade-immortal/');

  // mirror: >= 8, setiap embed valid & label konsisten
  assert.ok(e.mirror_count >= 8, `mirror cuma ${e.mirror_count}`);
  assert.equal(e.mirror_count, e.mirrors.length);
  const kinds = new Set();
  for (const m of e.mirrors) {
    assert.ok(m.label, 'label mirror kosong');
    assert.match(m.embed, /^https?:\/\//, `embed tidak valid: ${m.embed}`);
    assert.ok(m.host, 'host mirror kosong');
    assert.ok(m.kind, 'kind mirror kosong');
    kinds.add(m.kind);
  }
  assert.ok(kinds.size >= 2, `semua mirror satu jenis: ${[...kinds]}`);
  const dm = e.mirrors.find((m) => m.kind === 'dailymotion');
  assert.ok(dm, 'tidak ada mirror dailymotion');
  assert.match(dm.embed, /dailymotion\.com\/embed\/video\//);

  // download: minimal 2 bahasa non-vip, tiap blok punya >= 2 link
  assert.equal(r.download_count, e.downloads.filter((d) => !d.vip).length);
  const nonVip = e.downloads.filter((d) => !d.vip);
  assert.ok(nonVip.length >= 2, `download non-vip cuma ${nonVip.length}`);
  const langs = new Set(nonVip.map((d) => d.language.toLowerCase()));
  assert.ok(langs.size >= 2, `bahasa download cuma: ${[...langs]}`);
  for (const d of nonVip) {
    assert.ok(d.quality, 'kualitas kosong');
    assert.ok(d.links.length >= 2, `${d.language}: link cuma ${d.links.length}`);
    for (const l of d.links) {
      assert.match(l.url, /^https?:\/\//);
      assert.ok(l.provider, 'provider kosong');
    }
  }

  // navigasi
  assert.ok(e.prev && /episode-155/.test(e.prev), `prev salah: ${e.prev}`);
  assert.equal(e.all_episodes, 'https://animexin.dev/renegade-immortal/');
  assert.match(e.date_published, /^\d{4}-\d{2}-\d{2}T/);
});

test('Episode: navigasi prev/next konsisten antar episode', async () => {
  const a = await episode(EP_SLUG); // ep 156 = terbaru
  const b = await episode(a.data.prev.replace(/^https:\/\/animexin\.dev\//, ''));
  assert.equal(b.data.episode, 155);
  // prev dari ep155 harus menunjuk ke ep154; next (bila ada) kembali ke ep156
  assert.ok(
    !b.data.prev || /episode-154/.test(b.data.prev),
    `prev ep155 salah: ${b.data.prev}`
  );
  assert.ok(
    !b.data.next || /episode-156/.test(b.data.next),
    `next ep155 salah: ${b.data.next}`
  );
  assert.equal(b.data.series.url, 'https://animexin.dev/renegade-immortal/');
});

test('Genres: daftar lengkap dari sitemap (>= 30)', async () => {
  const r = await genres();
  assert.ok(r.count >= 30, `genre cuma ${r.count}`);
  const slugs = new Set(r.data.map((g) => g.slug));
  assert.equal(slugs.size, r.count, 'ada slug genre duplikat');
  for (const g of r.data) {
    assert.ok(g.name && g.slug && g.url, JSON.stringify(g));
    assert.ok(g.url.endsWith('/'), g.url);
  }
  assert.ok(slugs.has('action'), 'genre action tidak ada');
});

test('Taxonomy: genre action (kartu) & season (markup khusus)', async () => {
  const g = await taxonomy('genres', 'action');
  assert.ok(g.count >= 10, `genre action cuma ${g.count}`);
  for (const c of g.data) {
    assert.ok(c.title && c.url && c.kind === 'series');
  }

  const s = await taxonomy('season', 'fall-2024');
  assert.ok(s.count >= 3, `season fall-2024 cuma ${s.count}`);
  const first = s.data[0];
  assert.ok(first.episode_total > 0, 'season card: episode_total kosong');
  assert.ok(first.type, 'season card: type kosong');
  assert.ok(first.status, 'season card: status kosong');
  assert.ok(first.slug, 'season card: slug kosong');
});

test('Taxonomy: slug tak dikenal -> not_found, bukan crash', async () => {
  const r = await taxonomy('genres', 'genre-yang-tidak-ada-xyz');
  assert.equal(r.not_found, true);
  assert.equal(r.count, 0);
});

test('Schedule: 7 hari + hari "Random" & total series masuk akal', async () => {
  const r = await schedule();
  assert.ok(r.days >= 7, `hari cuma ${r.days}`);
  const days = new Set(r.data.map((d) => d.day));
  for (const hari of ['Monday', 'Wednesday', 'Friday']) {
    assert.ok(days.has(hari), `hari ${hari} tidak ada`);
  }
  assert.ok(r.total_series >= 20, `total series cuma ${r.total_series}`);
  for (const d of r.data) {
    assert.equal(d.count, d.series.length, `count ${d.day} tidak cocok`);
    for (const it of d.series) {
      assert.ok(it.title && it.url, JSON.stringify(it));
      assert.ok(!it.url.includes('/anime/'), `URL masih pakai prefix: ${it.url}`);
    }
  }
});

test('Sitemap: 200+ series, semua URL valid, tidak ada entri /anime/ polos', async () => {
  const r = await sitemap();
  assert.ok(r.count >= 200, `sitemap cuma ${r.count}`);
  for (const x of r.data) {
    assert.match(x.url, /^https:\/\/animexin\.dev\//);
    assert.ok(x.slug, 'slug kosong');
  }
  assert.ok(!r.data.some((x) => x.url === 'https://animexin.dev/anime/'),
    'entri arsip /anime/ masih ikut');
});

test('Walk: iterasi series 3 halaman, dedup, total = jumlah unik', async () => {
  const w = await walk((p) => series(p, { order: 'update' }), { maxPages: 3 });
  assert.equal(w.pages, 3);
  assert.ok(w.count >= 80, `walk cuma dapat ${w.count}`);
  const slugs = new Set(w.data.map((x) => x.slug));
  assert.equal(slugs.size, w.count, 'walk tidak dedup');
});

test('Anti-null audit: field inti detail + episode tidak boleh null', async () => {
  const s = (await seriesDetail(SERIES_SLUG)).data;
  const wajibSeries = [
    'title', 'alternative_title', 'url', 'slug', 'poster', 'status', 'type',
    'network', 'studio', 'country', 'duration', 'fansub', 'posted_by',
    'date_published', 'date_modified', 'rating', 'rating_votes', 'synopsis',
    'chapter_count', 'chapters',
  ];
  const nullS = wajibSeries.filter(
    (k) => s[k] === null || s[k] === undefined || s[k] === ''
  );
  assert.deepEqual(nullS, [], `field series null: ${nullS.join(', ')}`);
  assert.ok(Array.isArray(s.genres) && s.genres.length > 0);
  assert.ok(Array.isArray(s.chapters) && s.chapters.length > 0);

  const e = (await episode(EP_SLUG)).data;
  const wajibEp = [
    'title', 'url', 'slug', 'episode', 'type', 'date_published', 'date_modified',
    'prev', 'all_episodes',
  ];
  const nullE = wajibEp.filter((k) => e[k] === null || e[k] === undefined || e[k] === '');
  // next boleh null hanya jika episode terakhir — ep 156 = terbaru -> memang null
  assert.deepEqual(nullE, [], `field episode null: ${nullE.join(', ')}`);
  assert.ok(e.mirrors.length > 0 && e.downloads.length > 0);
  assert.ok(e.series.url && e.series.title, 'series induk kosong');
});

test('BlockedError: /anime/* benar-benar terdeteksi sebagai diblokir CF', async () => {
  await assert.rejects(
    () => fetchText('https://animexin.dev/anime/'),
    (err) => {
      assert.ok(
        err.name === 'BlockedError' || err.name === 'HttpError',
        `type error: ${err.name}`
      );
      return true;
    }
  );
});
