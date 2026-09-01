// Test live okyykomik-scraper. Semua request nyata; validasi ISI, bukan cuma HTTP 200.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  latest, latestChapters, seriesList, seriesDetail, chapter, chapterImages,
  search, labels, byLabel, stats, sitemap, walkSeries, HttpError,
} from "../src/index.js";

const SERIES = "Villain Classroom";       // 27 chapter, metadata lengkap
const TOTAL_SERIES = 41;

/** Field kartu yang wajib ada bentuknya. */
function cekKartu(c, konteks) {
  assert.ok(c.title && typeof c.title === "string", `${konteks}: title kosong`);
  assert.ok(c.slug && /^[a-z0-9-]/i.test(c.slug), `${konteks}: slug aneh (${c.slug})`);
  assert.ok(c.url?.startsWith("https://www.okyykomik.my.id/"), `${konteks}: url salah (${c.url})`);
  assert.ok(c.url.endsWith(".html"), `${konteks}: url bukan post .html`);
  assert.ok(/^\d+$/.test(c.id || ""), `${konteks}: id post bukan angka (${c.id})`);
  assert.ok(["series", "chapter", "other"].includes(c.kind), `${konteks}: kind aneh`);
  assert.ok(c.published && !Number.isNaN(Date.parse(c.published)), `${konteks}: published invalid`);
  assert.ok(c.updated && !Number.isNaN(Date.parse(c.updated)), `${konteks}: updated invalid`);
  assert.ok(Array.isArray(c.genres), `${konteks}: genres bukan array`);
  assert.equal(typeof c.comments, "number", `${konteks}: comments bukan angka`);
}

test("Latest: post terbaru, total 538, kartu terisi", async () => {
  const r = await latest({ limit: 12 });
  assert.equal(r.ok, true);
  assert.equal(r.source, "okyykomik.my.id");
  assert.equal(r.count, 12);
  assert.ok(r.total_posts > 500, `total_posts terlalu kecil: ${r.total_posts}`);
  for (const c of r.data) cekKartu(c, "latest");

  // Urut terbaru dulu.
  const t = r.data.map((c) => Date.parse(c.published));
  assert.ok(t.every((x, i) => i === 0 || t[i - 1] >= x), "latest tidak urut terbaru→lama");

  // Campuran series & chapter memang wajar; minimal ada chapter.
  assert.ok(r.data.some((c) => c.kind === "chapter"), "tidak ada post chapter di latest");
});

test("LatestChapters: hanya chapter, semua terpasang ke series induk", async () => {
  const r = await latestChapters({ limit: 15 });
  assert.equal(r.ok, true);
  assert.equal(r.count, 15);
  assert.ok(r.total_chapters > 400, `total_chapters kecil: ${r.total_chapters}`);
  for (const c of r.data) {
    cekKartu(c, "chapters");
    assert.equal(c.kind, "chapter", `bukan chapter: ${c.title}`);
    assert.ok(c.chapter, `nomor chapter kosong: ${c.title}`);
    // Inti jebakan #2: label seri di post chapter sering versi PENDEK dari judul
    // series, jadi pemasangan harus lewat label unik — bukan judul.
    assert.ok(c.series_title, `series_title tidak terpasang: ${c.title}`);
  }
});

test("SeriesList: 41 series, urut abjad, semua kind=series", async () => {
  const r = await seriesList({});
  assert.equal(r.ok, true);
  assert.equal(r.total_series, TOTAL_SERIES);
  assert.equal(r.count, TOTAL_SERIES);
  for (const c of r.data) {
    cekKartu(c, "seriesList");
    assert.equal(c.kind, "series", `bukan series: ${c.title}`);
    assert.equal(c.chapter, null, `series kok punya nomor chapter: ${c.title}`);
  }
  const judul = r.data.map((c) => c.title);
  assert.deepEqual(judul, [...judul].sort((a, b) => a.localeCompare(b)), "tidak urut abjad");
  assert.equal(new Set(r.data.map((c) => c.id)).size, TOTAL_SERIES, "ada id duplikat");
});

