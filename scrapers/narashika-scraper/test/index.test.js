// Test live narashika-scraper — menembak narashika.top sungguhan.
// Prinsip: validasi ISI, bukan cuma "HTTP 200". Setiap test yang mengklaim
// sesuatu soal upstream punya assert yang gagal kalau situsnya berubah bentuk.
//
// Jalankan: node --test test/
// Butuh koneksi internet. Transport serial + jeda 900 ms, jadi durasi wajar.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  daftar,
  getFilm,
  getSerial,
  getEpisodeTerbaru,
  getTerpopuler,
  filter,
  filterBySlug,
  cari,
  cariSemua,
  getBySlug,
  getById,
  getDetail,
  getDetailHtml,
  getTerm,
  getGenre,
  semuaEpisode,
  daftarEpisodeDariHtml,
  ambilDownload,
  bersih,
  normHost,
  TAKSONOMI,
  POST_TYPE,
  ORDERBY,
  MAX_PER_PAGE,
  BASE,
} from "../src/index.js";

const SLUG_FILM = "borderlands-2024";
const SLUG_TV = "s-line-2025-sub-indo";
const SLUG_EPS = "s-line-season-1-episode-1-sub-indo";

// ───────────────────────── murni lokal (tanpa jaringan) ─────────────────────────

test("bersih() membuang tag dan entitas HTML", () => {
  assert.equal(bersih("<b>Halo</b>&nbsp;&amp;&nbsp;dunia"), "Halo & dunia");
  assert.equal(bersih("Judul&#8217;s   spasi"), "Judul's spasi");
  assert.equal(bersih(null), "");
});

test("normHost() menormalkan host lama/varian ke narashika.top", () => {
  assert.equal(normHost("https://tv.narashika.top/genre/drama-korea/"), `${BASE}/genre/drama-korea/`);
  assert.equal(normHost("https://narashika.site/?p=44846"), `${BASE}/?p=44846`);
  assert.equal(normHost(null), null);
});

test("peta taksonomi memisahkan rest_base dari prefix URL arsip", () => {
  // Ini bukan detail kosmetik: menyamakan keduanya bikin URL 404.
  assert.equal(TAKSONOMI.cast.rest, "muvicast");
  assert.equal(TAKSONOMI.cast.url, "cast");
  assert.equal(TAKSONOMI.year.rest, "muviyear");
  assert.equal(TAKSONOMI.year.url, "year");
  assert.equal(TAKSONOMI.categories.rest, "categories");
  assert.equal(TAKSONOMI.categories.url, "genre");
});

test("daftarEpisodeDariHtml() membuang anchor komentar dan feed", () => {
  const html = `<div class="gmr-listseries">
    <a href="https://narashika.top/tv/x/" class="gmr-all-serie">Streaming Episode =></a>
    <a href="https://narashika.top/eps/x-episode-1-sub-indo/">S1 Eps1</a>
    <a href="https://narashika.top/eps/x-episode-2-sub-indo/">S1 Eps2</a>
    <a href="https://narashika.top/eps/x-episode-1-sub-indo/feed/">feed</a>
    <a href="/eps/x-episode-1-sub-indo/#respond">Batalkan balasan</a>
  </div>`;
  const eps = daftarEpisodeDariHtml(html);
  assert.equal(eps.length, 2, "hanya 2 episode asli yang boleh lolos");
  assert.deepEqual(
    eps.map((e) => [e.season, e.episode]),
    [
      [1, 1],
      [1, 2],
    ],
  );
  assert.ok(eps.every((e) => !e.url.includes("#")));
});

test("daftarEpisodeDariHtml() balikin array kosong kalau blok tidak ada", () => {
  assert.deepEqual(daftarEpisodeDariHtml("<div>tanpa listseries</div>"), []);
  assert.deepEqual(daftarEpisodeDariHtml(null), []);
});

test("ambilDownload() mengelompokkan per resolusi dan menolak tautan internal", () => {
  const html =
    "<p>360p [Hardsub-Indo] &#8211; <a href='https://1fichier.com/?abc'>1fichier</a> | " +
    "<a href='https://buzzheavier.com/x'>Buzzheavier</a></p>" +
    "<p>720p &#8211; <a href='https://send.cm/y'>Send</a></p>" +
    "<p>ke <a href='https://narashika.top/genre/action/'>Action</a> dan " +
    "<a href='http://t.me/narashikamovies'>telegram</a></p>";
  const g = ambilDownload(html);
  assert.equal(g.length, 2, "paragraf berisi tautan internal/telegram harus dibuang");
  assert.equal(g[0].resolusi, "360p");
  assert.equal(g[0].tautan.length, 2);
  assert.equal(g[1].resolusi, "720p");
  assert.ok(g.every((x) => x.tautan.every((t) => !/narashika|t\.me/.test(t.url))));
});

// ───────────────────────── validasi argumen (lokal, melempar) ─────────────────────────

test("tipe post type ngawur ditolak dengan daftar yang sah", async () => {
  await assert.rejects(() => daftar("anime"), (e) => e instanceof TypeError && /movie/.test(e.message));
});

test("perPage di atas batas WordPress ditolak LOKAL, tidak menembak server", async () => {
  await assert.rejects(
    () => daftar("movie", { perPage: MAX_PER_PAGE + 1 }),
    (e) => e instanceof RangeError && /rest_invalid_param/.test(e.message),
  );
});

test("page 0 / bukan bilangan bulat ditolak", async () => {
  await assert.rejects(() => daftar("movie", { page: 0 }), TypeError);
  await assert.rejects(() => daftar("movie", { page: 1.5 }), TypeError);
});

test("orderby yang ditolak server dicegah lebih awal, dengan alasan", async () => {
  await assert.rejects(
    () => daftar("movie", { orderby: "views" }),
    (e) => e instanceof TypeError && /views/.test(e.message) && ORDERBY.every((o) => e.message.includes(o)),
  );
});

test("getTerpopuler menolak tipe tanpa field views, bukan mengarang urutan", async () => {
  await assert.rejects(
    () => getTerpopuler("tv"),
    (e) => e instanceof TypeError && /views/.test(e.message),
  );
  await assert.rejects(() => getTerpopuler("episode"), TypeError);
});

test("filter tanpa taksonomi dan taksonomi tak dikenal ditolak", async () => {
  await assert.rejects(() => filter("movie", {}), TypeError);
  await assert.rejects(() => filter("movie", { genrezz: 1 }), TypeError);
});

test("taksonomi khusus tv ditolak untuk tipe movie", async () => {
  await assert.rejects(
    () => filter("movie", { network: 1 }),
    (e) => e instanceof TypeError && /tidak berlaku/.test(e.message),
  );
});

test("kueri pencarian kosong ditolak", async () => {
  await assert.rejects(() => cari("   "), TypeError);
  await assert.rejects(() => cariSemua(""), TypeError);
});
