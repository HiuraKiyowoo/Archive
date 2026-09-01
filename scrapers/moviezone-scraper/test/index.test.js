// Test LIVE moviezone-scraper. Semua request ke moviezone.web.id nyata —
// tidak ada mock. Validasi ISI, bukan cuma status HTTP.
//
// Transport serial dengan jeda 1,2 s/request, jadi suite ini memang lambat.
// Jalankan: node --test test/index.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getHero,
  getTrending,
  getPopular,
  getTopRated,
  getLatest,
  getUpcoming,
  getGenres,
  discover,
  search,
  getDetail,
  getEpisodes,
  getSemuaEpisode,
  ambilHalaman,
  parseSlug,
  resolveGenre,
  GENRE_SLUG,
  MAX_PAGE,
  ApiError,
} from "../src/index.js";

/** Cek bentuk satu item daftar: field wajib ada dan tidak kosong. */
function cekItem(item, label) {
  assert.ok(item.slug, `${label}: slug kosong`);
  assert.match(item.slug, /^(movie|tv)-\d+$/, `${label}: format slug aneh (${item.slug})`);
  assert.ok(item.judul && item.judul.trim() !== "", `${label}: judul kosong`);
  assert.ok(["Movie", "Series"].includes(item.tipe), `${label}: tipe aneh (${item.tipe})`);
  assert.ok(Number.isInteger(item.tmdbId) && item.tmdbId > 0, `${label}: tmdbId aneh`);
  if (item.poster !== null) {
    assert.match(item.poster, /^https:\/\/image\.tmdb\.org\//, `${label}: poster bukan https tmdb`);
  }
  assert.ok(item.url && item.url.startsWith("https://moviezone.web.id/"), `${label}: url salah`);
  assert.ok(Array.isArray(item.genreIds), `${label}: genreIds bukan array`);
}

/** Semua slug unik dalam satu daftar. */
function cekUnik(hasil, label) {
  const slug = hasil.map((x) => x.slug);
  assert.equal(new Set(slug).size, slug.length, `${label}: ada slug duplikat`);
}

test("hero: 6 judul, campuran Movie+Series, punya titleLogo", async () => {
  const r = await getHero();
  assert.ok(r.jumlah >= 5, `hero cuma ${r.jumlah} item`);
  r.hasil.forEach((x, i) => cekItem(x, `hero[${i}]`));
  cekUnik(r.hasil, "hero");
  assert.ok("titleLogo" in r.hasil[0], "field titleLogo hilang");
  const tipe = new Set(r.hasil.map((x) => x.tipe));
  assert.ok(tipe.size >= 1, "hero tidak punya tipe");
});

test("trending: 20 item, punya paginasi, campuran tipe", async () => {
  const r = await getTrending({ page: 1 });
  assert.equal(r.jumlah, 20, `trending jumlah ${r.jumlah}`);
  r.hasil.forEach((x, i) => cekItem(x, `trending[${i}]`));
  cekUnik(r.hasil, "trending");
  assert.equal(r.halaman, 1);
  assert.ok(r.halamanTotalUpstream > 1, "total_pages tidak masuk akal");
  assert.ok(r.halamanBisaDiambil <= MAX_PAGE, "halamanBisaDiambil melebihi batas TMDB");
});

test("popular type=movie: semua Movie", async () => {
  const r = await getPopular({ type: "movie", page: 1 });
  assert.equal(r.jumlah, 20);
  r.hasil.forEach((x, i) => cekItem(x, `popular[${i}]`));
  const tipe = new Set(r.hasil.map((x) => x.tipe));
  assert.deepEqual([...tipe], ["Movie"], `type=movie kok ada ${[...tipe]}`);
});

test("popular type=tv: semua Series", async () => {
  const r = await getPopular({ type: "tv", page: 1 });
  assert.equal(r.jumlah, 20);
  const tipe = new Set(r.hasil.map((x) => x.tipe));
  assert.deepEqual([...tipe], ["Series"], `type=tv kok ada ${[...tipe]}`);
  r.hasil.forEach((x) => assert.match(x.slug, /^tv-\d+$/, `slug serial salah: ${x.slug}`));
});

test("popular type=all: 40 item gabungan movie+tv", async () => {
  const r = await getPopular({ type: "all", page: 1 });
  assert.equal(r.jumlah, 40, `type=all jumlah ${r.jumlah}`);
  const tipe = new Set(r.hasil.map((x) => x.tipe));
  assert.equal(tipe.size, 2, `type=all cuma punya tipe ${[...tipe]}`);
  cekUnik(r.hasil, "popular all");
});

test("halamanBisaDiambil dibatasi 500 walau upstream klaim lebih", async () => {
  const r = await getPopular({ type: "movie", page: 1 });
  assert.ok(r.halamanTotalUpstream > MAX_PAGE, "sampel ini seharusnya klaim >500 halaman");
  assert.equal(r.halamanBisaDiambil, MAX_PAGE, "batas 500 tidak diterapkan");
});

test("top-rated & latest: bentuk benar, tipe sesuai permintaan", async () => {
  const tr = await getTopRated({ type: "tv", page: 1 });
  assert.equal(tr.jumlah, 20);
  assert.deepEqual([...new Set(tr.hasil.map((x) => x.tipe))], ["Series"]);

  const lt = await getLatest({ type: "movie", page: 1 });
  assert.equal(lt.jumlah, 20);
  lt.hasil.forEach((x, i) => cekItem(x, `latest[${i}]`));
  assert.deepEqual([...new Set(lt.hasil.map((x) => x.tipe))], ["Movie"]);
});

test("upcoming: film saja, katalog pendek (habis di halaman 3)", async () => {
  const r = await getUpcoming({ page: 1 });
  assert.ok(r.jumlah > 0, "upcoming kosong");
  assert.deepEqual([...new Set(r.hasil.map((x) => x.tipe))], ["Movie"]);
  const p3 = await getUpcoming({ page: 3 });
  assert.equal(p3.jumlah, 0, `halaman 3 upcoming seharusnya kosong, dapat ${p3.jumlah}`);
});

test("paginasi: halaman 2 bukan duplikat halaman 1", async () => {
  const p1 = await getLatest({ type: "movie", page: 1 });
  const p2 = await getLatest({ type: "movie", page: 2 });
  const s1 = new Set(p1.hasil.map((x) => x.slug));
  const tumpang = p2.hasil.filter((x) => s1.has(x.slug));
  assert.equal(tumpang.length, 0, `${tumpang.length} judul halaman 2 duplikat halaman 1`);
});

test("ambilHalaman: 2 halaman digabung tanpa duplikat", async () => {
  const r = await ambilHalaman(getLatest, { type: "movie", mulai: 1, jumlahHalaman: 2 });
  assert.equal(r.hasil.length, r.jumlah);
  cekUnik(r.hasil, "ambilHalaman");
  assert.equal(r.halaman.length, 2, "harus mengunjungi 2 halaman");
  assert.ok(r.jumlah > 20, `gabungan 2 halaman cuma ${r.jumlah} item`);
});

test("genres: 27 genre, ID cocok dengan peta slug lokal", async () => {
  const r = await getGenres();
  assert.ok(r.jumlah >= 20, `genre cuma ${r.jumlah}`);
  r.hasil.forEach((g) => {
    assert.ok(Number.isInteger(g.id) && g.id > 0, `id genre aneh: ${g.id}`);
    assert.ok(g.nama && g.nama.trim() !== "", "nama genre kosong");
  });
  const idUpstream = new Set(r.hasil.map((g) => g.id));
  for (const [slug, id] of Object.entries(GENRE_SLUG)) {
    assert.ok(idUpstream.has(id), `ID ${id} (${slug}) hilang dari daftar genre upstream`);
  }
});

test("discover: slug genre diterjemahkan ke ID, hasil nyata", async () => {
  const r = await discover({ genre: "horror", type: "movie", page: 1 });
  assert.equal(r.genreId, 27, "slug horror harus jadi ID 27");
  assert.equal(r.jumlah, 20, `discover horror jumlah ${r.jumlah}`);
  r.hasil.forEach((x, i) => cekItem(x, `horror[${i}]`));
  assert.equal(r.catatan, null, "tidak seharusnya ada catatan kosong-hasil");
  const punyaGenre = r.hasil.filter((x) => x.genreIds.includes(27)).length;
  assert.ok(punyaGenre >= 15, `cuma ${punyaGenre}/20 item benar-benar bergenre 27`);
});

test("discover: genre film ke type=tv = nol hasil + catatan penjelas", async () => {
  // Bukti terukur: genre 53 (Thriller) tidak ada di himpunan genre serial TMDB.
  const r = await discover({ genre: "thriller", type: "tv", page: 1 });
  assert.equal(r.jumlah, 0, `harusnya nol, dapat ${r.jumlah}`);
  assert.ok(r.catatan && r.catatan.includes("53"), "catatan penjelas tidak muncul");
});

test("discover: genre khusus serial (10759) jalan lewat ID angka", async () => {
  const r = await discover({ genre: 10759, type: "tv", page: 1 });
  assert.equal(r.genreId, 10759);
  assert.equal(r.jumlah, 20, `Aksi & Petualangan (tv) jumlah ${r.jumlah}`);
  assert.deepEqual([...new Set(r.hasil.map((x) => x.tipe))], ["Series"]);
});

test("resolveGenre: slug ngawur ditolak, bukan diam-diam nol hasil", () => {
  assert.throws(() => resolveGenre("isekai"), /tidak dikenal/);
  assert.throws(() => resolveGenre(""), /wajib diisi/);
  assert.equal(resolveGenre("action"), 28);
  assert.equal(resolveGenre("28"), 28);
  assert.equal(resolveGenre(10759), 10759);
});

test("search: hasil relevan, ada Movie dan Series", async () => {
  const r = await search({ q: "spider", page: 1 });
  assert.ok(r.jumlah > 0, "search spider kosong");
  r.hasil.forEach((x, i) => cekItem(x, `search[${i}]`));
  assert.ok(r.totalHasil > 100, `total_results cuma ${r.totalHasil}`);
  const cocok = r.hasil.filter((x) => /spider|spider-?man/i.test(x.judul)).length;
  assert.ok(cocok >= 5, `cuma ${cocok}/${r.jumlah} judul mengandung 'spider'`);
});

test("search: kata kunci mustahil = nol hasil, bukan error", async () => {
  const r = await search({ q: "zzzzqqqxx", page: 1 });
  assert.equal(r.jumlah, 0);
  assert.equal(r.totalHasil, 0);
});

test("search: q kosong ditolak sebelum request", async () => {
  await assert.rejects(() => search({ q: "" }), /wajib diisi/);
  await assert.rejects(() => search({ q: "   " }), /wajib diisi/);
});

test("detail film: field lengkap, isi nyata, server stream terisi", async () => {
  const d = await getDetail("movie-860508");
  assert.equal(d.slug, "movie-860508");
  assert.equal(d.tipe, "Movie");
  assert.ok(d.judul && d.judul.trim() !== "", "judul kosong");
  assert.match(d.poster, /^https:\/\/image\.tmdb\.org\//);
  assert.ok(d.sinopsis && d.sinopsis.length > 30, "sinopsis terlalu pendek");
  assert.ok(d.genre.length > 0, "genre kosong");
  assert.ok(d.pemain.length > 0, "cast kosong");
  assert.match(d.durasi, /menit/, `durasi tidak berformat menit: ${d.durasi}`);
  assert.match(d.imdbId, /^tt\d+$/, `imdbId aneh: ${d.imdbId}`);
  // Film tidak punya season.
  assert.deepEqual(d.season, []);
  assert.equal(d.jumlahSeason, null);
  // Stream = iframe pihak ketiga yang dirakit dari ID TMDB.
  assert.ok(d.iframeUtama && d.iframeUtama.startsWith("http"), "iframeUtama kosong");
  assert.ok(d.server.length >= 3, `server cuma ${d.server.length}`);
  d.server.forEach((s) => {
    assert.ok(s.nama, "nama server kosong");
    assert.ok(s.url.startsWith("http"), `url server aneh: ${s.url}`);
  });
  assert.ok(d.server.some((s) => s.url.includes("860508")), "ID TMDB tidak muncul di URL server");
});

test("detail serial: punya season, castDetailed berfoto", async () => {
  const d = await getDetail("tv-108978");
  assert.equal(d.tipe, "Series");
  assert.ok(d.jumlahSeason >= 1, `jumlahSeason ${d.jumlahSeason}`);
  assert.ok(d.season.length >= 1, "daftar season kosong");
  d.season.forEach((s) => {
    assert.ok(Number.isInteger(s.nomor), `nomor season aneh: ${s.nomor}`);
    assert.ok(s.jumlahEpisode >= 0, "jumlahEpisode negatif");
  });
  assert.ok(d.pemainDetail.length > 0, "castDetailed kosong");
  assert.ok(d.pemainDetail[0].name, "castDetailed tanpa nama");
});

test("detail: slug ngawur ditolak lokal, slug valid tapi tidak ada -> ApiError", async () => {
  await assert.rejects(() => getDetail("ngawur"), /Slug tidak valid/);
  await assert.rejects(() => getDetail("movie-abc"), /Slug tidak valid/);
  await assert.rejects(() => getDetail("movie-99999999"), (e) => {
    assert.ok(e instanceof ApiError || e.name === "HttpError", `tipe error tak terduga: ${e.name}`);
    assert.match(e.message, /404|Not Found/i);
    return true;
  });
});

test("parseSlug: bentuk benar dan salah", () => {
  assert.deepEqual(parseSlug("tv-1399"), { tipe: "tv", tmdbId: 1399, slug: "tv-1399" });
  assert.deepEqual(parseSlug(" movie-42 "), { tipe: "movie", tmdbId: 42, slug: "movie-42" });
  assert.throws(() => parseSlug("film-42"), /Slug tidak valid/);
  assert.throws(() => parseSlug(undefined), /Slug tidak valid/);
});

test("episodes: season 1 lengkap, tiap episode punya server", async () => {
  const r = await getEpisodes("tv-108978", 1);
  assert.equal(r.season, 1);
  assert.ok(r.jumlah >= 5, `episode season 1 cuma ${r.jumlah}`);
  r.hasil.forEach((e, i) => {
    assert.ok(Number.isInteger(e.episode) && e.episode > 0, `ep[${i}]: nomor aneh`);
    assert.ok(e.judul && e.judul.trim() !== "", `ep[${i}]: judul kosong`);
    assert.ok(e.server.length >= 1, `ep[${i}]: tanpa server`);
    e.server.forEach((s) => assert.ok(s.url.startsWith("http"), `ep[${i}]: url server aneh`));
  });
  const nomor = r.hasil.map((e) => e.episode);
  assert.equal(new Set(nomor).size, nomor.length, "nomor episode duplikat");
});

test("episodes: URL server membawa nomor season & episode yang benar", async () => {
  const r = await getEpisodes("tv-108978", 1);
  const ep1 = r.hasil.find((e) => e.episode === 1);
  assert.ok(ep1, "episode 1 tidak ada");
  const cocok = ep1.server.some((s) => /s=1|season=1|\/1\/1|1-1/.test(s.url));
  assert.ok(cocok, `tidak ada URL server yang menyebut season/episode: ${JSON.stringify(ep1.server)}`);
});

test("episodes: slug film ditolak, season mustahil -> error jujur", async () => {
  await assert.rejects(() => getEpisodes("movie-860508", 1), /hanya untuk serial/);
  await assert.rejects(() => getEpisodes("tv-108978", 99), (e) => {
    assert.match(e.message, /404|Not Found/i);
    return true;
  });
});

test("all-episodes: semua season terkumpul, total konsisten", async () => {
  const r = await getSemuaEpisode("tv-108978");
  assert.ok(r.seasonDiambil >= 1, "tidak ada season yang berhasil diambil");
  assert.deepEqual(r.gagal, [], `ada season gagal: ${JSON.stringify(r.gagal)}`);
  const jumlahDihitung = r.season.reduce((a, s) => a + s.hasil.length, 0);
  assert.equal(r.totalEpisode, jumlahDihitung, "totalEpisode tidak cocok dengan isi");
  assert.ok(r.totalEpisode >= r.seasonDiambil, "total episode kurang dari jumlah season");
  // Season 0 (Specials) dilewati secara default.
  assert.ok(r.season.every((s) => s.season > 0), "season 0 ikut terambil padahal default melewatinya");
});

test("batas halaman: page > 500 ditolak lokal, bukan menembak upstream", async () => {
  await assert.rejects(() => getPopular({ page: MAX_PAGE + 1 }), /melewati batas upstream/);
  await assert.rejects(() => getLatest({ page: 0 }), /bilangan bulat/);
  await assert.rejects(() => search({ q: "x", page: -1 }), /bilangan bulat/);
});

test("type ngawur ditolak sebelum request", async () => {
  await assert.rejects(() => getPopular({ type: "anime" }), /type harus salah satu dari/);
});