test("SeriesList: filter status/type/country/genre benar-benar menyaring", async () => {
  const semua = await seriesList({});

  const ong = await seriesList({ status: "Ongoing" });
  assert.ok(ong.count >= 35, `Ongoing terlalu sedikit: ${ong.count}`);
  assert.ok(ong.data.every((c) => c.status === "Ongoing"), "ada non-Ongoing lolos filter");

  const mhw = await seriesList({ type: "Manhwa" });
  assert.ok(mhw.count >= 3, `Manhwa terlalu sedikit: ${mhw.count}`);
  assert.ok(mhw.data.every((c) => c.type === "Manhwa"), "ada non-Manhwa lolos filter");
  assert.ok(mhw.count < semua.count, "filter type tidak mengurangi hasil");

  const jp = await seriesList({ country: "JP" });
  assert.ok(jp.data.every((c) => c.country === "JP"), "ada non-JP lolos filter");

  const rom = await seriesList({ genre: "Romance" });
  assert.ok(rom.count >= 5, `genre Romance terlalu sedikit: ${rom.count}`);
  assert.ok(
    rom.data.every((c) => c.genres.some((g) => g.toLowerCase() === "romance")),
    "ada series tanpa genre Romance lolos filter",
  );

  const gabung = await seriesList({ status: "Ongoing", type: "Manga" });
  assert.ok(gabung.data.every((c) => c.status === "Ongoing" && c.type === "Manga"),
    "filter gabungan tidak konsisten");
});

