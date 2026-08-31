// Test live cosmicscans-scraper. Semua request nyata; validasi ISI, bukan cuma HTTP 200.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  latest, heroSlider, popularToday, latestProject, projectAll, allComics,
  filter, textMode, search, seriesDetail, related, chapter, chapterImages,
  settings, announcements, walk, buildUrl, stripHtml, imgSrc, nz, absUrl,
  seriesPath, chapterPath, HttpError, API_BASE,
} from "../src/index.js";

const SERIES = "lookism";
const CH_TERBARU = "lookism-chapter-622";
const CH_TENGAH = "lookism-chapter-300";
const CH_LAMA = "lookism-chapter-01";

const isUrl = (u) => typeof u === "string" && /^https:\/\//.test(u);

// --------------------------------------------------------------------------
// Util murni (tanpa jaringan)
// --------------------------------------------------------------------------

test("Util: buildUrl mengulang array sebagai param sama & buang null", () => {
  const u = buildUrl("/v1/manga/filter", {
    genres_slug: ["action", "comedy", ""],
    release_status: null,
    limit: 5,
  });
  assert.equal(u, `${API_BASE}/v1/manga/filter?genres_slug=action&genres_slug=comedy&limit=5`);
});

test("Util: stripHtml bersihkan tag + entitas, imgSrc ambil src", () => {
  assert.equal(stripHtml("<p>Halo &amp; <b>dunia</b></p>"), "Halo & dunia");
  assert.equal(stripHtml("   "), null);
  assert.equal(imgSrc("<img src='https://cdn.uqni.net/a/b.jpeg'>"), "https://cdn.uqni.net/a/b.jpeg");
  assert.equal(imgSrc("https://cdn.uqni.net/c.jpg"), "https://cdn.uqni.net/c.jpg");
  assert.equal(nz("  "), null);
  assert.equal(absUrl("/uploads/x.webp"), `${API_BASE}/uploads/x.webp`);
});

test("Util: pola URL situs publik sesuai yang diverifikasi live", () => {
  assert.equal(seriesPath("lookism"), "https://03.cosmicscans.to/series/lookism/");
  assert.equal(chapterPath("lookism-chapter-1"), "https://03.cosmicscans.to/chapter/lookism-chapter-1/");
});

// --------------------------------------------------------------------------
// Listing
// --------------------------------------------------------------------------

test("Latest: 5 item, field kartu terisi, ada cursor maju", async () => {
  const r = await latest({ limit: 5 });
  assert.equal(r.ok, true);
  assert.equal(r.count, 5);
  assert.equal(r.data.length, 5);
  assert.equal(r.pagination.has_next, true);
  assert.equal(r.pagination.has_prev, false);
  assert.ok(r.pagination.next_cursor, "next_cursor harus ada");
  for (const it of r.data) {
    assert.ok(it.title, "title kosong");
    assert.ok(it.slug, "slug kosong");
    assert.ok(isUrl(it.url), `url tidak valid: ${it.url}`);
    assert.ok(it.url.includes("/series/"), "url series harus pakai /series/");
    assert.ok(isUrl(it.cover), `cover tidak valid: ${it.cover}`);
    assert.ok(Array.isArray(it.latest_chapters));
    assert.ok(it.latest_chapters.length >= 1, "harus ada minimal 1 chapter terbaru");
    const c = it.latest_chapters[0];
    assert.ok(c.slug && c.chapter !== null, "chapter slug/nomor kosong");
    assert.ok(isUrl(c.url) && c.url.includes("/chapter/"), "url chapter salah pola");
    assert.match(c.time, /^\d{4}-\d{2}-\d{2}T/, `time bukan ISO: ${c.time}`);
  }
});

