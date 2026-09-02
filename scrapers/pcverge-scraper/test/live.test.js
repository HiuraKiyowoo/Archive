// Test LIVE — benar-benar menembak pcverge.com. Dipisah dari index.test.js
// supaya gangguan jaringan tidak dianggap parser rusak.
//
// PERINGATAN: judul yang tercetak di log test bisa memuat konten dewasa, karena
// katalog upstream memang mencampurnya. Test sengaja TIDAK memfilter, biar yang
// diverifikasi adalah data upstream apa adanya.
//
// Transport serial + jeda 900 ms, jadi berkas ini memakan waktu (~2 menit).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  daftar,
  getFilm,
  getSerial,
  getEpisode,
  getBlog,
  getTerm,
  getGenre,
  filter,
  filterBySlug,
  cari,
  cariSemua,
  getBySlug,
  getById,
  getDetail,
  getDetailHtml,
  getPlayer,
  getSemuaPlayer,
  semuaEpisode,
  ApiError,
  HttpError,
  restGet,
  BASE,
  MAX_PER_PAGE,
} from "../src/index.js";

// Patokan dari recon 2026-09-01. Angka nyata bisa naik (situs terus posting),
// jadi yang diuji adalah BATAS BAWAH, bukan kesamaan persis.
const MIN_FILM = 9800;
const MIN_TV = 1300;
const MIN_EPISODE = 13000;
const MIN_GENRE = 40;

const SLUG_FILM = "cemd-882-dua-maling-tobrut-diberi-hukuman-enak";
const ID_FILM = 104124;
const SLUG_TV = "the-westies-2026";
const SLUG_EPS = "the-westies-season-1-episode-7";
const ID_EPS = 104277;

// ── Katalog ──────────────────────────────────────────────────────────────────

test("live: getFilm() balikin katalog film + total sesuai skala situs", async () => {
  const r = await getFilm({ perPage: 3 });
  assert.equal(r.jumlah, 3);
  assert.ok(r.totalItem >= MIN_FILM, `totalItem film ${r.totalItem} < ${MIN_FILM}`);
  assert.ok(r.totalHalaman > 3000);
  for (const x of r.hasil) {
    assert.ok(Number.isInteger(x.id), "id wajib angka");
    assert.ok(x.judul && x.judul.length > 0, "judul tidak boleh kosong");
    assert.ok(x.slug, "slug wajib ada");
    assert.ok(x.url.startsWith(BASE), "url harus absolut ke host resmi");
    assert.equal(x.tipe, "movie");
    assert.ok(x.poster, "poster wajib ada (via _embed)");
    assert.ok(x.tanggal, "tanggal wajib ada");
  }
});

test("live: getSerial() dan getEpisode() jalan dengan total yang wajar", async () => {
  const tv = await getSerial({ perPage: 2 });
  assert.ok(tv.totalItem >= MIN_TV, `totalItem tv ${tv.totalItem} < ${MIN_TV}`);
  assert.equal(tv.hasil[0].tipe, "tv");
  assert.ok(tv.hasil[0].poster, "poster serial wajib ada");

  const ep = await getEpisode({ perPage: 2 });
  assert.ok(ep.totalItem >= MIN_EPISODE, `totalItem episode ${ep.totalItem} < ${MIN_EPISODE}`);
  assert.equal(ep.hasil[0].tipe, "episode");
});

test("live: getBlog() post type terdaftar tapi praktis kosong", async () => {
  const b = await getBlog({ perPage: 2 });
  assert.equal(b.totalItem, 1, "blogs cuma punya 1 entri");
  assert.equal(b.hasil.length, 1);
});

test("live: taksonomi ikut lewat _embed, bukan cuma daftar id", async () => {
  const r = await getFilm({ perPage: 1 });
  const x = r.hasil[0];
  assert.ok(x.kategoriId.length > 0, "id kategori wajib ada");
  assert.ok(x.term.length > 0, "nama term wajib ikut lewat _embed");
  const taks = new Set(x.term.map((t) => t.taksonomi));
  assert.ok(taks.has("category"), `taksonomi category harus ada, dapat: ${[...taks].join(",")}`);
  for (const t of x.term) {
    assert.ok(t.nama && t.nama.length > 0, "nama term tidak boleh kosong");
    assert.ok(t.slug, "slug term tidak boleh kosong");
  }
});