test("SeriesDetail: metadata lengkap + seluruh chapter urut & unik", async () => {
  const r = await seriesDetail(SERIES);
  assert.equal(r.ok, true);
  const s = r.data;

  assert.equal(s.title, SERIES);
  assert.equal(s.kind, "series");
  assert.equal(typeof s.rating, "number");
  assert.ok(s.rating > 0 && s.rating <= 10, `rating di luar rentang: ${s.rating}`);
  assert.equal(s.status, "Ongoing");
  assert.equal(s.type, "Manhwa");
  assert.equal(s.country, "KR");
  assert.equal(s.country_full, "Korea");
  assert.ok(s.author, "author kosong");
  assert.ok(s.artist, "artist kosong");
  assert.match(s.year_published, /^\d{4}$/);
  assert.ok(s.synopsis.length > 100, `sinopsis terlalu pendek: ${s.synopsis.length}`);
  assert.ok(!s.synopsis.includes("<"), "sinopsis masih mengandung tag HTML");
  assert.ok(!s.synopsis.includes("&#"), "sinopsis masih mengandung entitas HTML");
  assert.ok(s.genres.length >= 3, `genre terlalu sedikit: ${s.genres.length}`);
  assert.ok(s.tags.length >= 3, `tags terlalu sedikit: ${s.tags.length}`);
  assert.ok(s.cover?.startsWith("https://"), "cover kosong");
  assert.ok(!/\/s\d{1,3}(-c)?\//.test(s.cover), `cover masih ukuran thumbnail: ${s.cover}`);

  assert.equal(s.chapter_total, s.chapters.length);
  assert.ok(s.chapter_total >= 27, `chapter terlalu sedikit: ${s.chapter_total}`);

  const nomor = s.chapters.map((c) => parseFloat(c.chapter));
  assert.ok(nomor.every((n) => Number.isFinite(n)), "ada chapter tanpa nomor");
  assert.ok(nomor.every((n, i) => i === 0 || nomor[i - 1] > n), "chapter tidak urut DESC / ada duplikat");
  assert.equal(new Set(s.chapters.map((c) => c.url)).size, s.chapters.length, "ada URL chapter duplikat");
  for (const c of s.chapters.slice(0, 5)) {
    assert.ok(c.slug && c.url.endsWith(".html"), "chapter url/slug invalid");
    assert.ok(/^\d+$/.test(c.id), "chapter id bukan angka");
    assert.ok(!Number.isNaN(Date.parse(c.published)), "chapter published invalid");
  }
});

test("SeriesDetail: judul ber-apostrof & label versi pendek tetap ketemu", async () => {
  // Judul di feed masih ber-entitas ("Shouldn&#39;t"); pencocokan harus decoded.
  const a = await seriesDetail("Why You Shouldn't Enter a Haunted House");
  assert.equal(a.ok, true);
  assert.ok(a.data.title.includes("Haunted House"));
  assert.ok(!a.data.title.includes("&#"), "judul masih ber-entitas HTML");

  // Judul series panjang, tapi label chapter-nya versi pendek.
  const b = await seriesDetail("Shinmai Necromancer, Maou wo Sosei suru");
  assert.equal(b.ok, true);
  assert.ok(b.data.chapter_total > 0, "chapter tidak ketemu lewat label pendek");
  assert.ok(b.data.series_labels.includes("Shinmai Necromancer"),
    `label pendek tidak terdeteksi: ${JSON.stringify(b.data.series_labels)}`);

  // Dicari lewat label pendek saja juga harus dapat series yang sama.
  const c = await seriesDetail("Shinmai Necromancer");
  assert.equal(c.data.id, b.data.id, "pencarian lewat label pendek dapat series berbeda");
});

test("Chapter: gambar, nav dua arah, dan info series induk", async () => {
  const det = await seriesDetail(SERIES);
  const tengah = det.data.chapters[Math.floor(det.data.chapters.length / 2)];

  const r = await chapter(tengah.slug);
  assert.equal(r.ok, true);
  const c = r.data;
  assert.equal(c.chapter, tengah.chapter);
  assert.equal(c.series_title, SERIES);
  assert.ok(c.series_url?.endsWith(".html"), "series_url kosong");
  assert.equal(c.series_chapter_total, det.data.chapter_total);
  assert.ok(c.image_count > 5, `gambar terlalu sedikit: ${c.image_count}`);
  assert.equal(c.images.length, c.image_count);
  assert.equal(new Set(c.images).size, c.images.length, "ada URL gambar duplikat");
  for (const u of c.images) {
    assert.ok(u.startsWith("https://blogger.googleusercontent.com/"), `host gambar aneh: ${u}`);
    assert.ok(!/\/s\d{1,3}(-c)?\//.test(u), `gambar masih ukuran thumbnail: ${u}`);
  }

  // Chapter tengah: prev DAN next dua-duanya harus ada.
  assert.ok(c.nav.prev, "nav.prev kosong di chapter tengah");
  assert.ok(c.nav.next, "nav.next kosong di chapter tengah");
  assert.ok(parseFloat(c.nav.next.chapter) > parseFloat(c.chapter), "next tidak lebih baru");
  assert.ok(parseFloat(c.nav.prev.chapter) < parseFloat(c.chapter), "prev tidak lebih lama");
});

test("Chapter: ujung daftar — terbaru tanpa next, terlama tanpa prev", async () => {
  const det = await seriesDetail(SERIES);

  const baru = await chapter(det.data.chapters[0].slug);
  assert.equal(baru.data.nav.next, null, "chapter terbaru seharusnya tidak punya next");
  assert.ok(baru.data.nav.prev, "chapter terbaru harus punya prev");

  const lama = await chapter(det.data.chapters.at(-1).slug);
  assert.equal(lama.data.nav.prev, null, "chapter terlama seharusnya tidak punya prev");
  assert.ok(lama.data.nav.next, "chapter terlama harus punya next");
  assert.equal(lama.data.chapter, "1", "chapter terlama bukan nomor 1");
});

test("Chapter: bisa diakses lewat post id numerik", async () => {
  const det = await seriesDetail(SERIES);
  const target = det.data.chapters[0];
  const r = await chapter(target.id);
  assert.equal(r.ok, true);
  assert.equal(r.data.id, target.id);
  assert.equal(r.data.chapter, target.chapter);
  assert.ok(r.data.image_count > 0, "gambar kosong saat akses lewat id");
});

test("Gambar chapter BENAR-BENAR terunduh & formatnya gambar", async () => {
  const det = await seriesDetail(SERIES);
  const r = await chapter(det.data.chapters[0].slug);
  const sampel = [r.data.images[0], r.data.images[Math.floor(r.data.image_count / 2)]];

  for (const u of sampel) {
    const res = await fetch(u, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          + "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        referer: "https://www.okyykomik.my.id/",
      },
    });
    assert.equal(res.status, 200, `gambar tidak bisa diunduh: ${u}`);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 5000, `gambar terlalu kecil (${buf.length} byte): ${u}`);

    const jpeg = buf.subarray(0, 3).toString("hex") === "ffd8ff";
    const png = buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    const webp = buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP";
    assert.ok(jpeg || png || webp, `bukan JPEG/PNG/WEBP: ${buf.subarray(0, 8).toString("hex")}`);
  }
});

test("ChapterImages: hanya array URL, jumlah cocok dengan chapter()", async () => {
  const det = await seriesDetail(SERIES);
  const slug = det.data.chapters[0].slug;
  const full = await chapter(slug);
  const img = await chapterImages(slug);
  assert.equal(img.ok, true);
  assert.equal(img.count, full.data.image_count);
  assert.deepEqual(img.data, full.data.images);
  assert.ok(img.data.every((u) => typeof u === "string" && u.startsWith("https://")));
});