test("Latest: cursor maju tidak overlap, cursor mundur kembali ke halaman 1", async () => {
  const p1 = await latest({ limit: 5 });
  const s1 = p1.data.map((x) => x.slug);
  const p2 = await latest({ limit: 5, after: p1.pagination.next_cursor });
  const s2 = p2.data.map((x) => x.slug);
  assert.equal(p2.count, 5);
  assert.equal(s1.filter((s) => s2.includes(s)).length, 0, "halaman 1 & 2 tidak boleh overlap");
  assert.equal(p2.pagination.has_prev, true);
  const back = await latest({ limit: 5, before: p2.pagination.prev_cursor });
  assert.deepEqual(back.data.map((x) => x.slug), s1, "mundur harus kembali ke isi halaman 1");
});

test("Listing lain: hero/popular/projects/project-all/comics semua berisi", async () => {
  const [h, p, lp, pa, ac] = await Promise.all([
    heroSlider({ limit: 3 }),
    popularToday({ limit: 3 }),
    latestProject({ limit: 3 }),
    projectAll({ limit: 3 }),
    allComics({ limit: 3 }),
  ]);
  for (const [nama, r] of Object.entries({ hero: h, popular: p, projects: lp, projectAll: pa, comics: ac })) {
    assert.equal(r.ok, true, `${nama} tidak ok`);
    assert.equal(r.count, 3, `${nama} jumlah != 3`);
    for (const it of r.data) {
      assert.ok(it.title, `${nama}: title kosong`);
      assert.ok(it.slug, `${nama}: slug kosong`);
      assert.ok(isUrl(it.cover), `${nama}: cover invalid`);
    }
  }
  // projects & projectAll wajib menandai is_project
  assert.ok(lp.data.every((x) => x.is_project === true), "latestProject harus is_project=true");
});

test("Filter: tiap order_by mengubah hasil (bukan cuma diterima)", async () => {
  const [upd, pop, az] = await Promise.all([
    filter({ limit: 5, order: "update" }),
    filter({ limit: 5, order: "popular" }),
    filter({ limit: 5, order: "az" }),
  ]);
  assert.equal(upd.count, 5);
  const a = upd.data[0].slug, b = pop.data[0].slug, c = az.data[0].slug;
  assert.notEqual(a, b, "order=popular harus beda dari update");
  assert.notEqual(b, c, "order=az harus beda dari popular");
  // az benar-benar urut abjad
  const titles = az.data.map((x) => x.title.toLowerCase());
  assert.deepEqual(titles, [...titles].sort(), "order=az harus urut abjad");
});

test("Filter: status/type/genre/project benar-benar menyaring", async () => {
  const comp = await filter({ limit: 5, status: "Completed" });
  assert.ok(comp.count > 0, "filter Completed kosong");
  assert.ok(comp.data.every((x) => x.status === "Completed"), "ada item status != Completed");

  const mh = await filter({ limit: 5, type: "Manhwa" });
  assert.ok(mh.count > 0, "filter Manhwa kosong");

  const act = await filter({ limit: 5, genres: ["action"] });
  assert.ok(act.count > 0, "filter genre action kosong");
  assert.ok(
    act.data.every((x) => x.genres.map((g) => g.toLowerCase()).includes("action")),
    "ada item tanpa genre action",
  );

  const prj = await filter({ limit: 5, project: true });
  assert.ok(prj.count > 0, "filter project kosong");
  assert.ok(prj.data.every((x) => x.is_project === true), "ada item is_project=false");
});

test("TextMode: katalog penuh per abjad, ribuan judul, duplikat dilaporkan", async () => {
  const r = await textMode();
  assert.equal(r.ok, true);
  assert.ok(r.group_count >= 20, `kelompok abjad terlalu sedikit: ${r.group_count}`);
  assert.ok(r.total > 3000, `total judul terlalu sedikit: ${r.total}`);
  assert.equal(r.total, r.data.reduce((a, g) => a + g.count, 0), "total tidak sama dgn jumlah item");
  const semua = r.data.flatMap((g) => g.items);
  assert.equal(semua.length, r.total);

  // Situs memuat entri kembar (slug sama, judul beda tanda baca). Bukan bug
  // parser — yang penting jumlahnya dilaporkan konsisten dan tetap kecil.
  const slugs = new Set(semua.map((x) => x.slug));
  assert.equal(slugs.size, r.unique_total, "unique_total tidak sesuai slug unik nyata");
  assert.equal(r.total - r.unique_total, r.duplicate_slugs.length, "hitungan duplikat tidak konsisten");
  assert.ok(r.duplicate_slugs.length < r.total * 0.01, `duplikat tak wajar: ${r.duplicate_slugs.length}`);

  for (const it of semua.slice(0, 50)) {
    assert.ok(it.title && it.slug, "judul/slug kosong");
    assert.ok(it.url.includes("/series/"), "url salah pola");
  }
});

