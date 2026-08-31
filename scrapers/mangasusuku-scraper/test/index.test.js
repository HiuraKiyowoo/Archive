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

const SERIES = "solo-leveling";
const CHAPTER = "solo-leveling-chapter-155";

test("genres: array non-kosong + slug unik", async () => {
  const g = await genres();
  assert.ok(Array.isArray(g) && g.length >= 5, "genres non-kosong");
  const slugs = new Set(g.map((x) => x.slug));
  assert.equal(slugs.size, g.length, "slug unik");
  assert.ok(slugs.has("action") || slugs.has("romance"), "punya genre umum");
  console.log(`  [genres] ${g.length} genre: ${g.slice(0, 5).map((x) => x.slug).join(", ")}`);
}, { timeout: 60000 });

test("search page 1: {items, page, max_page} + url /komik/", async () => {
  const r = await search("leveling", { page: 1 });
  assert.ok(Array.isArray(r.items), "items array");
  assert.ok(r.items.length > 0, "ada hasil");
  assert.equal(r.page, 1);
  assert.ok(r.max_page >= 1, "max_page >= 1");
  for (const it of r.items.slice(0, 3)) {
    assert.ok(it.url && it.url.includes("/komik/"), "url /komik/");
    assert.ok(it.title, "title ada");
  }
  assert.ok(r.items[0].url.includes("solo-leveling"), "hasil relevan #1");
  console.log(`  [search p1] ${r.items.length} hasil, max_page=${r.max_page}, #1: ${r.items[0].title}`);
}, { timeout: 60000 });

test("search page 2 (kata umum 'the'): beda item dari page 1 + max_page besar", async () => {
  const p1 = await search("the", { page: 1 });
  const p2 = await search("the", { page: 2 });
  assert.ok(p1.max_page >= 2, `max_page>=2 (dapat ${p1.max_page})`);
  const u1 = new Set(p1.items.map((x) => x.url));
  const dup = p2.items.filter((x) => u1.has(x.url)).length;
  assert.equal(dup, 0, "page 2 gak ada dup page 1");
  assert.ok(p2.items.length > 0, "page 2 ada item");
  console.log(`  [search p2] p1=${p1.items.length} p2=${p2.items.length} max_page=${p1.max_page} dup=${dup}`);
}, { timeout: 60000 });

test("search query gak ada: items kosong tanpa error", async () => {
  const r = await search("zqxwc123notreal");
  assert.ok(Array.isArray(r.items));
  assert.equal(r.items.length, 0, "0 hasil");
  console.log(`  [search 404] ${r.items.length} hasil (OK)`);
}, { timeout: 60000 });

test("azList('A'): items dgn url /komik/ + image + rating", async () => {
  const r = await azList("A");
  assert.ok(r.length > 0, "ada hasil");
  const it = r[0];
  assert.ok(it.url.includes("/komik/"), "url /komik/");
  assert.ok(it.image, "image ada");
  assert.ok(it.rating === null || (it.rating >= 0 && it.rating <= 10), "rating valid");
  console.log(`  [az A] ${r.length} series, #1: ${it.title} (${it.status}, rating ${it.rating})`);
}, { timeout: 60000 });

test("byGenre('romance'): items + max_page >= 1", async () => {
  const r = await byGenre("romance", { page: 1 });
  assert.ok(r.items.length > 0, "ada hasil");
  assert.ok(r.max_page >= 1, "max_page >= 1");
  for (const it of r.items) assert.ok(it.url.includes("/komik/"));
  console.log(`  [genre romance] ${r.items.length} series di page 1, max_page ${r.max_page}`);
}, { timeout: 60000 });

test("series detail: metadata lengkap + chapters dari admin-ajax", async () => {
  const d = await series(SERIES);
  assert.equal(d.slug, SERIES);
  assert.ok(d.title && d.title.length > 3, "title");
  assert.ok(d.status, "status");
  assert.ok(d.type, "type");
  assert.ok(d.post_id > 0, "post_id");
  assert.ok(d.genres.length > 0, "genres");
  assert.ok(d.synopsis && d.synopsis.length > 50, "synopsis");
  assert.ok(d.chapters.length > 0, "chapters (admin-ajax)");
  for (const c of d.chapters) {
    assert.ok(c.url.includes("chapter-"), "chapter url");
    assert.ok(c.id > 0, "chapter id");
  }
  // urutan desc (terbaru duluan)
  const nums = d.chapters.map((c) => Number((c.url.match(/chapter-(\d+)/) || [])[1]));
  for (let i = 1; i < nums.length; i++) assert.ok(nums[i - 1] >= nums[i], "urutan desc");
  console.log(`  [series] ${d.title} | ${d.status} | ${d.chapters.length} ch | rating ${d.rating} | ${d.genres.length} genre`);
}, { timeout: 90000 });

test("series 2 (wireless-onahole): chapters penuh (bisa 100+)", async () => {
  const d = await series("wireless-onahole");
  assert.ok(d.title, "title");
  assert.ok(d.chapters.length > 50, `banyak chapter (dapat ${d.chapters.length})`);
  console.log(`  [series 2] ${d.title} | ${d.chapters.length} ch`);
}, { timeout: 90000 });

test("chapterSlug: integer + desimal", () => {
  assert.equal(chapterSlug("solo-leveling", 155), "solo-leveling-chapter-155");
  assert.equal(chapterSlug("wireless-onahole", 67.5), "wireless-onahole-chapter-67-5");
  assert.equal(chapterSlug("x", "67.5"), "x-chapter-67-5");
  console.log("  [slug] integer + desimal OK");
});

test("chapterImages: 10+ halaman URL absolut + number benar", async () => {
  const c = await chapterImages(CHAPTER);
  assert.equal(c.number, 155);
  assert.ok(c.count >= 10, `>= 10 halaman (dapat ${c.count})`);
  assert.equal(c.pages.length, c.count);
  for (const p of c.pages) {
    assert.ok(p.url.startsWith("http"), "URL absolut");
    assert.match(p.url, /\.(jpe?g|png|webp|avif)$/, "ext gambar");
  }
  // nomor halaman unik
  assert.equal(new Set(c.pages.map((p) => p.n)).size, c.count);
  console.log(`  [images] ${c.count} halaman, pertama: ${c.pages[0].url.slice(0, 55)}...`);
}, { timeout: 60000 });

test("chapterImages desimal (ch-67.5 -> chapter-67-5): number 67.5 + ada page", async () => {
  const slug = chapterSlug("wireless-onahole", 67.5);
  const c = await chapterImages(slug);
  assert.equal(c.number, 67.5, "number desimal");
  assert.ok(c.count >= 1, `ada halaman (dapat ${c.count})`);
  console.log(`  [images desimal] ${slug} -> ${c.count} halaman, number=${c.number}`);
}, { timeout: 60000 });

test("download 1 gambar via curl: valid jpeg", async () => {
  const c = await chapterImages(CHAPTER);
  const url = c.pages[0].url;
  const out = "/tmp/susu_test_live.jpg";
  const s = await new Promise((resolve, reject) => {
    const cmd = spawn("curl", ["-sS", "-m", "30", "-o", out, "-w", "%{http_code} %{size_download}",
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
  assert.ok(size > 20000, `> 20KB (dapat ${size})`);
  const buf = fs.readFileSync(out);
  // magic bytes jpeg = FF D8 FF
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8);
  assert.equal(buf[2], 0xff);
  console.log(`  [image] ${url.slice(0, 55)}... ${size} bytes JPEG OK`);
}, { timeout: 90000 });