test("live: urutan orderby=id&order=asc benar-benar berubah", async () => {
  const asc = await daftar("movie", { perPage: 2, orderby: "id", order: "asc", embed: false });
  const desc = await daftar("movie", { perPage: 2, orderby: "id", order: "desc", embed: false });
  assert.ok(asc.hasil[0].id < desc.hasil[0].id, "id terkecil harus < id terbesar");
  assert.ok(asc.hasil[0].id < asc.hasil[1].id, "asc harus naik");
});

// ── Batas upstream (bukan bug, tapi harus terdokumentasi) ────────────────────

test("live: per_page 101 ditolak upstream 400 rest_invalid_param", async () => {
  await assert.rejects(
    () => restGet("posts", { per_page: MAX_PER_PAGE + 1 }),
    (e) => e instanceof HttpError && e.status === 400 && /per_page/i.test(e.body ?? ""),
  );
});

test("live: halaman di luar jangkauan ditolak 400 (batas normal, bukan gangguan)", async () => {
  await assert.rejects(
    () => restGet("posts", { per_page: 1, page: 999999 }),
    (e) => e instanceof HttpError && e.status === 400,
  );
});

test("live: orderby=views ditolak upstream — alasan fungsi terpopuler tidak ada", async () => {
  await assert.rejects(
    () => restGet("posts", { per_page: 1, orderby: "views" }),
    (e) => e instanceof HttpError && e.status === 400,
  );
});

// ── Taksonomi ────────────────────────────────────────────────────────────────

test("live: getGenre() balikin term + URL arsip dari prefix yang benar", async () => {
  const g = await getGenre({ perPage: 5 });
  assert.equal(g.restBase, "categories");
  assert.equal(g.prefixUrl, "/genre/");
  assert.ok(g.totalItem >= MIN_GENRE, `total genre ${g.totalItem} < ${MIN_GENRE}`);
  for (const t of g.hasil) {
    assert.ok(Number.isInteger(t.id));
    assert.ok(t.nama && t.nama.length > 0);
    assert.ok(t.jumlahPost > 0, "genre kosong tidak diharapkan di halaman 1 urut count");
    assert.equal(t.url, `${BASE}/genre/${t.slug}/`);
  }
});

test("live: taksonomi muvinetwork cuma untuk tv dan URL arsipnya /network/", async () => {
  const n = await getTerm("network", { perPage: 3 });
  assert.equal(n.restBase, "muvinetwork");
  assert.equal(n.prefixUrl, "/network/");
  assert.deepEqual(n.untuk, ["tv"]);
  assert.ok(n.totalItem > 100);
  assert.ok(n.hasil[0].url.includes("/network/"));
});

test("live: filterBySlug() resolusi slug->id lalu benar-benar memfilter", async () => {
  const r = await filterBySlug("movie", "categories", "drama", { perPage: 3 });
  assert.equal(r.term.slug, "drama");
  assert.ok(r.term.id > 0);
  assert.equal(r.urlArsip, `${BASE}/genre/drama/`);
  assert.ok(r.totalItem > 500, `hasil filter drama ${r.totalItem} terlalu kecil`);
  assert.ok(r.totalItem < 9000, "filter harus mengecilkan hasil, bukan balikin semua");
  assert.equal(r.jumlah, 3);
});

test("live: filterBySlug() melempar ApiError untuk slug term yang tidak ada", async () => {
  await assert.rejects(
    () => filterBySlug("tv", "network", "slug-yang-pasti-tidak-ada-123"),
    (e) => e instanceof ApiError && e.code === "term_tidak_ada",
  );
});

test("live: filter taksonomi khusus tv (muvinetwork) berfungsi di post type tv", async () => {
  const r = await filterBySlug("tv", "network", "netflix", { perPage: 2 });
  assert.ok(r.totalItem > 50, `serial Netflix ${r.totalItem} terlalu sedikit`);
  assert.equal(r.term.nama, "Netflix");
  for (const x of r.hasil) assert.equal(x.tipe, "tv");
});

test("live: filter dengan id term ngawur balikin 0 hasil + catatan (gagal senyap)", async () => {
  const r = await filter("movie", { categories: 99999999 }, { perPage: 2 });
  assert.equal(r.jumlah, 0);
  assert.match(r.catatan ?? "", /Cek id term/);
});

// ── Pencarian ────────────────────────────────────────────────────────────────