test("Search: relevan per token, batas 100, token ngawur balas 0", async () => {
  const r = await search("lookism");
  assert.equal(r.ok, true);
  assert.ok(r.count >= 1, "search lookism harus ada hasil");
  assert.ok(r.data.some((x) => x.slug === SERIES), "hasil harus memuat lookism");

  // Semua hasil harus benar-benar memuat kata kunci di judulnya.
  const nano = await search("nano");
  assert.ok(nano.count > 5, "search nano terlalu sedikit");
  assert.ok(
    nano.data.every((x) => x.title.toLowerCase().includes("nano")),
    "ada hasil yang judulnya tidak memuat kata kunci",
  );

  // Token tunggal yang tidak ada → benar-benar 0.
  const kosong = await search("zzzqqqxxx");
  assert.equal(kosong.count, 0, "token ngawur harus 0 hasil");
  assert.deepEqual(kosong.data, []);
  assert.equal(kosong.limit_capped, false);

  // Server memecah query per token (OR), jadi frasa ngawur berisi kata umum
  // TETAP dapat hasil. Ini perilaku server, didokumentasikan lewat flag.
  const frasa = await search("zzzqqqxxx-judul-tidak-ada-999");
  assert.ok(frasa.count > 0, "server mencocokkan per token, harus ada hasil");
  assert.equal(frasa.limit_capped, true, "hasil sebanyak ini harus ditandai tercapai batas");
  assert.equal(frasa.count, 100, "batas hasil search adalah 100");
});

// --------------------------------------------------------------------------
// Detail
// --------------------------------------------------------------------------

test("Series detail: metadata lengkap + 600+ chapter urut turun", async () => {
  const r = await seriesDetail(SERIES);
  const d = r.data;
  assert.equal(r.ok, true);
  assert.equal(d.title, "Lookism");
  assert.equal(d.slug, SERIES);
  assert.equal(d.status, "Ongoing");
  assert.ok(isUrl(d.cover), "cover invalid");
  assert.ok(d.synopsis && d.synopsis.length > 80, "sinopsis terlalu pendek");
  assert.ok(!/[<>]/.test(d.synopsis), "sinopsis masih mengandung tag HTML");
  assert.ok(Number.parseFloat(d.rating) > 0, `rating invalid: ${d.rating}`);
  assert.ok(d.views > 1000, `views invalid: ${d.views}`);
  assert.ok(d.genres.length >= 5, `genre terlalu sedikit: ${d.genres.length}`);
  assert.ok(d.genres.includes("Action"), "genre Action harus ada");
  assert.ok(d.chapter_count > 600, `chapter terlalu sedikit: ${d.chapter_count}`);
  assert.equal(d.chapter_count, d.chapters.length);

  // urutan: terbaru dulu
  const nums = d.chapters.map((c) => c.chapter_number).filter((n) => Number.isFinite(n));
  assert.ok(nums[0] > nums[nums.length - 1], "chapter harus urut terbaru → terlama");
  assert.equal(d.last_chapter.slug, d.chapters[0].slug);
  assert.equal(d.first_chapter.slug, d.chapters[d.chapters.length - 1].slug);

  // tiap chapter punya slug unik + url + waktu
  const slugs = new Set(d.chapters.map((c) => c.slug));
  assert.equal(slugs.size, d.chapters.length, "ada slug chapter duplikat");
  for (const c of d.chapters.slice(0, 30)) {
    assert.ok(c.slug, "slug chapter kosong");
    assert.ok(isUrl(c.url) && c.url.includes("/chapter/"), "url chapter salah");
    assert.match(c.time, /^\d{4}-\d{2}-\d{2}T/, `time invalid: ${c.time}`);
    assert.ok(Number.isFinite(c.chapter_number), `nomor chapter invalid: ${c.chapter}`);
  }
});

