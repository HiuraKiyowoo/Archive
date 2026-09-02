// Test LOKAL murni — tanpa jaringan. Fixture kecil meniru struktur nyata
// pcverge.com (termasuk jebakan: kartu rekomendasi ber-`gmr-rating-item` di luar
// artikel, ikon <svg> sebelum teks, anchor "View All Episodes").
//
// Dipisah dari test/live.test.js supaya gangguan jaringan tidak mengaburkan
// sinyal kebenaran parser.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bersih,
  normHost,
  buangSvg,
  angkaDari,
  potongArtikel,
  ambilMovieData,
  ambilDownload,
  daftarEpisodeDariHtml,
  daftar,
  filter,
  cari,
  cariSemua,
  getTerm,
  getBySlug,
  getById,
  getPlayer,
  route,
  TAKSONOMI,
  POST_TYPE,
  ORDERBY,
  MAX_PER_PAGE,
  BASE,
} from "../src/index.js";

// ── Fixture: halaman detail film, lengkap dengan blok pengganggu ──────────────
const HTML_FILM = `<!DOCTYPE html><html><head><title>Contoh</title></head><body>
<div id="content">
<article class="hentry">
  <h1 class="entry-title">Contoh Film (2026)</h1>
  <div class="clearfix gmr-rating" itemprop="aggregateRating">
    <meta itemprop="bestRating" content="10">
    <div class="gmr-rating-content"><div class="gmr-rating-bar"><span style="width:90%"></span></div>
    <div class="gmr-meta-rating"><span itemprop="ratingCount">3253</span> votes, average <span itemprop="ratingValue">9.0</span> out of 10</div></div>
  </div>
  <div class="entry-content entry-content-single"><p>Sinopsis singkat.</p>
    <div class="clearfix content-moviedata">
      <div class="gmr-moviedata"><strong>Views:</strong><span class="post-views-count">0</span></div>
      <div class="gmr-moviedata"><strong>Genre:</strong><a href="https://pcverge.com/genre/action/">Action</a> , <a href='https://pcverge.com/genre/drama/'>Drama</a></div>
      <div class="gmr-moviedata"><strong>Quality:</strong><a href="https://pcverge.com/quality/hd/">HD</a></div>
      <div class="gmr-moviedata"><strong>Year:</strong><a href="https://pcverge.com/year/2026/">2026</a></div>
      <div class="gmr-moviedata"><strong>Duration:</strong><svg xmlns="http://www.w3.org/2000/svg"><path d="M512 64"/></svg> 134 Min</div>
      <div class="gmr-moviedata"><strong>Country:</strong><a href="https://pcverge.com/country/japan/">Japan</a></div>
      <div class="gmr-moviedata"><strong>Director:</strong><a href="https://pcverge.com/director/kenta/">Kenta Britney</a></div>
      <div class="gmr-moviedata"><strong>Cast:</strong><a href="https://pcverge.com/cast/yusuke/">Yusuke Nishijima</a></div>
    </div>
  </div>
  <div class="gmr-server-wrap clearfix muvipro_player_content">
    <div id="muvipro_player_content_id" data-id="104124"></div>
    <ul class="muvipro-player-tabs nav nav-tabs clearfix">
      <li id="player1"><a href="#p1">Server 1</a></li>
      <li id="player2"><a href="#p2">Server 2</a></li>
      <li id="player3"><a href="#p3">Server 3</a></li>
    </ul>
    <div id="p1" class="tab-content-ajax"></div>
    <div id="p2" class="tab-content-ajax"></div>
  </div>
  <div id="download" class="gmr-download-wrap clearfix">
    <h3 class="title-download">Download Contoh Film</h3>
    <ul class="list-inline gmr-download-list clearfix">
      <li><a href="https://veev.to/d/aaa111" class="button button-shadow" rel="nofollow" title="Download link 1 Contoh Film"><svg viewBox="0 0 24 24"><path d="M1 1"/></svg> CLOSE 2X/3X TAB IKLAN LALU BALIK KE LINK DOWNLOAD LAGI</a></li>
      <li><a href='https://morencius.com/download/bbb222' class="button" rel="nofollow" title="Download link 2 Contoh Film"> CLOSE 2X/3X TAB IKLAN</a></li>
      <li><a href="https://t.me/grupku" class="button" title="Telegram"> Join Telegram</a></li>
      <li><a href="https://pcverge.com/request/" class="button" title="Request"> Request Film</a></li>
    </ul>
  </div>
</article>
<div class="gmr-related">
  <article><a href="https://pcverge.com/film-semi/lain/"><img src="x.jpg"></a>
    <div class="gmr-rating-item"><span class="icon_star"></span> 9.2</div>
    <div class="gmr-duration-item"><svg viewBox="0 0 1024 1024"><path d="M1 1"/></svg> 99 Min</div>
    <div class="gmr-quality-item">CAM</div>
    <div class="gmr-moviedata"><strong>Duration:</strong> 99 Min</div>
  </article>
</div>
</div></body></html>`;

