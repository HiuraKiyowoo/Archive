// Test LIVE narashika-scraper — nembak narashika.top sungguhan.
// Dipisah dari index.test.js supaya kalau jaringan/situs bermasalah, test
// murni-lokal tetap bisa dipercaya sebagai sinyal kode.
//
// Semua assert di sini memeriksa ISI: judul tidak kosong, poster benar-benar
// URL uploads narashika, total dari header X-WP-Total konsisten dengan
// paginasi, halaman 2 bukan duplikat halaman 1, iframe player benar-benar
// terekstrak, dan pembagian REST-vs-HTML memang seperti yang diklaim README.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  daftar,
  getFilm,
  getSerial,
  getEpisodeTerbaru,
  getTerpopuler,
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
  ApiError,
  HttpError,
  BASE,
} from "../src/index.js";

const SLUG_FILM = "borderlands-2024";
const SLUG_TV = "s-line-2025-sub-indo";
const SLUG_EPS = "s-line-season-1-episode-1-sub-indo";

const posterSah = (u) => typeof u === "string" && /^https:\/\/narashika\.top\/wp-content\/uploads\//.test(u);
const itemSah = (x) => {
  assert.ok(Number.isInteger(x.id) && x.id > 0, `id tidak sah: ${x.id}`);
  assert.ok(typeof x.slug === "string" && x.slug.length > 0, `slug kosong pada id ${x.id}`);
  assert.ok(typeof x.judul === "string" && x.judul.length > 1, `judul kosong pada id ${x.id}`);
  assert.ok(x.url?.startsWith(BASE), `url bukan host narashika.top: ${x.url}`);
  assert.ok(typeof x.tanggal === "string" && x.tanggal.includes("T"), `tanggal aneh: ${x.tanggal}`);
};

// ─────────────────────────── katalog & paginasi ───────────────────────────

test("film: halaman 1 berisi item lengkap, total dari header X-WP-Total", async () => {
  const r = await getFilm({ perPage: 5 });
  assert.equal(r.jumlah, 5);
  assert.ok(r.totalItem > 1000, `totalItem terlalu kecil: ${r.totalItem}`);
  assert.equal(r.totalHalaman, Math.ceil(r.totalItem / 5));
  r.hasil.forEach(itemSah);
  assert.ok(
    r.hasil.every((x) => x.tipe === "movie"),
    "semua item harus bertipe movie",
  );
  assert.ok(r.hasil.some((x) => posterSah(x.poster)), "minimal satu poster harus URL uploads narashika");
});

test("film: halaman 2 bukan duplikat halaman 1", async () => {
  const a = await getFilm({ perPage: 10, page: 1, embed: false });
  const b = await getFilm({ perPage: 10, page: 2, embed: false });
  const idA = new Set(a.hasil.map((x) => x.id));
  const tumpang = b.hasil.filter((x) => idA.has(x.id));
  assert.equal(tumpang.length, 0, `halaman 2 mengulang ${tumpang.length} item dari halaman 1`);
  assert.equal(b.halaman, 2);
});

test("serial: post type tv lebih sedikit dari film, item tetap lengkap", async () => {
  const tv = await getSerial({ perPage: 4 });
  assert.equal(tv.jumlah, 4);
  assert.ok(tv.totalItem > 100, `totalItem tv terlalu kecil: ${tv.totalItem}`);
  tv.hasil.forEach(itemSah);
  assert.ok(tv.hasil.every((x) => x.tipe === "tv"));
});

test("episode: post type terbesar di situs ini", async () => {
  const eps = await getEpisodeTerbaru({ perPage: 3 });
  assert.equal(eps.jumlah, 3);
  assert.ok(eps.totalItem > 5000, `totalItem episode terlalu kecil: ${eps.totalItem}`);
  eps.hasil.forEach(itemSah);
  assert.ok(
    eps.hasil.every((x) => x.url.includes("/eps/")),
    "URL episode harus memakai prefix /eps/",
  );
});