test("Search: relevan, kata ngawur balas 0", async () => {
  const r = await search("villain", { limit: 10 });
  assert.equal(r.ok, true);
  assert.ok(r.count > 0, "search villain kosong");
  assert.ok(
    r.data.some((c) => c.title.toLowerCase().includes("villain")),
    "hasil search tidak memuat kata kunci",
  );
  for (const c of r.data) cekKartu(c, "search");

  const kosong = await search("zzzqqqxxxtidakada", { limit: 5 });
  assert.equal(kosong.ok, true);
  assert.equal(kosong.count, 0, "kata ngawur harus 0 hasil");
  assert.equal(kosong.total_match, 0);
  assert.deepEqual(kosong.data, []);
});

test("Search: hasil chapter ikut membawa series_title", async () => {
  const r = await search("regressor", { limit: 8 });
  const chs = r.data.filter((c) => c.kind === "chapter");
  assert.ok(chs.length > 0, "tidak ada chapter di hasil search");
  for (const c of chs) {
    assert.ok(c.series_title, `chapter tanpa series_title: ${c.title}`);
  }
});

test("Labels: genre bersih dari label sistem, rating, dan nama seri", async () => {
  const r = await labels();
  assert.equal(r.ok, true);
  assert.ok(r.genre_count >= 20, `genre terlalu sedikit: ${r.genre_count}`);

  const genre = r.data.genre.map((x) => x.label);
  for (const bukan of ["Series", "Chapter", "Project", "ProjectOkyy", "Ongoing",
    "Completed", "Manga", "Manhwa", "Manhua", "Novel", "JP", "CN", "KR", "ID"]) {
    assert.ok(!genre.includes(bukan), `label sistem "${bukan}" bocor ke genre`);
  }
  assert.ok(!genre.some((g) => /^\d+(\.\d+)?$/.test(g)), "label rating bocor ke genre");
  assert.ok(!genre.some((g) => g.length <= 2), "label indeks abjad bocor ke genre");
  assert.ok(r.data.genre.every((x) => x.count >= 2), "genre seharusnya dipakai >1 series");

  assert.ok(r.data.system.some((x) => x.label === "Series" && x.count === TOTAL_SERIES),
    "label Series tidak berjumlah 41");
  assert.equal(r.data.series_labels.length >= TOTAL_SERIES, true,
    `label seri unik kurang dari jumlah series: ${r.data.series_labels.length}`);
});

test("ByLabel: hasil benar-benar ber-label itu", async () => {
  const r = await byLabel("Romance", { limit: 12 });
  assert.equal(r.ok, true);
  assert.equal(r.label, "Romance");
  assert.ok(r.total_match >= 5, `Romance terlalu sedikit: ${r.total_match}`);
  assert.ok(r.count > 0);
  for (const c of r.data) {
    cekKartu(c, "byLabel");
    assert.ok(c.genres.some((g) => g === "Romance"), `${c.title} tidak ber-genre Romance`);
  }

  const kosong = await byLabel("LabelTidakAda12345", { limit: 5 });
  assert.equal(kosong.total_match, 0);
  assert.deepEqual(kosong.data, []);
});

test("Stats: angka konsisten dengan feed", async () => {
  const r = await stats();
  assert.equal(r.ok, true);
  const s = r.data;
  assert.ok(s.total_posts > 500, `total_posts kecil: ${s.total_posts}`);
  assert.ok(s.total_chapters > 400, `total_chapters kecil: ${s.total_chapters}`);
  assert.equal(s.total_series, TOTAL_SERIES);
  assert.ok(s.total_chapters < s.total_posts, "chapter tidak boleh > total post");

  const jumStatus = Object.values(s.by_status).reduce((a, b) => a + b, 0);
  assert.equal(jumStatus, TOTAL_SERIES, `by_status tidak menjumlah 41: ${jumStatus}`);
  const jumTipe = Object.values(s.by_type).reduce((a, b) => a + b, 0);
  assert.equal(jumTipe, TOTAL_SERIES, `by_type tidak menjumlah 41: ${jumTipe}`);
});

test("Sitemap: 538 URL post, semua absolut & .html", async () => {
  const r = await sitemap();
  assert.equal(r.ok, true);
  assert.ok(r.count > 500, `sitemap terlalu sedikit: ${r.count}`);
  assert.equal(new Set(r.data).size, r.count, "ada URL duplikat di sitemap");
  for (const u of r.data.slice(0, 30)) {
    assert.ok(u.startsWith("https://www.okyykomik.my.id/"), `URL sitemap aneh: ${u}`);
    assert.ok(u.endsWith(".html"), `URL sitemap bukan post: ${u}`);
  }

  // Jumlah sitemap harus setara total post di feed.
  const st = await stats();
  assert.equal(r.count, st.data.total_posts, "sitemap tidak sama dengan total post feed");
});

