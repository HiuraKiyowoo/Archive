import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  search,
  azList,
  genres,
  byGenre,
  series,
  chapterImages,
  chapterSlug,
} from "../src/index.js";

const SERIES = "rooftop-sex-king";
const CHAPTER = "torokeru-tsuma-chichi-chapter-2";

test("genres: array non-kosong + slug unik", async () => {
  const g = await genres();
  assert.ok(Array.isArray(g) && g.length >= 5, "genres non-kosong");
  const slugs = new Set(g.map((x) => x.slug));
  assert.equal(slugs.size, g.length, "slug unik");
  console.log(`  [genres] ${g.length} genre: ${g.slice(0, 5).map((x) => x.slug).join(", ")}`);
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

test("series: metadata + chapters DEDUP (rooftop-sex-king: 80 li -> 77 unik)", async () => {
  const d = await series(SERIES);
  assert.equal(d.slug, SERIES);
  assert.ok(d.title && d.title.length > 3, "title");
  assert.ok(d.status, "status");
  assert.ok(d.type, "type");
  assert.ok(d.post_id > 0, "post_id");
  assert.ok(d.genres.length > 0, "genres");
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
  console.log(`  [series] ${d.title} | ${d.status} | ${d.chapters.length} ch unik | latest=${d.latest_chapter} first=${d.first_chapter}`);
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