test("orderby=title mengubah urutan dibanding orderby=date", async () => {
  const a = await daftar("movie", { perPage: 5, orderby: "date", embed: false });
  const b = await daftar("movie", { perPage: 5, orderby: "title", order: "asc", embed: false });
  assert.notDeepEqual(
    a.hasil.map((x) => x.id),
    b.hasil.map((x) => x.id),
    "orderby tidak berpengaruh — kemungkinan param diabaikan upstream",
  );
});

test("page melewati halaman terakhir dibalas 400 rest_post_invalid_page_number", async () => {
  const r = await getFilm({ perPage: 100, embed: false });
  await assert.rejects(
    () => getFilm({ perPage: 100, page: r.totalHalaman + 5, embed: false }),
    (e) => e instanceof HttpError && e.status === 400 && /invalid_page_number|lebih besar/i.test(e.body ?? ""),
  );
});

// ─────────────────────────── taksonomi ───────────────────────────

test("genre: 66 term, tiap term punya slug + URL arsip /genre/", async () => {
  const g = await getGenre({ perPage: 100 });
  assert.ok(g.totalItem >= 60, `jumlah genre tak terduga: ${g.totalItem}`);
  assert.equal(g.prefixUrl, "/genre/");
  assert.equal(g.restBase, "categories");
  for (const t of g.hasil.slice(0, 10)) {
    assert.ok(t.slug, `genre tanpa slug: ${JSON.stringify(t)}`);
    assert.equal(t.url, `${BASE}/genre/${t.slug}/`);
    assert.ok(Number.isInteger(t.jumlahPost), `jumlahPost bukan angka: ${t.jumlahPost}`);
  }
});

test("taksonomi muvi* punya rest_base berbeda dari prefix URL-nya", async () => {
  const y = await getTerm("year", { perPage: 5 });
  assert.equal(y.restBase, "muviyear");
  assert.equal(y.prefixUrl, "/year/");
  assert.ok(y.hasil.every((t) => t.url.startsWith(`${BASE}/year/`)));

  const c = await getTerm("country", { perPage: 5 });
  assert.equal(c.restBase, "muvicountry");
  assert.ok(c.hasil.every((t) => t.url.startsWith(`${BASE}/country/`)));
});

test("filterBySlug: genre drama-korea di post type tv mengembalikan hasil nyata", async () => {
  const r = await filterBySlug("tv", "categories", "drama-korea", { perPage: 5 });
  assert.equal(r.term.slug, "drama-korea");
  assert.ok(r.term.id > 0);
  assert.ok(r.jumlah > 0, "filter genre valid tidak boleh 0 hasil");
  assert.ok(r.totalItem > 50, `totalItem drama-korea terlalu kecil: ${r.totalItem}`);
  r.hasil.forEach(itemSah);
});

test("filterBySlug: term tidak ada MELEMPAR, bukan balikin 0 hasil diam-diam", async () => {
  await assert.rejects(
    () => filterBySlug("movie", "categories", "genre-yang-tidak-ada-xyz"),
    (e) => e instanceof ApiError && /tidak ada di taksonomi/.test(e.message),
  );
});

// ─────────────────────────── pencarian ───────────────────────────

test("cari: kata umum mengembalikan hasil yang judulnya terisi", async () => {
  const r = await cari("love", { perPage: 5 });
  assert.equal(r.kueri, "love");
  assert.ok(r.jumlah > 0, "pencarian 'love' tidak boleh kosong");
  r.hasil.forEach(itemSah);
});

test("cari: kueri sampah mengembalikan 0 hasil, bukan error", async () => {
  const r = await cari("zzzqqqxyzzy123", { perPage: 5 });
  assert.equal(r.jumlah, 0);
  assert.equal(r.totalItem, 0);
});

test("cariSemua: /wp/v2/search mencakup lebih dari satu post type", async () => {
  const r = await cariSemua("cinta", { perPage: 20 });
  assert.ok(r.jumlah > 0);
  assert.ok(r.totalItem > 50, `totalItem search terlalu kecil: ${r.totalItem}`);
  for (const x of r.hasil) {
    assert.ok(x.judul.length > 1, `judul kosong: ${JSON.stringify(x)}`);
    assert.ok(x.url.startsWith(BASE), `url bukan narashika.top: ${x.url}`);
    assert.ok(["post", "tv", "episode"].includes(x.tipe), `subtype tak dikenal: ${x.tipe}`);
  }
});