test("Pagination: semua 538 post terkumpul, tidak ada yang terlewat", async () => {
  // Blogger membatasi respons per ukuran, bukan hanya max-results: sebuah halaman
  // bisa balas 72 entri padahal diminta 100. Kalau start-index dimajukan fixed
  // +100, 28 post hilang. collect() memajukan sebanyak entri yang diterima.
  const r = await latest({ limit: Infinity });
  assert.equal(r.ok, true);
  assert.equal(r.count, r.total_posts,
    `post terkumpul (${r.count}) != total feed (${r.total_posts}) — pagination bocor`);

  const id = r.data.map((c) => c.id);
  assert.equal(new Set(id).size, id.length, "ada post duplikat dari pagination");

  const ch = r.data.filter((c) => c.kind === "chapter").length;
  const sr = r.data.filter((c) => c.kind === "series").length;
  assert.equal(sr, TOTAL_SERIES, `post series terkumpul ${sr}, harusnya ${TOTAL_SERIES}`);
  assert.ok(ch >= 490, `post chapter terkumpul terlalu sedikit: ${ch}`);
  assert.equal(ch + sr, r.count, "ada post yang tidak terklasifikasi series/chapter");
});

test("WalkSeries: rangkuman per series konsisten", async () => {
  const r = await walkSeries({ limit: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.count, 3);
  for (const s of r.data) {
    assert.ok(s.title && s.url.endsWith(".html"));
    assert.ok(s.chapter_total > 0, `${s.title}: chapter_total 0`);
    assert.ok(s.first_chapter && s.last_chapter, `${s.title}: nomor chapter ujung kosong`);
    assert.ok(parseFloat(s.last_chapter) >= parseFloat(s.first_chapter),
      `${s.title}: last < first`);
  }
});

test("Error: series & chapter tidak ada → HttpError 404", async () => {
  await assert.rejects(
    () => seriesDetail("series-ngawur-tidak-ada-999"),
    (e) => e instanceof HttpError && e.status === 404 && /tidak ditemukan/i.test(e.message),
  );
  await assert.rejects(
    () => chapter("chapter-ngawur-tidak-ada-999"),
    (e) => e instanceof HttpError && e.status === 404,
  );
  await assert.rejects(() => seriesDetail(""), (e) => e instanceof TypeError);
  await assert.rejects(() => chapter(""), (e) => e instanceof TypeError);
  await assert.rejects(() => search(""), (e) => e instanceof TypeError);
  await assert.rejects(() => byLabel(""), (e) => e instanceof TypeError);
});

test("AUDIT ANTI-NULL: field inti terisi di 41 series", async () => {
  const list = await seriesList({});
  assert.equal(list.count, TOTAL_SERIES);

  // Field inti wajib terisi untuk SEMUA series.
  for (const c of list.data) {
    for (const k of ["id", "title", "slug", "url", "cover", "status", "type",
      "country", "published", "updated"]) {
      assert.ok(c[k] !== null && c[k] !== undefined && c[k] !== "",
        `${c.title}: field inti "${k}" kosong`);
    }
    assert.ok(c.genres.length > 0, `${c.title}: genres kosong`);
  }

  // Rating: label numerik. Diverifikasi live: 4 dari 41 series belum diberi rating
  // oleh pemilik blog, jadi null di situ adalah batasan sumber — bukan parser gagal.
  const tanpaRating = list.data.filter((c) => c.rating === null);
  assert.ok(tanpaRating.length <= 5,
    `series tanpa rating terlalu banyak (${tanpaRating.length}) — parser rating kemungkinan rusak`);
  assert.ok(list.data.filter((c) => typeof c.rating === "number").length >= 36,
    "series ber-rating terlalu sedikit");

  // Detail: sinopsis wajib ada untuk SEMUA series (41/41 punya div#synopsis).
  const sampel = [list.data[0], list.data[10], list.data[25], list.data[40]];
  for (const c of sampel) {
    const d = await seriesDetail(c.title);
    assert.ok(d.data.synopsis.length > 30, `${c.title}: sinopsis kosong/terlalu pendek`);
    assert.ok(d.data.chapter_total > 0, `${c.title}: chapter_total 0`);
    assert.ok(d.data.series_labels.length > 0, `${c.title}: series_labels kosong`);
    assert.ok(Array.isArray(d.data.labels) && d.data.labels.length > 3,
      `${c.title}: labels kosong`);
  }
});