test("live: cariSemua() lintas post type balikin subtype berbeda", async () => {
  const r = await cariSemua("avatar", { perPage: 5 });
  assert.ok(r.totalItem > 20, `hasil cari-semua ${r.totalItem} terlalu sedikit`);
  for (const x of r.hasil) {
    assert.ok(x.judul && x.judul.length > 0);
    assert.ok(x.url.startsWith(BASE));
    assert.ok(x.tipe, "tipe/subtype wajib ada");
  }
  const tipe = new Set(r.hasil.map((x) => x.tipe));
  assert.ok(tipe.size >= 1);
});

test("live: cari() di satu post type mengembalikan hasil relevan", async () => {
  const r = await cari("avatar", { tipe: "tv", perPage: 3 });
  assert.ok(r.totalItem > 0);
  assert.ok(
    r.hasil.some((x) => /avatar/i.test(x.judul)),
    "minimal satu judul memuat kata kunci",
  );
});

// ── Item tunggal ─────────────────────────────────────────────────────────────

test("live: getBySlug() dan getById() menunjuk item yang sama", async () => {
  const a = await getBySlug(SLUG_FILM, "movie");
  assert.ok(a, "slug patokan harus masih ada");
  assert.equal(a.id, ID_FILM);
  const b = await getById(ID_FILM, "movie");
  assert.equal(b.slug, a.slug);
  assert.equal(b.judul, a.judul);
});

test("live: getBySlug() balikin null untuk slug yang tidak ada", async () => {
  const r = await getBySlug("slug-tidak-mungkin-ada-987654", "movie");
  assert.equal(r, null);
});

// ── Player via admin-ajax ────────────────────────────────────────────────────