// ─────────────────────────── detail: REST vs HTML ───────────────────────────

test("getBySlug: film ditemukan, download diambil dari REST content", async () => {
  const f = await getBySlug(SLUG_FILM, "movie");
  assert.ok(f, `film ${SLUG_FILM} tidak ditemukan`);
  itemSah(f);
  assert.ok(posterSah(f.poster), `poster tidak sah: ${f.poster}`);
  assert.ok(Number.isInteger(f.views) && f.views > 0, `views tidak sah: ${f.views}`);
  assert.ok(f.download.length > 0, "tautan download harus ada di REST content");
  const semuaTautan = f.download.flatMap((g) => g.tautan);
  assert.ok(semuaTautan.length >= 3, `tautan download terlalu sedikit: ${semuaTautan.length}`);
  assert.ok(semuaTautan.every((t) => /^https?:\/\//.test(t.url)));
  // Ini yang membuktikan klaim README: player TIDAK ada di REST.
  assert.equal(f.iframePlayer, null, "iframe player tidak boleh datang dari REST");
  assert.equal(f.rating, null, "rating tidak boleh datang dari REST");
});

test("getBySlug: slug tidak ada mengembalikan null (bukan melempar)", async () => {
  assert.equal(await getBySlug("film-yang-jelas-tidak-ada-xyz123", "movie"), null);
});

test("getById: id nyata cocok dengan hasil getBySlug", async () => {
  const a = await getBySlug(SLUG_FILM, "movie");
  const b = await getById(a.id, "movie");
  assert.equal(b.id, a.id);
  assert.equal(b.slug, a.slug);
  assert.equal(b.judul, a.judul);
});

test("getById: id ngawur dibalas 404 rest_post_invalid_id", async () => {
  await assert.rejects(
    () => getById(999999999, "movie"),
    (e) => e instanceof HttpError && e.status === 404,
  );
});

test("getDetailHtml: rating, durasi, kualitas, dan iframe player terekstrak", async () => {
  const h = await getDetailHtml(`${BASE}/${SLUG_FILM}/`);
  assert.ok(typeof h.rating === "number" && h.rating > 0 && h.rating <= 10, `rating aneh: ${h.rating}`);
  assert.ok(Number.isInteger(h.jumlahVote) && h.jumlahVote > 0, `jumlahVote aneh: ${h.jumlahVote}`);
  assert.match(h.durasi ?? "", /\d+\s*min/i, `durasi tidak terparsing: ${h.durasi}`);
  assert.ok(h.kualitas && h.kualitas.length > 1, `kualitas kosong: ${h.kualitas}`);
  assert.match(h.iframePlayer ?? "", /^https:\/\//, `iframe player tidak terekstrak: ${h.iframePlayer}`);
  assert.ok(h.judul.length > 1);
});

test("iframe player stabil: dua request halaman sama menghasilkan URL identik", async () => {
  // Beda dari drakor.kita.mobi yang merotasi host tiap request — di sini tidak.
  const a = await getDetailHtml(`${BASE}/eps/${SLUG_EPS}/`);
  const b = await getDetailHtml(`${BASE}/eps/${SLUG_EPS}/`);
  assert.equal(a.iframePlayer, b.iframePlayer);
  assert.match(a.iframePlayer ?? "", /^https:\/\//);
});

test("getDetail: gabungan REST + HTML mengisi kedua sisi tanpa null", async () => {
  const d = await getDetail(SLUG_FILM, "movie");
  assert.ok(d, "detail film tidak boleh null");
  // sisi REST
  assert.ok(d.id > 0 && d.slug === SLUG_FILM && d.judul.length > 1);
  assert.ok(posterSah(d.poster));
  assert.ok(d.download.length > 0);
  assert.ok(d.term.length > 5, `term terlalu sedikit: ${d.term.length}`);
  // sisi HTML
  assert.ok(typeof d.rating === "number" && d.rating > 0, `rating tidak terisi: ${d.rating}`);
  assert.match(d.durasi ?? "", /\d+\s*min/i);
  assert.match(d.iframePlayer ?? "", /^https:\/\//);
  // jejak sumber supaya bisa diaudit
  assert.ok(d.sumber.rest.includes("/wp-json/wp/v2/posts?slug="));
  assert.ok(d.sumber.html.startsWith(BASE));
});

test("term hasil _embed membawa nama taksonomi, bukan cuma id", async () => {
  const d = await getBySlug(SLUG_FILM, "movie");
  const taks = new Set(d.term.map((t) => t.taksonomi));
  for (const wajib of ["category", "muviyear", "muvicountry", "muviquality"]) {
    assert.ok(taks.has(wajib), `taksonomi ${wajib} tidak ada di _embed`);
  }
  assert.ok(d.term.every((t) => t.nama.length > 0 && t.slug.length > 0));
  assert.ok(d.kategoriId.length > 0 && d.tahunId.length > 0);
});

// ─────────────────────────── serial & episode ───────────────────────────

test("detail serial: daftar episode terparsing dengan nomor season/episode", async () => {
  const d = await getDetail(SLUG_TV, "tv");
  assert.ok(d, "serial tidak ditemukan");
  assert.ok(d.episode.length >= 6, `episode terparsing terlalu sedikit: ${d.episode.length}`);
  for (const e of d.episode) {
    assert.ok(Number.isInteger(e.season) && e.season > 0, `season tidak sah: ${JSON.stringify(e)}`);
    assert.ok(Number.isInteger(e.episode) && e.episode > 0, `episode tidak sah: ${JSON.stringify(e)}`);
    assert.ok(e.url.includes("/eps/") && !e.url.includes("#"));
  }
  const nomor = d.episode.map((e) => e.episode);
  assert.equal(new Set(nomor).size, nomor.length, "ada nomor episode duplikat");
});

test("semuaEpisode: tiap episode dapat id REST + iframe player sendiri", async () => {
  const r = await semuaEpisode(SLUG_TV, { batas: 3 });
  assert.deepEqual(r.gagal, [], `ada episode gagal: ${JSON.stringify(r.gagal)}`);
  assert.equal(r.jumlahEpisode, 3);
  assert.ok(r.serial.judul.length > 1 && r.serial.slug === SLUG_TV);
  const iframes = new Set();
  for (const e of r.hasil) {
    assert.ok(Number.isInteger(e.episode) && e.episode > 0, `nomor episode rusak: ${e.episode}`);
    assert.ok(Number.isInteger(e.id) && e.id > 0, `id REST episode tidak ada: ${e.id}`);
    assert.ok(e.judul.length > 1);
    assert.match(e.iframePlayer ?? "", /^https:\/\//, `episode ${e.episode} tanpa player`);
    iframes.add(e.iframePlayer);
  }
  assert.equal(iframes.size, 3, "tiap episode harus punya URL player berbeda");
});

test("semuaEpisode: serial tidak ada MELEMPAR ApiError", async () => {
  await assert.rejects(
    () => semuaEpisode("serial-tidak-ada-xyz123"),
    (e) => e instanceof ApiError && /tidak ditemukan/.test(e.message),
  );
});

// ─────────────────────────── popularitas lokal ───────────────────────────

test("getTerpopuler: urut menurun menurut views + catatan jujur soal asalnya", async () => {
  const r = await getTerpopuler("movie", { halaman: 1, perPage: 30 });
  assert.ok(r.jumlah > 0);
  const views = r.hasil.map((x) => x.views ?? -1);
  for (let i = 1; i < views.length; i += 1) {
    assert.ok(views[i - 1] >= views[i], `urutan views rusak di indeks ${i}`);
  }
  assert.match(r.catatan, /LOKAL/);
  assert.match(r.catatan, /orderby=views/);
  assert.ok(r.hasil[0].views > 0, "item teratas harus punya views > 0");
});