test("Series detail: slug ngawur → HttpError 404 dengan pesan server", async () => {
  await assert.rejects(
    () => seriesDetail("slug-ngawur-tidak-ada-999"),
    (err) => {
      assert.ok(err instanceof HttpError, "harus HttpError");
      assert.equal(err.status, 404);
      assert.match(err.message, /tidak ditemukan/i);
      return true;
    },
  );
  await assert.rejects(() => seriesDetail(""), TypeError);
});

test("Related: 3 rekomendasi valid, bukan diri sendiri", async () => {
  const r = await related(SERIES, { limit: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.count, 3);
  for (const it of r.data) {
    assert.ok(it.title && it.slug, "field kosong");
    assert.ok(isUrl(it.cover), "cover invalid");
    assert.notEqual(it.slug, SERIES, "related tidak boleh diri sendiri");
  }
});

// --------------------------------------------------------------------------
// Chapter / gambar
// --------------------------------------------------------------------------

test("Chapter: gambar terbaca dari string <img>, host CDN, navigasi benar", async () => {
  const r = await chapter(CH_TERBARU);
  const d = r.data;
  assert.equal(r.ok, true);
  assert.equal(d.chapter, "622");
  assert.equal(d.series_slug, SERIES);
  assert.ok(d.series_url.includes("/series/lookism/"));
  assert.match(d.time, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(d.image_count >= 10, `gambar terlalu sedikit: ${d.image_count}`);
  assert.equal(d.image_count, d.images.length);
  for (const u of d.images) {
    assert.ok(isUrl(u), `URL gambar invalid: ${u}`);
    assert.ok(!u.includes("<"), "URL masih mengandung markup");
    assert.match(u, /\.(jpe?g|png|webp|gif)(\?|$)/i, `ekstensi gambar tak dikenal: ${u}`);
  }
  // chapter terbaru: tidak ada yang lebih baru
  assert.equal(d.nav.index, 0, "chapter terbaru harus index 0");
  assert.equal(d.nav.next, null, "chapter terbaru tidak punya next");
  assert.equal(d.nav.prev.slug, "lookism-chapter-621");
  assert.ok(d.chapter_list_count > 600, "daftar chapter kurang");
});

test("Chapter: navigasi dua arah di tengah & batas paling lama", async () => {
  const mid = await chapter(CH_TENGAH);
  assert.equal(mid.data.chapter, "300");
  assert.equal(mid.data.nav.prev.slug, "lookism-chapter-299");
  assert.equal(mid.data.nav.next.slug, "lookism-chapter-301");
  assert.ok(mid.data.image_count > 0);

  const first = await chapter(CH_LAMA);
  assert.equal(first.data.nav.prev, null, "chapter paling lama tidak punya prev");
  assert.ok(first.data.nav.next, "chapter paling lama harus punya next");
  assert.equal(first.data.nav.index, first.data.chapter_list_count - 1);
});

test("Chapter: byte gambar asli terunduh (magic number JPEG/PNG/WEBP)", async () => {
  const im = await chapterImages(CH_TERBARU);
  assert.ok(im.count >= 10);
  const sampel = [im.data[0], im.data[Math.floor(im.count / 2)]];
  for (const u of sampel) {
    const res = await fetch(u, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Referer: "https://03.cosmicscans.to/",
      },
      signal: AbortSignal.timeout(45000),
    });
    assert.equal(res.status, 200, `gambar tidak bisa diunduh: ${u}`);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 5000, `berkas gambar terlalu kecil: ${buf.length} byte`);
    const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const webp = buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP";
    assert.ok(jpeg || png || webp, `bukan gambar valid: ${buf.subarray(0, 8).toString("hex")}`);
  }
});

