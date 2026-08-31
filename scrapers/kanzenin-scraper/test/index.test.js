import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  search,
  azList,
  genres,
  byGenre,
  browse,
  listMode,
  home,
  project,
  feed,
  series,
  chapterImages,
  chapterSlug,
} from "../src/index.js";

const SERIES = "rooftop-sex-king";
const CHAPTER = "torokeru-tsuma-chichi-chapter-2";
const UA_TEST =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test("genres: 44 genre dgn id numerik + slug unik", async () => {
  const g = await genres();
  assert.ok(Array.isArray(g) && g.length >= 40, `>= 40 genre (dapat ${g.length})`);
  const slugs = new Set(g.map((x) => x.slug));
  assert.equal(slugs.size, g.length, "slug unik");
  for (const x of g) {
    assert.ok(Number.isInteger(x.id) && x.id > 0, `id numerik utk ${x.name}`);
    assert.ok(x.slug && x.name, "slug+nama ada");
  }
  console.log(`  [genres] ${g.length} genre, contoh: ${g.slice(0, 3).map((x) => `${x.name}=${x.id}`).join(", ")}`);
}, { timeout: 60000 });

test("browse: filter order=popular beda urutan dari order=title", async () => {
  const pop = await browse({ order: "popular" });
  const az = await browse({ order: "title" });
  assert.ok(pop.items.length >= 20, `>= 20 item/page (dapat ${pop.items.length})`);
  assert.notEqual(pop.items[0].url, az.items[0].url, "urutan popular != A-Z");
  assert.equal(pop.has_next, true, "ada halaman berikutnya");
  assert.equal(pop.next_page, 2);
  console.log(`  [browse order] popular#1="${pop.items[0].title}" vs title#1="${az.items[0].title}"`);
}, { timeout: 90000 });

test("browse: pagination ?page=N beneran maju (BUKAN /page/N/)", async () => {
  const p1 = await browse({ order: "title" });
  const p2 = await browse({ order: "title", page: 2 });
  const u1 = new Set(p1.items.map((x) => x.url));
  const dup = p2.items.filter((x) => u1.has(x.url)).length;
  assert.equal(dup, 0, "page 2 gak dup page 1");
  assert.ok(p2.items.length > 0, "page 2 ada item");
  console.log(`  [browse page] p1=${p1.items.length} p2=${p2.items.length} dup=${dup} next=${p2.next_page}`);
}, { timeout: 90000 });

test("browse: filter genre[] beneran nyaring (Yuri = 1 series)", async () => {
  const g = await genres();
  const yuri = g.find((x) => x.name === "Yuri");
  assert.ok(yuri, "genre Yuri ada");
  const r = await browse({ genre: [yuri.id] });
  assert.ok(r.items.length >= 1 && r.items.length < 27, `hasil tersaring (dapat ${r.items.length})`);
  assert.equal(r.has_next, false, "1 halaman saja");
  const slug = r.items[0].url.replace(/.*\/manga\/([^/]+)\/?$/, "$1");
  const d = await series(slug);
  assert.ok(d.genres.includes("Yuri"), `series hasil filter punya genre Yuri (dapat ${JSON.stringify(d.genres)})`);
  console.log(`  [browse genre] Yuri(id ${yuri.id}) -> ${r.items.length} series: ${r.items[0].title} genres=${JSON.stringify(d.genres)}`);
}, { timeout: 120000 });

test("browse: status/type filter + kombinasi kosong", async () => {
  const comp = await browse({ status: "completed" });
  const mhw = await browse({ type: "manhwa" });
  const hiatus = await browse({ status: "hiatus" });
  const manhua = await browse({ type: "manhua" });
  assert.ok(comp.items.length > 0, "completed ada");
  assert.ok(mhw.items.length > 0, "manhwa ada");
  assert.equal(hiatus.items.length, 0, "hiatus kosong di site (bukan error)");
  assert.equal(manhua.items.length, 0, "manhua kosong di site");
  // verifikasi type beneran
  const slug = mhw.items[0].url.replace(/.*\/manga\/([^/]+)\/?$/, "$1");
  const d = await series(slug);
  assert.equal(d.type, "Manhwa", `type cocok (dapat ${d.type})`);
  console.log(`  [browse status/type] completed=${comp.items.length} manhwa=${mhw.items.length} hiatus=0 manhua=0 | verified type=${d.type}`);
}, { timeout: 120000 });

