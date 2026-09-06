import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as ryu from '../src/index.js';

describe('RyuKomik Scraper & API Live Test Suite', () => {

  // 1. PROJECT RYUKOMIK (API)
  describe('1. Project RyuKomik Endpoints', () => {
    test('getProjectFilters() mengembalikan daftar filter valid', async () => {
      const filters = await ryu.getProjectFilters();
      assert.ok(filters, 'Filters harus ada');
      assert.ok(Array.isArray(filters.tipe), 'tipe harus array');
      assert.ok(Array.isArray(filters.status), 'status harus array');
      assert.ok(Array.isArray(filters.genre), 'genre harus array');
      assert.ok(filters.tipe.some(t => t.value === 'manhwa'), 'tipe harus memuat manhwa');
    });

    test('getProjectPustaka() mengembalikan daftar katalog komik project', async () => {
      const res = await ryu.getProjectPustaka({ page: 1 });
      assert.equal(res.success, true);
      assert.ok(Array.isArray(res.data), 'data harus array');
      assert.ok(res.data.length > 0, 'data tidak boleh kosong');
      
      const item = res.data[0];
      assert.ok(item.title, 'item harus memiliki title');
      assert.ok(item.slug, 'item harus memiliki slug');
      assert.ok(item.image, 'item harus memiliki image');
    });

    test('getProjectPustaka() filter tipe dan genre mengubah hasil', async () => {
      const resManhwa = await ryu.getProjectPustaka({ tipe: 'manhwa' });
      const resManga = await ryu.getProjectPustaka({ tipe: 'manga' });
      assert.notEqual(resManhwa.total, resManga.total, 'Total komik manhwa dan manga harus berbeda');
    });

    test('getProjectDetail() mengembalikan metadata komik project & daftar chapter', async () => {
      const detail = await ryu.getProjectDetail('sicario');
      assert.equal(detail.source, 'project');
      assert.equal(detail.slug, 'sicario');
      assert.ok(detail.title.toLowerCase().includes('sicario'));
      assert.ok(detail.total_chapters > 0, 'Harus memiliki chapter');
      assert.ok(Array.isArray(detail.chapters), 'chapters harus array');
      
      const ch = detail.chapters[0];
      assert.ok(ch.slug, 'chapter harus memiliki slug');
      assert.ok(ch.url.startsWith('https://ryukomik.my.id/chapter/project/'));
    });

    test('getProjectChapter() mengembalikan gambar-gambar chapter project', async () => {
      const ch = await ryu.getProjectChapter('sicario', 'chapter-1');
      assert.equal(ch.success, true);
      assert.equal(ch.mangaId, 'sicario');
      assert.ok(ch.total_images > 0, 'Gambar chapter tidak boleh kosong');
      assert.ok(Array.isArray(ch.images), 'images harus array');
      assert.ok(ch.images[0].startsWith('http'), 'URL gambar harus valid http');
    });
  });

  // 2. KOMIKU SOURCE (API)
  describe('2. Komiku Source Endpoints', () => {
    test('getKomikuTerbaru() mengembalikan 40 rilis komik terbaru', async () => {
      const res = await ryu.getKomikuTerbaru();
      assert.equal(res.success, true);
      assert.ok(Array.isArray(res.data), 'data harus array');
      assert.ok(res.data.length >= 10, 'minimal 10 rilis terbaru');

      const item = res.data[0];
      assert.ok(item.title);
      assert.ok(item.slug);
      assert.ok(item.chapter_terbaru);
    });

    test('searchKomiku() mengembalikan hasil pencarian', async () => {
      const res = await ryu.searchKomiku('magic');
      assert.equal(res.success, true);
      assert.ok(Array.isArray(res.data));
      assert.ok(res.data.length > 0, 'Pencarian magic harus ada hasil');
    });

    test('getKomikuDetail() mengembalikan metadata & seluruh chapter komik', async () => {
      const res = await ryu.getKomikuDetail('magic-emperor');
      assert.equal(res.success, true);
      assert.ok(res.data);
      assert.ok(res.data.title);
      assert.ok(Array.isArray(res.data.chapters));
      assert.ok(res.data.chapters.length > 100, 'Magic Emperor harus memiliki ratusan chapter');
    });

    test('getKomikuChapter() mengembalikan gambar baca chapter', async () => {
      const res = await ryu.getKomikuChapter('magic-emperor-chapter-905');
      assert.equal(res.success, true);
      assert.ok(Array.isArray(res.images));
      assert.ok(res.images.length > 0, 'Daftar gambar chapter komiku tidak boleh kosong');
      assert.ok(res.images[0].startsWith('http'), 'URL gambar komiku harus valid');
    });
  });

  // 3. DOUJINDESU SOURCE (API)
  describe('3. Doujindesu Source Endpoints', () => {
    test('getDoujinTerbaru() & getDoujinManhwaTerbaru() mengembalikan rilis terbaru', async () => {
      const res = await ryu.getDoujinTerbaru();
      assert.ok(Array.isArray(res.data || res));
      const list = res.data || res;
      assert.ok(list.length > 0);
      assert.ok(list[0].title);
      assert.ok(list[0].slug);
    });

    test('searchDoujin() mengembalikan hasil pencarian', async () => {
      const res = await ryu.searchDoujin('sister');
      assert.ok(Array.isArray(res.data || res));
      const list = res.data || res;
      assert.ok(list.length > 0);
    });
  });

  // 4. KOMIKID SOURCE (API)
  describe('4. Komikid Source Endpoints', () => {
    test('getKomikidPustaka() mengembalikan daftar katalog komikid', async () => {
      const res = await ryu.getKomikidPustaka({ page: 1 });
      assert.ok(Array.isArray(res.data || res));
      const list = res.data || res;
      assert.ok(list.length > 0);
    });

    test('getKomikidDetail() mengembalikan detail komikid', async () => {
      const res = await ryu.getKomikidDetail('the-villain-wants-to-live');
      const data = res.data || res;
      assert.ok(data.title);
      assert.ok(Array.isArray(data.chapters));
      assert.ok(data.chapters.length > 0);
    });
  });

  // 5. ANIME ENGINE (SSR)
  describe('5. Anime Engine Endpoints', () => {
    test('getAnimeTerbaru() mengembalikan daftar anime terbaru', async () => {
      const res = await ryu.getAnimeTerbaru();
      assert.equal(res.source, 'anime');
      assert.ok(Array.isArray(res.data));
      assert.ok(res.data.length > 0);
      assert.ok(res.data[0].slug);
    });

    test('getAnimeDetail() mengembalikan judul & daftar episode', async () => {
      const res = await ryu.getAnimeDetail('kaijuu-8-gou-narumi-no-heijitsu');
      assert.equal(res.source, 'anime');
      assert.ok(res.title);
      assert.ok(Array.isArray(res.episodes));
      assert.ok(res.episodes.length > 0);
    });

    test('getAnimeEpisode() mengembalikan iframe video proxy player', async () => {
      const res = await ryu.getAnimeEpisode('kaijuu-8-gou-narumi-no-heijitsu-episode-1');
      assert.equal(res.source, 'anime');
      assert.ok(Array.isArray(res.players));
      assert.ok(res.players.length > 0);
      assert.ok(res.players[0].includes('video-proxy') || res.players[0].startsWith('http'));
    });
  });

  // 6. LEADERBOARD (API)
  describe('6. Leaderboard Endpoint', () => {
    test('getLeaderboard() mengembalikan daftar ranking user XP', async () => {
      const res = await ryu.getLeaderboard();
      assert.ok(Array.isArray(res), 'Leaderboard harus berupa array');
      assert.ok(res.length > 0);
      assert.ok(res[0].username);
      assert.ok(res[0].xp !== undefined);
      assert.ok(res[0].level !== undefined);
    });
  });

});
