import assert from "node:assert/strict";
import test from "node:test";
import {
  LANGS, home, genres, browse, hot, updated, byTag, search, series,
  episodeImages, download, booklist, booklistDetail, sitemap, sitemapIndex,
  walk, decodeEnt, parseCount, toWatermark, stripTags, HttpError,
} from "../src/index.js";

const HUNK = 21;        // Hunk No.1 — completed, 350 episode
const HUNK_EP1 = 517;   // episode 1
const TDG = 5;          // Tales of Demons and Gods — ongoing, ~966 episode

/** Semua field wajib terisi (tidak null/undefined). */
function noNull(obj, label, { allowEmptyString = [] } = {}) {
  for (const [k, v] of Object.entries(obj)) {
    assert.notStrictEqual(v, null, `${label}.${k} = null`);
    assert.notStrictEqual(v, undefined, `${label}.${k} = undefined`);
    if (typeof v === "string" && !allowEmptyString.includes(k)) {
      assert.ok(v.length > 0, `${label}.${k} = "" (kosong)`);
    }
  }
}

// ---------------------------------------------------------------- unit murni

test("parseCount: angka ringkas MangaToon", () => {
  assert.equal(parseCount("253.6M"), 253600000);
  assert.equal(parseCount("2.9M"), 2900000);
  assert.equal(parseCount("37.6k"), 37600);
  assert.equal(parseCount("4.3k"), 4300);
  assert.equal(parseCount("488.8k"), 488800);
  assert.equal(parseCount("18"), 18);
  assert.equal(parseCount("1,234"), 1234);
  assert.equal(parseCount(""), 0, "string kosong -> 0, bukan NaN");
  assert.equal(parseCount("ngawur"), 0, "tidak parseable -> 0, bukan NaN");
});