const HTML_TV = `<article class="hentry">
  <div class="entry-content"><div class="clearfix content-moviedata">
    <div class="gmr-moviedata"><strong>Number Of Episode:</strong> 7</div>
    <div class="gmr-moviedata"><strong>Network:</strong><a href="https://pcverge.com/network/mgm/">MGM+</a></div>
    <div class="gmr-moviedata"><strong>Last Air Date:</strong> 23 Aug 2026</div>
  </div></div>
  <div class="gmr-listseries">
    <a class="button button-shadow active" href="https://pcverge.com/tv/contoh-2026/" class="gmr-all-serie">View All Episodes</a>
    <a class="button" href="https://pcverge.com/eps/contoh-season-1-episode-2/" title="Permalink to Contoh S1E2">S1 Eps2</a>
    <a class="button" href="https://pcverge.com/eps/contoh-season-1-episode-1/" title="Permalink to Contoh S1E1">S1 Eps1</a>
    <a class="button" href="https://pcverge.com/eps/contoh-season-1-episode-1/#respond">Batalkan balasan</a>
    <a class="button" href="https://pcverge.com/eps/contoh-season-1-episode-1/feed/">Feed</a>
  </div>
</article>`;

// ── Helper teks ──────────────────────────────────────────────────────────────

test("bersih() melucuti tag dan menormalkan entitas HTML", () => {
  assert.equal(bersih("<p>Judul &#8211; &#8220;Tes&#8221; &amp; lain</p>"), 'Judul – "Tes" & lain');
  assert.equal(bersih("  spasi   ganda \n baris  "), "spasi ganda baris");
  assert.equal(bersih(null), "");
});

test("normHost() menyeragamkan host www ke BASE", () => {
  assert.equal(normHost("https://www.pcverge.com/eps/a/"), `${BASE}/eps/a/`);
  assert.equal(normHost("http://pcverge.com/x/"), `${BASE}/x/`);
  assert.equal(normHost(null), null);
});

test("buangSvg() membuang blok svg sebelum regex teks jalan", () => {
  const s = '<div><svg viewBox="0 0"><path d="M1 1"/></svg> 134 Min</div>';
  assert.ok(!buangSvg(s).includes("<svg"));
  assert.match(buangSvg(s), /134 Min/);
});

test("angkaDari() membaca desimal berkoma maupun bertitik", () => {
  assert.equal(angkaDari("9.0 out of 10"), 9);
  assert.equal(angkaDari("Eps: 7"), 7);
  assert.equal(angkaDari("8,5"), 8.5);
  assert.equal(angkaDari("tanpa angka"), null);
});

// ── Jebakan utama: kartu rekomendasi di luar artikel ─────────────────────────

test("potongArtikel() memotong sebelum blok rekomendasi", () => {
  const main = potongArtikel(HTML_FILM);
  assert.ok(main.includes("Contoh Film (2026)"), "artikel utama harus ikut");
  assert.ok(!main.includes("gmr-rating-item"), "kartu rekomendasi tidak boleh ikut");
  assert.ok(!main.includes("9.2"), "rating film lain tidak boleh ikut");
  assert.ok(!main.includes("CAM"), "kualitas film lain tidak boleh ikut");
});