test("live: getPlayer() balikin iframe nyata tanpa nonce", async () => {
  const p = await getPlayer(ID_FILM, 1);
  assert.equal(p.tab, 1);
  assert.ok(p.embed, "embed tidak boleh null");
  assert.match(p.embed, /^https?:\/\//, "embed harus URL absolut");
  assert.ok(p.host && p.host.includes("."), "host embed wajib terbaca");
  assert.equal(p.kosong, false);
});

test("live: getSemuaPlayer() balikin 5 server dengan host berbeda-beda", async () => {
  const r = await getSemuaPlayer(ID_FILM);
  assert.equal(r.jumlahServer, 5, `dapat ${r.jumlahServer} server, harusnya 5`);
  assert.deepEqual(r.tabKosong, [], "tidak ada tab kosong untuk film ini");
  const host = new Set(r.server.map((s) => s.host));
  assert.ok(host.size >= 4, `host harus beragam, dapat: ${[...host].join(",")}`);
  for (const s of r.server) {
    assert.match(s.embed, /^https?:\/\//);
    assert.equal(s.label, `Server ${s.tab}`);
  }
});

test("live: player episode ada dan berbeda dari player film", async () => {
  const film = await getPlayer(ID_FILM, 1);
  const eps = await getPlayer(ID_EPS, 1);
  assert.ok(eps.embed, "episode harus punya embed");
  assert.notEqual(eps.embed, film.embed, "embed episode tidak boleh sama dengan film");
});

test("live: embed stabil kalau tab yang sama ditembak dua kali", async () => {
  const a = await getPlayer(ID_EPS, 2);
  const b = await getPlayer(ID_EPS, 2);
  assert.equal(a.embed, b.embed, "embed tidak boleh berotasi antar request");
});

// ── HTML: rating, durasi, download ───────────────────────────────────────────

test("live: getDetailHtml() ambil rating/durasi/kualitas dari artikel utama", async () => {
  const h = await getDetailHtml(`${BASE}/film-semi/${SLUG_FILM}/`);
  assert.equal(h.postId, ID_FILM, "postId dari data-id harus sama dengan id REST");
  assert.ok(h.rating > 0 && h.rating <= 10, `rating ${h.rating} di luar rentang`);
  assert.ok(h.jumlahVote > 0, "jumlah vote wajib > 0");
  assert.match(h.durasi ?? "", /\d+\s*Min/i, `durasi tidak terbaca: ${h.durasi}`);
  assert.ok(h.kualitas, "kualitas wajib terbaca");
  assert.ok(h.genre.length > 0, "genre wajib terbaca dari HTML");
  assert.deepEqual(h.tabPlayer, [1, 2, 3, 4, 5], "5 tab player harus terdeteksi");
});

test("live: download diambil dari HTML dengan host pihak ketiga", async () => {
  const h = await getDetailHtml(`${BASE}/film-semi/${SLUG_FILM}/`);
  assert.ok(h.download.length >= 1, "wajib ada minimal 1 tautan unduhan");
  for (const d of h.download) {
    assert.match(d.url, /^https?:\/\//);
    assert.ok(!d.url.includes("pcverge.com"), "tautan internal harus dibuang");
    assert.ok(d.host, "host wajib terbaca");
    assert.ok(Number.isInteger(d.nomor) && d.nomor > 0, "nomor tautan wajib angka");
  }
});

test("live: rating yang terbaca bukan milik kartu rekomendasi", async () => {
  const h = await getDetailHtml(`${BASE}/film-semi/${SLUG_FILM}/`);
  const d = await getDetail(SLUG_FILM, "movie", { player: false });
  assert.equal(d.rating, h.rating, "rating detail harus konsisten dengan parser HTML");
  assert.equal(d.jumlahVote, h.jumlahVote);
});

// ── Gabungan ─────────────────────────────────────────────────────────────────

test("live: getDetail() film lengkap tanpa field yang seharusnya terisi jadi null", async () => {
  const d = await getDetail(SLUG_FILM, "movie");
  assert.equal(d.id, ID_FILM);
  assert.ok(d.judul);
  assert.ok(d.poster, "poster wajib ada");
  assert.ok(d.rating > 0, "rating wajib terisi");
  assert.ok(d.jumlahVote > 0, "vote wajib terisi");
  assert.ok(d.durasi, "durasi wajib terisi");
  assert.ok(d.kualitas, "kualitas wajib terisi");
  assert.ok(d.tahun > 1900, "tahun wajib terisi");
  assert.ok(d.genre.length > 0, "genre wajib terisi");
  assert.ok(d.negara.length > 0, "negara wajib terisi");
  assert.equal(d.jumlahServer, 5, "5 server player wajib terisi");
  assert.ok(d.download.length >= 1, "download wajib terisi");
  assert.equal(d.catatan, null, "tidak boleh ada catatan kegagalan");
  assert.equal(d.views, null, "views memang tidak tersedia di situs ini");
});

test("live: getDetail() serial — tidak ada tab player, dan itu dinyatakan jujur", async () => {
  const d = await getDetail(SLUG_TV, "tv");
  assert.equal(d.tipe, "tv");
  assert.ok(d.rating > 0, "rating serial wajib terisi");
  assert.ok(d.jaringan.length > 0, "jaringan (network) wajib terisi untuk serial");
  assert.ok(d.jumlahEpisodeMeta > 0, "jumlah episode meta wajib terisi");
  assert.ok(d.daftarEpisode.length > 0, "daftar episode wajib terisi");
  assert.equal(d.jumlahServer, 0, "halaman serial memang tidak punya player");
  assert.deepEqual(d.tabKosong, [], "jangan tembak AJAX kalau tab tidak dirender");
  assert.match(d.catatan?.[0] ?? "", /tidak merender tab player/);
});

test("live: getDetail() episode punya player dan download sendiri", async () => {
  const d = await getDetail(SLUG_EPS, "episode");
  assert.equal(d.id, ID_EPS);
  assert.equal(d.tipe, "episode");
  assert.equal(d.jumlahServer, 5, "episode wajib punya 5 server");
  assert.ok(d.download.length >= 1, "episode wajib punya tautan unduhan");
  assert.ok(d.kualitas, "kualitas episode wajib terbaca");
  assert.equal(d.catatan, null);
});

test("live: getDetail() melempar ApiError untuk slug yang tidak ada", async () => {
  await assert.rejects(
    () => getDetail("slug-tidak-mungkin-ada-987654", "movie"),
    (e) => e instanceof ApiError && e.code === "tidak_ada",
  );
});

test("live: semuaEpisode() ambil player tiap episode tanpa tabrakan nomor", async () => {
  const r = await semuaEpisode(SLUG_TV, { batas: 2 });
  assert.equal(r.jumlahEpisode, 2);
  assert.deepEqual(r.gagal, [], "tidak boleh ada episode yang gagal");
  assert.ok(r.totalEpisodeDiHalaman >= 2);
  const embeds = new Set();
  for (const e of r.episode) {
    assert.ok(Number.isInteger(e.episode), `nomor episode harus angka, dapat: ${JSON.stringify(e.episode)}`);
    assert.ok(Number.isInteger(e.season));
    assert.ok(e.judul, "judul episode wajib terisi dari REST");
    assert.ok(e.jumlahServer > 0, "tiap episode wajib punya server");
    embeds.add(e.server[0].embed);
  }
  assert.equal(embeds.size, 2, "tiap episode harus punya embed sendiri");
});