test("browse: page melebihi batas -> items kosong, has_next false", async () => {
  const g = await genres();
  const yuri = g.find((x) => x.name === "Yuri");
  const r = await browse({ genre: [yuri.id], page: 5 });
  assert.equal(r.items.length, 0, "kosong");
  assert.equal(r.has_next, false);
  console.log(`  [browse edge] page 5 -> 0 item, has_next=false (OK)`);
}, { timeout: 60000 });

test("listMode: SELURUH katalog 1 request (pakai ?list, BUKAN /list-mode/ yg basi)", async () => {
  const lm = await listMode();
  assert.ok(lm.total >= 2300, `>= 2300 series (dapat ${lm.total})`);
  assert.equal(lm.items.length, lm.total);
  assert.equal(new Set(lm.items.map((x) => x.slug)).size, lm.total, "slug unik");
  for (const x of lm.items.slice(0, 50)) {
    assert.ok(Number.isInteger(x.post_id) && x.post_id > 0, "post_id numerik");
    assert.ok(x.url.includes("/manga/"), "url /manga/");
    assert.ok(x.title, "title");
    assert.ok(x.letter, "letter");
  }
  const sum = Object.values(lm.letters).reduce((a, b) => a + b, 0);
  assert.equal(sum, lm.total, "jumlah per huruf = total");
  // /manga/list-mode/ itu halaman STATIS yang basi — harus lebih sedikit
  const stale = await fetch("https://kanzenin.info/manga/list-mode/", {
    headers: { "user-agent": UA_TEST },
  }).then((r) => r.text());
  const staleCount = (stale.match(/<a class="series[^"]*" rel="\d+"/g) || []).length;
  assert.ok(staleCount > 0 && staleCount < lm.total, `/list-mode/ (${staleCount}) < ?list (${lm.total})`);
  console.log(`  [list-mode] ?list=${lm.total} vs /list-mode/=${staleCount} (basi), ${Object.keys(lm.letters).length} grup, sum cocok`);
}, { timeout: 90000 });

test("home: 4 section + rilis chapter terbaru", async () => {
  const h = await home();
  const names = Object.keys(h.sections);
  assert.ok(names.length >= 3, `>= 3 section (dapat ${names.length}: ${names})`);
  assert.ok(names.some((n) => /Popular/i.test(n)), "ada Popular Today");
  assert.ok(names.some((n) => /Latest/i.test(n)), "ada Latest Update");
  for (const [name, items] of Object.entries(h.sections)) {
    assert.ok(items.length > 0, "section punya item");
    for (const it of items) {
      // Popular/Recommendation -> kartu series; Latest/Project Update -> kartu chapter.
      // Dua-duanya WAJIB punya series_url yang nunjuk /manga/<slug>/.
      assert.ok(it.series_url && it.series_url.includes("/manga/"), `${name}: series_url /manga/`);
      assert.ok(it.title, `${name}: title`);
      if (it.kind === "chapter") {
        assert.ok(Number.isFinite(it.chapter), `${name}: nomor chapter`);
        // sebagian besar /<slug>-chapter-<n>/, ada yang /<slug>-<n>/
        assert.match(it.chapter_url, /-\d+(?:-\d+)?\/$/, `${name}: chapter_url berakhir nomor`);
      }
    }
  }
  const kinds = new Set(Object.values(h.sections).flat().map((x) => x.kind));
  assert.ok(kinds.has("series") && kinds.has("chapter"), "ada dua jenis kartu (series + chapter)");
  assert.ok(h.latest_chapters.length >= 10, `>= 10 rilis chapter (dapat ${h.latest_chapters.length})`);
  for (const c of h.latest_chapters.slice(0, 5)) {
    assert.ok(c.series && c.url.includes("-chapter-"), "chapter url");
    assert.ok(Number.isFinite(c.chapter), "nomor chapter");
  }
  console.log(`  [home] ${names.map((n) => `${n}(${h.sections[n].length}/${h.sections[n][0].kind})`).join(" ")} | ${h.latest_chapters.length} rilis`);
}, { timeout: 60000 });

test("project: series garapan sendiri + pagination (104 halaman)", async () => {
  const p = await project();
  assert.ok(p.count >= 5, `>= 5 series (dapat ${p.count})`);
  assert.ok(p.max_page >= 50, `max_page besar (dapat ${p.max_page})`);
  for (const it of p.items) assert.ok(it.series_url.includes("/manga/"), "series_url valid");
  const p2 = await project({ page: 2 });
  const dup = p2.items.filter((x) => p.items.some((y) => y.url === x.url)).length;
  assert.equal(dup, 0, "halaman 2 beda dari halaman 1");
  console.log(`  [project] p1=${p.count} p2=${p2.count} max_page=${p.max_page} dup=${dup}, #1: ${p.items[0].title}`);
}, { timeout: 60000 });

test("feed: 10 rilis terakhir + timestamp ISO valid", async () => {
  const f = await feed();
  assert.ok(f.length >= 5, `>= 5 item (dapat ${f.length})`);
  for (const it of f) {
    assert.ok(it.title && /Chapter/i.test(it.title), `title punya 'Chapter' (${it.title})`);
    assert.ok(it.url.includes("-chapter-"), "url chapter");
    assert.ok(!Number.isNaN(Date.parse(it.iso)), "ISO valid");
  }
  // terurut terbaru dulu
  for (let i = 1; i < f.length; i++) {
    assert.ok(Date.parse(f[i - 1].iso) >= Date.parse(f[i].iso), "terurut desc");
  }
  console.log(`  [feed] ${f.length} item, terbaru: ${f[0].title} @ ${f[0].iso}`);
}, { timeout: 60000 });

test("search page 1: {items,page,max_page} + url /manga/", async () => {
  const r = await search("love", { page: 1 });
  assert.ok(Array.isArray(r.items) && r.items.length > 0, "ada hasil");
  assert.equal(r.page, 1);
  assert.ok(r.max_page >= 2, `max_page>=2 (dapat ${r.max_page})`);
  for (const it of r.items.slice(0, 3)) {
    assert.ok(it.url && it.url.includes("/manga/"), "url /manga/");
    assert.ok(it.title, "title ada");
  }
  console.log(`  [search p1] ${r.items.length} hasil, max_page=${r.max_page}, #1: ${r.items[0].title}`);
}, { timeout: 60000 });

test("search page 2: beda item + max_page konsisten", async () => {
  const p1 = await search("love", { page: 1 });
  const p2 = await search("love", { page: 2 });
  const u1 = new Set(p1.items.map((x) => x.url));
  const dup = p2.items.filter((x) => u1.has(x.url)).length;
  assert.equal(dup, 0, "page 2 gak ada dup");
  assert.equal(p2.max_page, p1.max_page, "max_page konsisten");
  assert.ok(p2.items.length > 0, "page 2 ada item");
  console.log(`  [search p2] p1=${p1.items.length} p2=${p2.items.length} max_page=${p2.max_page} dup=${dup}`);
}, { timeout: 90000 });

test("search query gak ada: items kosong tanpa error", async () => {
  const r = await search("zqxwc123notreal");
  assert.ok(Array.isArray(r.items));
  assert.equal(r.items.length, 0, "0 hasil");
  console.log(`  [search kosong] ${r.items.length} hasil (OK)`);
}, { timeout: 60000 });

test("azList('A'): items + ada pagination (max_page)", async () => {
  const r = await azList("A");
  assert.ok(r.items.length > 0, "ada hasil");
  assert.ok(r.max_page >= 1, "max_page >= 1");
  for (const it of r.items) assert.ok(it.url.includes("/manga/"));
  console.log(`  [az A] ${r.items.length} series, max_page=${r.max_page}, #1: ${r.items[0].title}`);
}, { timeout: 60000 });

test("byGenre('romance'): items + max_page >= 10", async () => {
  const r = await byGenre("romance", { page: 1 });
  assert.ok(r.items.length > 0, "ada hasil");
  assert.ok(r.max_page >= 10, `max_page>=10 (dapat ${r.max_page})`);
  for (const it of r.items) assert.ok(it.url.includes("/manga/"));
  console.log(`  [genre romance] ${r.items.length} series, max_page=${r.max_page}`);
}, { timeout: 60000 });

test("series: metadata LENGKAP + chapters DEDUP (rooftop-sex-king: 80 li -> 77 unik)", async () => {
  const d = await series(SERIES);
  assert.equal(d.slug, SERIES);
  assert.ok(d.title && d.title.length > 3, "title");
  assert.ok(d.status, "status");
  assert.ok(d.type, "type");
  assert.ok(d.post_id > 0, "post_id");
  assert.ok(d.author, "author");
  assert.ok(d.released, "released");
  assert.ok(d.synopsis && d.synopsis.length > 30, "synopsis");
  // cover HARUS dari series ini (bukan kartu sidebar)
  assert.ok(d.image && d.image.includes("wp-content/uploads"), "cover wp-content");
  // genre HANYA milik series (bukan 44 genre widget filter)
  assert.ok(d.genres.length > 0 && d.genres.length < 20,
    `genre series saja, bukan widget 44 (dapat ${d.genres.length})`);
  assert.equal(d.genres.length, d.genre_slugs.length, "genres & slugs sejajar");
  // rating + followers + timestamp
  assert.ok(d.rating > 0 && d.rating <= 10, `rating valid (${d.rating})`);
  assert.ok(Number.isInteger(d.rating_count) && d.rating_count > 0, "rating_count");
  assert.ok(Number.isInteger(d.followers) && d.followers > 0, "followers");
  assert.ok(!Number.isNaN(Date.parse(d.posted_at)), "posted_at ISO");
  assert.ok(!Number.isNaN(Date.parse(d.updated_at)), "updated_at ISO");
  assert.ok(d.posted_by, "posted_by");
  assert.ok(d.chapters.length > 10, `chapters > 10 (dapat ${d.chapters.length})`);
  // DEDUP: number unik
  const nums = d.chapters.map((c) => c.number);
  assert.equal(new Set(nums).size, nums.length, "chapter number unik (dedup jalan)");
  // urutan desc
  for (let i = 1; i < nums.length; i++) assert.ok(nums[i - 1] >= nums[i], "urutan desc");
  // first/latest
  assert.ok(d.latest_chapter >= d.first_chapter, "latest >= first");
  for (const c of d.chapters) {
    assert.ok(c.url.includes("chapter-"), "chapter url");
    assert.ok(c.title, "chapter title");
  }
  console.log(`  [series] ${d.title} | ${d.status} ${d.type} | ${d.chapters.length} ch unik | rating ${d.rating} (${d.rating_count}) | ${d.followers} follower | genres=${JSON.stringify(d.genres)}`);
}, { timeout: 90000 });

test("chapterImages: 10+ halaman, semua dari CDN eksternal (bukan domain site)", async () => {
  const c = await chapterImages(CHAPTER);
  assert.equal(c.number, 2);
  assert.ok(c.count >= 10, `>= 10 halaman (dapat ${c.count})`);
  assert.equal(c.pages.length, c.count);
  for (const p of c.pages) {
    assert.ok(p.url.startsWith("http"), "URL absolut");
    assert.ok(!p.url.includes("kanzenin.info"), `bukan domain site (dapat ${p.url.slice(0, 40)})`);
    assert.match(p.url, /\.(jpe?g|png|webp|avif|gif)$/i, "ext gambar");
  }
  assert.equal(new Set(c.pages.map((p) => p.url)).size, c.count, "URL unik");
  console.log(`  [images] ${c.count} halaman, pertama: ${c.pages[0].url.slice(0, 55)}...`);
}, { timeout: 60000 });

test("chapterImages series 2 (chapter pertama rooftop): valid", async () => {
  const d = await series(SERIES);
  const first = d.chapters[d.chapters.length - 1]; // chapter terlama
  const c = await chapterImages(first.url);
  assert.ok(c.count >= 3, `ada halaman (dapat ${c.count})`);
  assert.ok(c.number === first.number, "number cocok");
  console.log(`  [images ch-${first.number}] ${c.count} halaman`);
}, { timeout: 90000 });

test("decodeEnt: judul dgn entity HTML ter-decode (&#038; -> &)", async () => {
  const g = await genres();
  const yuri = g.find((x) => x.name === "Yuri");
  const r = await browse({ genre: [yuri.id] });
  const t = r.items[0].title;
  assert.ok(!/&#\d+;|&[a-z]+;/i.test(t), `judul bersih dari entity (dapat "${t}")`);
  assert.ok(t.includes("&"), `entity &#038; jadi & (dapat "${t}")`);
  console.log(`  [entity] "${t}" OK`);
}, { timeout: 90000 });

test("series: one-shot 1 chapter TIDAK balik 0 (li punya class first-chapter)", async () => {
  const d = await series("10-kara-hajimeru-eisai-kyouiku");
  assert.equal(d.chapters.length, 1, `1 chapter (dapat ${d.chapters.length})`);
  assert.equal(d.chapters[0].number, 1);
  console.log(`  [one-shot] ${d.title} -> ${d.chapters.length} ch, number=${d.chapters[0].number}`);
}, { timeout: 60000 });

test("series: data-num non-numerik ('45 End') keparse jadi number+label", async () => {
  const d = await series("a-delicate-relationship");
  const c = d.chapters[0];
  assert.equal(c.number, 45, `number 45 (dapat ${c.number})`);
  assert.equal(c.number_raw, "45 End");
  assert.equal(c.is_end, true);
  assert.equal(d.latest_chapter, 45);
  assert.ok(d.chapters.every((x) => Number.isFinite(x.number)), "semua number numerik");
  console.log(`  [data-num] "${c.number_raw}" -> number=${c.number} label=${c.label} is_end=${c.is_end}`);
}, { timeout: 60000 });

test("chapterImages: slug suffix '-end' keparse (delicate-relationship-chapter-45-end)", async () => {
  const c = await chapterImages("delicate-relationship-chapter-45-end");
  assert.equal(c.number, 45, `number 45 (dapat ${c.number})`);
  assert.ok(c.count >= 5, `ada halaman (dapat ${c.count})`);
  console.log(`  [images -end] number=${c.number}, ${c.count} halaman`);
}, { timeout: 60000 });

test("chapterImages: URL tanpa kata 'chapter' tetap keparse (im-a-vampire-43)", async () => {
  const c = await chapterImages("im-a-vampire-43");
  assert.equal(c.number, 43, `number 43 (dapat ${c.number})`);
  assert.ok(c.count >= 5, `ada halaman (dapat ${c.count})`);
  console.log(`  [images odd-url] im-a-vampire-43 -> number=${c.number}, ${c.count} halaman`);
}, { timeout: 60000 });

test("chapterImages: URL gambar http:// juga jalan lewat https://", async () => {
  const c = await chapterImages(CHAPTER);
  const httpOnes = c.pages.filter((p) => p.url.startsWith("http://"));
  assert.ok(httpOnes.length > 0, "chapter ini memang dilayani http://");
  const u = httpOnes[0].url;
  const [viaHttp, viaHttps] = await Promise.all([
    fetch(u, { headers: { "user-agent": UA_TEST } }),
    fetch(u.replace("http://", "https://"), { headers: { "user-agent": UA_TEST } }),
  ]);
  assert.equal(viaHttp.status, 200, "http 200");
  assert.equal(viaHttps.status, 200, "https 200 (CDN dukung TLS)");
  console.log(`  [proto] ${httpOnes.length}/${c.count} URL http:// — https:// juga 200, aman di-upgrade`);
}, { timeout: 90000 });

test("chapterSlug: integer + desimal", () => {
  assert.equal(chapterSlug("x", 5), "x-chapter-5");
  assert.equal(chapterSlug("x", 67.5), "x-chapter-67-5");
  console.log("  [slug] OK");
});

test("series 404: throw jelas", async () => {
  await assert.rejects(() => series("ini-bukan-series-xyz-12345"), (e) => e.status === 404 || /404/.test(e.message));
  console.log("  [404 series] throw OK");
}, { timeout: 60000 });

test("download 1 gambar via curl: valid JPEG dari cdnasu", async () => {
  const c = await chapterImages(CHAPTER);
  const url = c.pages[0].url;
  const out = "/tmp/kan_test_live.jpg";
  const s = await new Promise((resolve, reject) => {
    const cmd = spawn("curl", ["-sSL", "-m", "30", "-o", out, "-w", "%{http_code} %{size_download}",
      "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
      "-H", `Referer: ${c.url}`, url]);
    let ss = "", e = "";
    cmd.stdout.on("data", (x) => (ss += x));
    cmd.stderr.on("data", (x) => (e += x));
    cmd.on("error", reject);
    cmd.on("close", (code) => (code === 0 ? resolve(ss.trim()) : reject(new Error(e || "curl " + code))));
  });
  const [code, sizeStr] = s.split(" ");
  assert.equal(code, "200", "HTTP 200");
  const size = Number(sizeStr);
  assert.ok(size > 10000, `> 10KB (dapat ${size})`);
  const buf = fs.readFileSync(out);
  // magic bytes: JPEG (FF D8 FF) atau PNG (89 50 4E 47)
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  assert.ok(isJpeg || isPng, "magic bytes valid");
  console.log(`  [image] ${url.slice(0, 50)}... ${size} bytes ${isJpeg ? "JPEG" : "PNG"} OK`);
}, { timeout: 90000 });