test("rating dan vote diambil dari artikel utama, bukan kartu sebelah", () => {
  const main = potongArtikel(HTML_FILM);
  assert.equal(angkaDari(main.match(/itemprop=["']ratingValue["'][^>]*>([^<]+)/i)?.[1]), 9);
  assert.equal(angkaDari(main.match(/itemprop=["']ratingCount["'][^>]*>([^<]+)/i)?.[1]), 3253);
});

test("ambilMovieData() membaca label film dan melewati ikon svg", () => {
  const md = ambilMovieData(potongArtikel(HTML_FILM));
  assert.equal(md.duration.teks, "134 Min", "durasi harus lolos dari <svg>");
  assert.equal(md.quality.teks, "HD");
  assert.equal(md.year.teks, "2026");
  assert.equal(md.country.teks, "Japan");
  assert.deepEqual(
    md.genre.tautan.map((t) => t.nama),
    ["Action", "Drama"],
    "href kutip ganda maupun tunggal harus terbaca",
  );
});

test("ambilMovieData() membaca label khusus serial", () => {
  const md = ambilMovieData(potongArtikel(HTML_TV));
  assert.equal(md["number of episode"].teks, "7");
  assert.equal(md.network.tautan[0].nama, "MGM+");
  assert.equal(md["last air date"].teks, "23 Aug 2026");
});

// ── Download ─────────────────────────────────────────────────────────────────

test("ambilDownload() ambil host asli dan buang tautan internal/telegram", () => {
  const dl = ambilDownload(HTML_FILM);
  assert.equal(dl.length, 2, "hanya 2 tautan unduhan sah");
  assert.deepEqual(
    dl.map((d) => d.host),
    ["veev.to", "morencius.com"],
  );
  assert.deepEqual(
    dl.map((d) => d.nomor),
    [1, 2],
    "nomor diambil dari atribut title",
  );
  assert.ok(!dl.some((d) => /t\.me|pcverge\.com/.test(d.url)));
});

test("ambilDownload() balikin array kosong kalau blok tidak ada", () => {
  assert.deepEqual(ambilDownload("<html><body>tidak ada apa-apa</body></html>"), []);
  assert.deepEqual(ambilDownload(null), []);
});

// ── Daftar episode ───────────────────────────────────────────────────────────

test("daftarEpisodeDariHtml() buang 'View All Episodes', #respond, dan /feed/", () => {
  const eps = daftarEpisodeDariHtml(HTML_TV);
  assert.equal(eps.length, 2, "hanya 2 episode nyata");
  assert.ok(!eps.some((e) => e.url.includes("#")), "anchor komentar harus dibuang");
  assert.ok(!eps.some((e) => e.url.includes("/feed/")), "feed harus dibuang");
  assert.ok(!eps.some((e) => e.url.includes("/tv/")), "tautan serial bukan episode");
});

test("daftarEpisodeDariHtml() mengurutkan dan mengisi season/episode", () => {
  const eps = daftarEpisodeDariHtml(HTML_TV);
  assert.deepEqual(
    eps.map((e) => `S${e.season}E${e.episode}`),
    ["S1E1", "S1E2"],
    "urut naik walau di HTML terbalik",
  );
  assert.equal(eps[0].slug, "contoh-season-1-episode-1");
});

// ── Validasi argumen (tanpa jaringan) ────────────────────────────────────────

test("daftar() menolak tipe tak dikenal", async () => {
  await assert.rejects(() => daftar("kartun"), /tipe harus salah satu dari/);
});

test("daftar() menolak perPage di atas batas WordPress", async () => {
  await assert.rejects(() => daftar("movie", { perPage: MAX_PER_PAGE + 1 }), /melebihi batas WordPress/);
  await assert.rejects(() => daftar("movie", { page: 0 }), /page harus bilangan bulat/);
});

test("daftar() menolak orderby yang upstream tolak (views)", async () => {
  await assert.rejects(() => daftar("movie", { orderby: "views" }), /tidak didukung upstream/);
  assert.ok(!ORDERBY.includes("views"), "views tidak boleh masuk daftar sah");
});

test("filter() menolak taksonomi asing dan taksonomi salah tipe", async () => {
  await assert.rejects(() => filter("movie", { studio: 5 }), /tidak dikenal/);
  await assert.rejects(() => filter("movie", { network: 5 }), /tidak berlaku untuk tipe "movie"/);
  await assert.rejects(() => filter("movie", {}), /filter kosong/);
});

test("cari(), cariSemua(), getBySlug(), getById(), getPlayer() memvalidasi argumen", async () => {
  await assert.rejects(() => cari("   "), /tidak boleh kosong/);
  await assert.rejects(() => cariSemua(""), /tidak boleh kosong/);
  await assert.rejects(() => getBySlug("", "movie"), /slug tidak boleh kosong/);
  await assert.rejects(() => getById("abc"), /id harus bilangan bulat/);
  await assert.rejects(() => getPlayer(0, 1), /postId harus bilangan bulat/);
  await assert.rejects(() => getPlayer(104124, 0), /tab harus bilangan bulat/);
});

test("getTerm() menolak nama taksonomi asing", async () => {
  await assert.rejects(() => getTerm("studio"), /tidak dikenal/);
});

// ── Peta konfigurasi ─────────────────────────────────────────────────────────

test("route() memuat endpoint AJAX dan pemetaan taksonomi yang benar", () => {
  const r = route();
  assert.equal(r.ajax, `${BASE}/wp-admin/admin-ajax.php`);
  assert.match(r.ajaxAction, /muvipro_player_content/);
  assert.equal(r.postType.movie, "posts");
  assert.equal(r.batas.perPage, MAX_PER_PAGE);
  assert.equal(r.taksonomi.cast.rest, "muvicast");
  assert.equal(r.taksonomi.cast.url, "/cast/", "rest_base != prefix URL arsip");
  assert.equal(r.taksonomi.categories.url, "/genre/");
  assert.deepEqual(r.taksonomi.network.untuk, ["tv"]);
});

test("TAKSONOMI dan POST_TYPE tidak bisa diubah dari luar", () => {
  assert.ok(Object.isFrozen(TAKSONOMI));
  assert.ok(Object.isFrozen(POST_TYPE));
});