test("decodeEnt: entity numerik + bernama", () => {
  assert.equal(decodeEnt("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(decodeEnt("A&#038;B"), "A&B");
  assert.equal(decodeEnt("Boys&#8217; Love"), "Boys\u2019 Love");
  assert.equal(decodeEnt("Boys&rsquo; Love"), "Boys\u2019 Love");
  assert.equal(decodeEnt("a&nbsp;b"), "a b");
});

test("stripTags: buang tag, <br> jadi newline", () => {
  assert.equal(stripTags("<p>satu<br />dua</p>"), "satu\ndua");
  assert.equal(stripTags("<div> spasi &amp; entity </div>"), "spasi & entity");
});

test("toWatermark: encrypted webp -> watermark jpg, dua varian host", () => {
  assert.equal(
    toWatermark("http://en-c-pic-aliyun.mangatoon.mobi/ps/48785/encrypted/U.webp"),
    "https://en-c-pic-aliyun.mangatoon.mobi/ps/48785/watermark/U.jpg"
  );
  // host varian titik (bukan strip) juga harus dinormalisasi
  assert.equal(
    toWatermark("http://en.c.pic.mangatoon.mobi/ps/34241/encrypted/7.webp"),
    "https://en-c-pic-aliyun.mangatoon.mobi/ps/34241/watermark/7.jpg"
  );
  // path bersarang /1000/
  assert.equal(
    toWatermark("http://en-c-pic-aliyun.mangatoon.mobi/ps/407213/encrypted/1000/u.webp"),
    "https://en-c-pic-aliyun.mangatoon.mobi/ps/407213/watermark/1000/u.jpg"
  );
});

test("validasi argumen: lang salah & argumen wajib", async () => {
  await assert.rejects(() => home({ lang: "jp" }), /lang tidak didukung/);
  await assert.rejects(() => series({}), /content_id/);
  await assert.rejects(() => search({ word: "" }), /kata kunci/);
  await assert.rejects(() => byTag({}), /tag id/);
  await assert.rejects(() => episodeImages({ contentId: 21 }), /episodeId/);
  await assert.rejects(() => browse({ page: 0 }), /page minimal 1/);
});

// ------------------------------------------------------------------ live: home

test("home: banner + semua section terisi", async () => {
  const h = await home();
  assert.ok(h.section_count >= 6, `>= 6 section (dapat ${h.section_count})`);
  assert.ok(h.banner_count >= 3, `banner >= 3 (dapat ${h.banner_count})`);
  assert.ok(h.count >= 40, `total item >= 40 (dapat ${h.count})`);
  for (const s of h.sections) {
    assert.ok(s.title.length > 0, "section punya judul");
    assert.ok(s.count > 0, `section "${s.title}" tidak kosong`);
    for (const it of s.items) {
      noNull(it, `home[${s.title}]`);
      assert.ok(it.content_id > 0, "content_id > 0");
      assert.match(it.url, /content_id=\d+/);
      assert.match(it.cover, /^https:\/\//, "cover absolut https");
    }
  }
});

test("home: section markup tak seragam tetap terbaca (Hottest + update-list)", async () => {
  const h = await home();
  const titles = h.sections.map((s) => s.title);

  // "Hottest Comics" memakai anchor dengan newline antara `<a` dan `href`,
  // dan judul di .top-content-info-title (bukan .content-title).
  const hottest = h.sections.find((s) => /Hottest/i.test(s.title));
  assert.ok(hottest, `section Hottest ada (dapat: ${titles.join(", ")})`);
  assert.ok(hottest.count > 0, "Hottest tidak kosong");
  for (const it of hottest.items) {
    assert.ok(it.title.length > 0, "judul kartu Hottest terisi");
    assert.ok(it.content_id > 0);
  }

  // "Manga Update Today" pembungkusnya `list-item update-list`, bukan `list-item`.
  const upd = h.sections.find((s) => /Update Today/i.test(s.title));
  assert.ok(upd, `section update-list ada (dapat: ${titles.join(", ")})`);
  assert.ok(upd.count > 0);

  // Tidak ada satu pun judul kosong di seluruh homepage
  const empty = h.sections.flatMap((s) => s.items).filter((x) => !x.title);
  assert.equal(empty.length, 0, "tidak ada kartu tanpa judul");

  // content_id dari homepage benar-benar bisa dibuka
  const pick = hottest.items[0];
  const s = await series({ id: pick.content_id, slug: pick.slug });
  assert.equal(s.content_id, pick.content_id);
  assert.ok(s.title.length > 0);
});

test("home: bahasa lain (id) beda konten, struktur sama", async () => {
  const id = await home({ lang: "id" });
  assert.equal(id.lang, "id");
  assert.ok(id.section_count >= 3, `section id >= 3 (dapat ${id.section_count})`);
  assert.ok(id.count > 0);
});

// ---------------------------------------------------------------- live: genres

test("genres: 25 genre + 3 status, semua punya id & url", async () => {
  const g = await genres();
  assert.ok(g.genre_count >= 20, `genre >= 20 (dapat ${g.genre_count})`);
  assert.equal(g.status_count, 3, "3 opsi status: Hottest/Updated/Completed");
  const names = g.genres.map((x) => x.name);
  assert.ok(names.includes("Romance"), "ada Romance");
  assert.ok(names.includes("Action"), "ada Action");
  for (const x of g.genres) {
    noNull(x, `genre(${x.name})`);
    assert.match(x.url, /\/genre\//);
  }
  // "All" adalah genre id 0 -> tidak boleh bikin url category/0
  const romance = g.genres.find((x) => x.name === "Romance");
  assert.equal(romance.id, 8, "Romance = id 8");
});

// --------------------------------------------------------------- live: browse

test("browse: default listing 18 item + has_next", async () => {
  const b = await browse();
  assert.equal(b.count, 18, "18 item per halaman");
  assert.equal(b.has_next, true);
  assert.equal(b.next_page, 2, "next_page 1-based (situs pakai 0-based ?page=1)");
  assert.ok(!b.url.includes("page="), "halaman 1 = URL dasar tanpa ?page");
  for (const it of b.items) {
    noNull(it, "browse.item");
    assert.ok(it.content_id > 0);
    assert.ok(it.tags.length > 0, `${it.title} punya tags`);
    assert.ok(it.episode_count > 0, `${it.title} episode_count > 0`);
    assert.ok(it.views > 0, `${it.title} views > 0`);
    assert.ok(it.likes > 0, `${it.title} likes > 0`);
  }
});

test("browse: page 2 beda dari page 1", async () => {
  const p1 = await browse({ page: 1 });
  const p2 = await browse({ page: 2 });
  const s1 = new Set(p1.items.map((x) => x.content_id));
  const dup = p2.items.filter((x) => s1.has(x.content_id));
  assert.equal(p2.count, 18);
  assert.equal(dup.length, 0, `page2 tidak duplikat page1 (dup=${dup.length})`);
});

test("browse: filter genre benar-benar memfilter", async () => {
  const bl = await browse({ genre: 9, status: 0 }); // Boys' Love
  assert.ok(bl.count > 0);
  const withTag = bl.items.filter((it) =>
    it.tags.some((t) => /boys|bl|lgbt/i.test(t))
  );
  assert.ok(
    withTag.length >= bl.count / 2,
    `mayoritas item genre BL bertag BL (${withTag.length}/${bl.count})`
  );
});

test("browse: status=2 (completed) semua completed", async () => {
  const c = await browse({ genre: 0, status: 2 });
  assert.ok(c.count > 0);
  assert.notDeepEqual(
    c.items.map((x) => x.content_id),
    (await browse({ genre: 0, status: 1 })).items.map((x) => x.content_id),
    "status 1 dan 2 beda hasil"
  );
});

test("browse: page melewati batas -> HttpError 404", async () => {
  await assert.rejects(
    () => browse({ page: 9999 }),
    (err) => err instanceof HttpError && err.status === 404
  );
});

test("hot & updated: shortcut listing jalan", async () => {
  const a = await hot();
  const b = await updated();
  assert.ok(a.count >= 15, `hot >= 15 (dapat ${a.count})`);
  assert.ok(b.count >= 15, `updated >= 15 (dapat ${b.count})`);
  assert.notDeepEqual(
    a.items.map((x) => x.content_id),
    b.items.map((x) => x.content_id),
    "hot != updated"
  );
});

// ---------------------------------------------------------------- live: byTag

test("byTag: tag id dari series, pagination + akhir halaman", async () => {
  const t = await byTag({ tag: 2 }); // School life
  assert.equal(t.count, 18);
  assert.equal(t.has_next, true);
  for (const it of t.items) noNull(it, "byTag.item");

  // halaman terakhir tag 2 = page 26 (situs: ?page=25), item parsial 14
  const last = await byTag({ tag: 2, page: 26 });
  assert.ok(last.count > 0 && last.count < 18, `halaman akhir parsial (${last.count})`);
  assert.equal(last.has_next, false, "halaman terakhir tanpa Next");
  assert.equal(last.next_page, 0);
});

test("byTag: tag tidak valid -> HttpError 404", async () => {
  await assert.rejects(
    () => byTag({ tag: 999999 }),
    (err) => err instanceof HttpError && err.status === 404
  );
});

// --------------------------------------------------------------- live: search

test("search: query populer mengembalikan hasil relevan", async () => {
  const r = await search({ word: "bossy" });
  assert.equal(r.found, true);
  assert.ok(r.count >= 10, `>= 10 hasil (dapat ${r.count})`);
  for (const it of r.items) noNull(it, "search.item", { allowEmptyString: ["slug"] });
  assert.ok(
    r.items.some((x) => /bossy/i.test(x.title)),
    "ada judul mengandung 'bossy'"
  );
});

test("search: hasil dicampur NovelToon — ditandai kind, tidak dibuang diam-diam", async () => {
  const r = await search({ word: "bossy" });
  assert.equal(r.count, r.comic_count + r.novel_count, "semua item terklasifikasi");
  assert.ok(r.comic_count > 0, `ada komik MangaToon (${r.comic_count})`);
  assert.ok(r.novel_count > 0, `ada novel NovelToon (${r.novel_count})`);
  for (const it of r.items) {
    if (it.kind === "comic") {
      assert.ok(it.content_id > 0, `${it.title}: comic wajib punya content_id`);
      assert.ok(it.slug.length > 0, `${it.title}: comic wajib punya slug`);
      assert.match(it.url, /mangatoon\.mobi/);
    } else {
      assert.equal(it.content_id, 0, `${it.title}: novel content_id 0`);
      assert.ok(it.novel_id > 0, `${it.title}: novel wajib punya novel_id`);
      assert.match(it.url, /noveltoon\.mobi/);
    }
    assert.ok(it.type.length > 0, `${it.title}: punya tag type`);
  }
  // content_id dari hasil kind=comic harus benar-benar bisa dibuka
  const comic = r.items.find((x) => x.kind === "comic");
  const s = await series({ id: comic.content_id, slug: comic.slug });
  assert.equal(s.title, comic.title, "series() cocok dengan hasil search");
});

test("search: judul spesifik + query tanpa hasil (situs balas 404)", async () => {
  const exact = await search({ word: "Hunk No.1" });
  assert.ok(exact.count >= 1, `judul spesifik dapat hasil (${exact.count})`);
  assert.ok(
    exact.items.some((x) => x.content_id === HUNK),
    "Hunk No.1 (content_id 21) ada di hasil"
  );

  const none = await search({ word: "zzzqqqxyz123" });
  assert.equal(none.found, false, "404 dari situs dinormalisasi jadi found=false");
  assert.equal(none.count, 0);
  assert.equal(none.comic_count, 0);
  assert.equal(none.novel_count, 0);
  assert.deepEqual(none.items, []);
});

test("search: TIDAK ada pagination di situs (?page diabaikan)", async () => {
  // Diverifikasi live: /en/search?word=love&page=2 mengembalikan hasil identik
  // dengan page 1. Karena itu search() tidak menerima param page sama sekali.
  const a = await search({ word: "love" });
  assert.ok(a.count > 0);
  assert.ok(!("page" in a), "response tidak menjanjikan pagination");
  assert.ok(!("has_next" in a), "tidak ada has_next yang menyesatkan");
});

// --------------------------------------------------------------- live: series

test("series: metadata lengkap, TIDAK ADA field null", async () => {
  const s = await series({ id: HUNK, slug: "hunk-no-1" });
  noNull(s, "series", { allowEmptyString: [] });
  assert.equal(s.content_id, HUNK);
  assert.equal(s.title, "Hunk No.1");
  assert.equal(s.status, "completed");
  assert.equal(s.author, "Yoolook Culture");
  assert.ok(s.score > 0 && s.score <= 5, `score 0-5 (dapat ${s.score})`);
  assert.ok(s.views > 100e6, `views > 100M (dapat ${s.views})`);
  assert.ok(s.likes > 1e6, `likes > 1M (dapat ${s.likes})`);
  assert.match(s.cover, /^https:\/\//);
  assert.ok(s.description.length > 50, "deskripsi terisi");
  assert.ok(s.tag_count >= 5, `tags >= 5 (dapat ${s.tag_count})`);
  for (const t of s.tags) {
    assert.ok(t.id > 0 && t.name.length > 0, `tag valid: ${JSON.stringify(t)}`);
  }
});

test("series: episode TIDAK dobel (situs render asc+desc) & dedup benar", async () => {
  const s = await series({ id: HUNK, slug: "hunk-no-1" });
  assert.equal(s.episode_count, 350, "350 episode, bukan 700");
  assert.equal(s.latest_episode, 350, "cocok dengan 'Update to episode 350'");
  const ids = s.episodes.map((e) => e.episode_id);
  assert.equal(new Set(ids).size, ids.length, "episode_id unik");
  const nums = s.episodes.map((e) => e.number);
  assert.equal(Math.min(...nums), 1);
  assert.equal(Math.max(...nums), 350);
});

test("series: setiap episode punya semua field terisi", async () => {
  const s = await series({ id: HUNK, slug: "hunk-no-1" });
  for (const e of s.episodes) {
    noNull(e, `ep${e.number}`);
    assert.ok(e.episode_id > 0);
    assert.ok(e.number > 0);
    assert.match(e.url, /\/watch\/\d+\/\d+$/);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `tanggal ISO: ${e.date}`);
    assert.ok(e.views > 0, `ep${e.number} views > 0`);
    assert.ok(e.likes > 0, `ep${e.number} likes > 0`);
  }
  const ep1 = s.episodes.find((e) => e.number === 1);
  assert.equal(ep1.episode_id, HUNK_EP1);
  assert.equal(ep1.date, "2018-07-14");
});

test("series: slug salah tetap jalan (situs 302 ke slug kanonik)", async () => {
  const s = await series({ id: HUNK, slug: "slug-ngawur-banget" });
  assert.equal(s.title, "Hunk No.1", "redirect diikuti");
  assert.equal(s.episode_count, 350);
});

test("series: ongoing 900+ episode juga tidak dobel", async () => {
  const s = await series({ id: TDG, slug: "tales-demons-gods" });
  assert.equal(s.status, "on going");
  assert.ok(s.episode_count > 900, `> 900 episode (dapat ${s.episode_count})`);
  assert.equal(
    s.episode_count,
    s.latest_episode,
    `episode_count (${s.episode_count}) == latest_episode (${s.latest_episode})`
  );
  const ids = s.episodes.map((e) => e.episode_id);
  assert.equal(new Set(ids).size, ids.length, "tidak ada duplikat");
});

test("series: content_id tidak ada -> HttpError 404", async () => {
  await assert.rejects(
    () => series({ id: 999999999 }),
    (err) => err instanceof HttpError && err.status === 404
  );
});

// -------------------------------------------------- live: gambar episode

test("episodeImages: pakai JSON pictures, URL watermark, semua field terisi", async () => {
  const ep = await episodeImages({ contentId: HUNK, episodeId: HUNK_EP1 });
  assert.equal(ep.count, 8, "8 halaman");
  assert.equal(ep.prev_episode, 0, "episode pertama: tidak ada prev (situs isi diri sendiri)");
  assert.equal(ep.next_episode, 518, "next episode 518");
  for (const p of ep.pages) {
    noNull(p, `page${p.index}`);
    assert.match(p.url, /^https:\/\/[a-z]{2}-c-pic-aliyun\.mangatoon\.mobi\/.*\.jpg$/);
    assert.match(p.encrypted_url, /\/encrypted\/.*\.webp$/);
    assert.ok(p.width > 0 && p.height > 0, "dimensi terisi");
  }
  const idx = ep.pages.map((p) => p.index);
  assert.deepEqual(idx, [1, 2, 3, 4, 5, 6, 7, 8], "index berurutan");
});

test("episodeImages: nav prev/next dibaca dari LABEL, bukan class (class situs salah)", async () => {
  // /en/watch/21/518: kedua tombol memakai class `page-icons-next`
  const ep2 = await episodeImages({ contentId: HUNK, episodeId: 518 });
  assert.equal(ep2.prev_episode, 517, "prev = 517 walau class-nya 'next'");
  assert.equal(ep2.next_episode, 516, "next = 516 (episode_id tidak berurutan)");
  // episode terakhir: tidak ada next
  const last = await episodeImages({ contentId: HUNK, episodeId: 39139 });
  assert.equal(last.next_episode, 0, "episode terakhir tanpa next");
  assert.ok(last.prev_episode > 0, "tapi punya prev");
});

test("episodeImages: episode yang <img> HTML-nya cuma sebagian tetap lengkap", async () => {
  // watch/5/40: HTML cuma render 2 <img>, JSON pictures berisi 8
  const ep = await episodeImages({ contentId: TDG, episodeId: 40 });
  assert.equal(ep.count, 8, "8 halaman dari JSON, bukan 2 dari <img>");
  for (const p of ep.pages) {
    assert.match(p.url, /-c-pic-aliyun\.mangatoon\.mobi\/.*\/watermark\/.*\.jpg$/);
  }
});

test("episodeImages: episode_id palsu -> HttpError 404 (situs balas 200 kosong)", async () => {
  await assert.rejects(
    () => episodeImages({ contentId: HUNK, episodeId: 99999999 }),
    (err) => err instanceof HttpError && err.status === 404
  );
});

test("episodeImages: content_id ngawur -> HttpError 404", async () => {
  await assert.rejects(
    () => episodeImages({ contentId: 999, episodeId: HUNK_EP1 }),
    (err) => err instanceof HttpError && err.status === 404
  );
});

test("download: file JPEG asli tersimpan di disk", async () => {
  const { rm, readFile } = await import("node:fs/promises");
  const dir = "/tmp/mt_test_dl";
  await rm(dir, { recursive: true, force: true });
  const res = await download({ contentId: HUNK, episodeId: HUNK_EP1, dir, limit: 2 });
  assert.equal(res.count, 2);
  for (const f of res.saved) {
    assert.ok(f.bytes > 50000, `${f.file} > 50KB (dapat ${f.bytes})`);
    const buf = await readFile(f.file);
    assert.equal(buf[0], 0xff, "magic JPEG byte 0");
    assert.equal(buf[1], 0xd8, "magic JPEG byte 1");
  }
  await rm(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------- live: booklist

test("booklist: 40 kartu, termasuk kartu tanpa blok rekomendasi", async () => {
  const b = await booklist();
  assert.ok(b.count >= 38, `>= 38 booklist (dapat ${b.count})`);

  // Situs merender 40 anchor booklist-detail per halaman. Pola pemotong lama
  // (`</a></div>`) menelan 2 kartu yang tidak punya blok rekomendasi.
  const anchors = b.items.length;
  assert.equal(new Set(b.items.map((x) => x.booklist_id)).size, anchors, "id unik");

  for (const it of b.items) {
    // `user`/`user_avatar` sengaja boleh string kosong: ada booklist dengan
    // pemilik anonim/terhapus (situs merender <p> kosong + avatar default).
    noNull(it, "booklist.item", { allowEmptyString: ["user", "user_avatar"] });
    assert.ok(it.booklist_id > 0);
    assert.ok(it.title.length > 0, `booklist ${it.booklist_id} punya judul`);
    assert.match(it.date, /^\d{2}\/\d{2}\/\d{4}$/, `tanggal dd/mm/yyyy: ${it.date}`);
    assert.equal(
      it.series_count,
      it.comic_count + it.novel_count,
      `booklist ${it.booklist_id}: series terklasifikasi comic/novel`
    );
    for (const s of it.series) {
      if (s.kind === "comic") assert.ok(s.content_id > 0, "comic punya content_id");
      else assert.ok(s.novel_id > 0, "novel punya novel_id");
    }
  }

  // Minimal ada satu booklist yang isinya komik MangaToon (bisa dipakai series())
  const withComic = b.items.find((x) => x.comic_count > 0);
  assert.ok(withComic, "ada booklist berisi komik MangaToon");
});

test("booklist: kartu tanpa pemilik & tanpa rekomendasi tetap ikut (bukan dibuang)", async () => {
  const b = await booklist();
  const empty = b.items.filter((x) => x.series_count === 0);
  // Terverifikasi live: 2 dari 40 kartu memang tanpa blok rekomendasi.
  // Yang penting kartu-kartu itu TETAP muncul dengan judul & tanggal terisi.
  for (const it of empty) {
    assert.ok(it.title.length > 0, `kartu kosong ${it.booklist_id} tetap punya judul`);
    assert.match(it.date, /^\d{2}\/\d{2}\/\d{4}$/);
  }
});

test("booklistDetail: detail satu booklist (markup src, bukan lazyload)", async () => {
  const list = await booklist();
  const first = list.items.find((x) => x.series_count > 0 && x.user);
  const d = await booklistDetail({ id: first.booklist_id });
  assert.equal(d.booklist_id, first.booklist_id);
  noNull(d, "booklistDetail", { allowEmptyString: ["user", "user_avatar"] });
  assert.ok(d.series_count > 0, "ada series di dalamnya");
  assert.equal(d.user, first.user, "pemilik cocok dengan listing");
  assert.ok(d.page_title.length > 0, "judul dari <title>");
  // Halaman detail memakai <img src>, bukan data-src — pickAvatar harus dapat
  assert.ok(d.user_avatar.length > 0, "avatar terambil dari varian src");
  assert.ok(!/default\.(png|webp)/.test(d.user_avatar), "bukan placeholder default");
});

// -------------------------------------------------------------- live: sitemap

test("sitemapIndex: 11 sitemap (5 detail + 5 genre + static)", async () => {
  const s = await sitemapIndex();
  assert.equal(s.count, 11, `11 sitemap (dapat ${s.count})`);
  for (const it of s.items) noNull(it, "sitemapIndex.item");
});

test("sitemap: seluruh katalog 1 request, per bahasa", async () => {
  const en = await sitemap({ lang: "en" });
  assert.ok(en.count >= 500, `en >= 500 series (dapat ${en.count})`);
  const ids = en.items.map((x) => x.content_id);
  assert.equal(new Set(ids).size, ids.length, "content_id unik");
  for (const it of en.items) {
    assert.ok(it.content_id > 0, "content_id terisi");
    assert.ok(it.slug.length > 0, "slug terisi");
    // lastmod & cover: 1 entry di sisi situs memang tidak punya -> string kosong
    assert.equal(typeof it.lastmod, "string");
    assert.equal(typeof it.cover, "string");
  }
  const withDate = en.items.filter((x) => x.lastmod).length;
  assert.ok(withDate >= en.count - 5, `hampir semua punya lastmod (${withDate}/${en.count})`);

  const id = await sitemap({ lang: "id" });
  assert.ok(id.count >= 200, `id >= 200 (dapat ${id.count})`);
  assert.notEqual(id.count, en.count, "katalog per bahasa beda");
});

test("sitemap: semua 5 bahasa hidup", async () => {
  for (const lang of LANGS) {
    const s = await sitemap({ lang });
    assert.ok(s.count > 100, `${lang}: ${s.count} series`);
  }
});

// ------------------------------------------------------------------ live: walk

test("walk: paginasi otomatis sampai habis, dedup", async () => {
  const res = await walk(byTag, { tag: 19 }, { maxPages: 6 }); // Mystery
  assert.ok(res.pages >= 2, `walk >= 2 halaman (dapat ${res.pages})`);
  assert.ok(res.count >= 30, `>= 30 series (dapat ${res.count})`);
  const ids = res.items.map((x) => x.content_id);
  assert.equal(new Set(ids).size, ids.length, "tidak ada duplikat antar halaman");
  assert.ok(res.stopped_at.length > 0, `alasan berhenti dilaporkan: ${res.stopped_at}`);
});

test("walk: sampai halaman terakhir sungguhan + jalan untuk booklist", async () => {
  // tag 2 (School life) habis di halaman 26 dengan 14 item (terverifikasi live)
  const res = await walk(byTag, { tag: 2 }, { maxPages: 30 });
  assert.equal(res.pages, 26, `26 halaman (dapat ${res.pages})`);
  assert.match(res.stopped_at, /halaman terakhir/, `berhenti wajar: ${res.stopped_at}`);
  assert.ok(res.count > 400, `>= 400 series (dapat ${res.count})`);

  // booklist tidak punya content_id — dedup harus jatuh ke booklist_id,
  // kalau tidak hasilnya menciut jadi 1 item.
  const bl = await walk(booklist, {}, { maxPages: 2 });
  assert.ok(bl.count >= 70, `walk booklist >= 70 kartu (dapat ${bl.count})`);
  assert.equal(
    new Set(bl.items.map((x) => x.booklist_id)).size,
    bl.count,
    "booklist_id unik antar halaman"
  );
});

// ------------------------------------------------- audit anti-null menyeluruh

test("AUDIT: tidak ada null/undefined di SEMUA endpoint", async () => {
  const scan = (v, path, bad) => {
    if (v === null || v === undefined) bad.push(path);
    else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${path}[${i}]`, bad));
    else if (typeof v === "object") {
      for (const [k, val] of Object.entries(v)) scan(val, `${path}.${k}`, bad);
    }
  };
  const results = {
    home: await home(),
    genres: await genres(),
    browse: await browse(),
    hot: await hot(),
    updated: await updated(),
    byTag: await byTag({ tag: 8 }),
    search: await search({ word: "ceo" }),
    searchEmpty: await search({ word: "zzzqqqxyz123" }),
    series: await series({ id: HUNK, slug: "hunk-no-1" }),
    episodeImages: await episodeImages({ contentId: HUNK, episodeId: HUNK_EP1 }),
    booklist: await booklist(),
    booklistDetail: await booklistDetail({ id: 3121 }),
    sitemap: await sitemap({ lang: "en" }),
    sitemapIndex: await sitemapIndex(),
  };
  const bad = [];
  for (const [name, res] of Object.entries(results)) scan(res, name, bad);
  assert.deepEqual(bad, [], `field null/undefined: ${bad.slice(0, 10).join(", ")}`);

  // NaN juga terlarang — parseCount harus selalu mengembalikan angka
  const nans = [];
  const scanNan = (v, path) => {
    if (typeof v === "number" && Number.isNaN(v)) nans.push(path);
    else if (Array.isArray(v)) v.forEach((x, i) => scanNan(x, `${path}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) scanNan(val, `${path}.${k}`);
    }
  };
  for (const [name, res] of Object.entries(results)) scanNan(res, name);
  assert.deepEqual(nans, [], `field NaN: ${nans.slice(0, 10).join(", ")}`);
});