test("Chapter: slug ngawur → HttpError 404", async () => {
  await assert.rejects(
    () => chapter("chapter-ngawur-tidak-ada-999"),
    (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 404);
      assert.match(err.message, /tidak ditemukan/i);
      return true;
    },
  );
});

// --------------------------------------------------------------------------
// Ekstra & audit
// --------------------------------------------------------------------------

test("Settings & announcements: endpoint tambahan bekerja", async () => {
  const menu = await settings("menu");
  assert.equal(menu.ok, true);
  assert.ok(Array.isArray(menu.data.items) && menu.data.items.length >= 3, "menu kosong");
  assert.ok(menu.data.items.some((m) => m.href === "/comics"), "menu /comics tidak ada");

  const hp = await settings("homepage");
  assert.ok(hp.data.totalLatestUpdate > 0, "totalLatestUpdate invalid");

  await assert.rejects(() => settings("ngawur"), TypeError);

  const an = await announcements({ limit: 5 });
  assert.equal(an.ok, true);
  assert.ok(Array.isArray(an.data));
  assert.ok(an.pagination && typeof an.pagination.total === "number", "pagination announcement hilang");
});

test("Walk: 2 halaman cursor tergabung tanpa duplikat", async () => {
  const w = await walk({ pages: 2, limit: 5, kind: "filter", order: "az" });
  assert.equal(w.ok, true);
  assert.equal(w.pages_visited, 2);
  assert.equal(w.count, 10, `harus 10 item unik, dapat ${w.count}`);
  const slugs = new Set(w.data.map((x) => x.slug));
  assert.equal(slugs.size, 10, "ada duplikat setelah walk");
  await assert.rejects(() => walk({ kind: "ngawur" }), TypeError);
});

test("Validasi server: limit=0 ditolak 400 dengan pesan jelas", async () => {
  await assert.rejects(
    () => latest({ limit: 0 }),
    (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 400);
      assert.match(err.message, /limit/i);
      return true;
    },
  );
});

test("AUDIT ANTI-NULL: field wajib terisi di listing, detail, dan chapter", async () => {
  const l = await latest({ limit: 3 });
  const d = (await seriesDetail(SERIES)).data;
  const c = (await chapter(CH_TENGAH)).data;

  const wajib = {
    "latest.title": l.data[0].title,
    "latest.slug": l.data[0].slug,
    "latest.url": l.data[0].url,
    "latest.cover": l.data[0].cover,
    "latest.latest_chapter": l.data[0].latest_chapter,
    "latest.next_cursor": l.pagination.next_cursor,
    "series.title": d.title,
    "series.slug": d.slug,
    "series.cover": d.cover,
    "series.synopsis": d.synopsis,
    "series.status": d.status,
    "series.rating": d.rating,
    "series.views": d.views,
    "series.genres": d.genres.length,
    "series.chapter_count": d.chapter_count,
    "series.first_chapter": d.first_chapter?.slug,
    "series.last_chapter": d.last_chapter?.slug,
    "chapter.title": c.title,
    "chapter.chapter_title": c.chapter_title,
    "chapter.chapter": c.chapter,
    "chapter.series_slug": c.series_slug,
    "chapter.series_url": c.series_url,
    "chapter.time": c.time,
    "chapter.image_count": c.image_count,
    "chapter.images[0]": c.images[0],
    "chapter.nav.prev": c.nav.prev?.slug,
    "chapter.nav.next": c.nav.next?.slug,
    "chapter.list_count": c.chapter_list_count,
  };

  const kosong = Object.entries(wajib).filter(
    ([, v]) => v === null || v === undefined || v === "" || v === 0,
  );
  assert.deepEqual(kosong.map(([k]) => k), [], `field kosong: ${kosong.map(([k]) => k).join(", ")}`);
});
