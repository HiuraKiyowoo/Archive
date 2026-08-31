// Live tests — Ainz Scans ID scraper (v3.ainzscans01.com)
// Jalankan: node --test test/index.test.js
// Kebutuhan: internet + curl di PATH. Data live (bukan fixture).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  search,
  homeSections,
  seriesDetail,
  chapterList,
  getChapterImages,
  imageUrl,
} from "../src/index.js";

// Slug stabil (udah diverifikasi 2026-08-30):
const SERIES = "im-a-super-rich-guy-so-its-reasonable-for-me-to-be-a-scumbag";
const CHAPTER = "chapter-49";

test("imageUrl(): absolute/relative/bare", () => {
  assert.equal(imageUrl("https://cdn.uqni.net/x.webp"), "https://cdn.uqni.net/x.webp");
  assert.equal(imageUrl("/api/uploads/a/b.webp"), "https://v3.ainzscans01.com/api/uploads/a/b.webp");
  assert.equal(imageUrl("//cdn.uqni.net/x.webp"), "https://cdn.uqni.net/x.webp");
  assert.equal(imageUrl(null), null);
});

test("search: query 'leveling' balik items + pagination meta", async () => {
  const r = await search("leveling", { page: 1 });
  assert.ok(Array.isArray(r.items), "items harus array");
  assert.ok(r.items.length > 0, "items harus > 0");
  assert.ok(typeof r.total === "number" && r.total > 0, "total harus > 0");
  assert.ok(r.total_pages >= 1, "total_pages >= 1");
  const it = r.items[0];
  for (const k of ["id", "title", "slug", "type"]) assert.ok(it[k], `field ${k} ada`);
  assert.match(it.slug, /^[a-z0-9-]+$/, "slug format bener");
}, { timeout: 60000 });

test("homeSections: 4 section + latest_comic_updates punya chapter slugs", async () => {
  const h = await homeSections();
  for (const k of ["hot_weekly", "popular_daily", "latest_projects", "latest_comic_updates"]) {
    assert.ok(Array.isArray(h[k]) && h[k].length > 0, `section ${k} non-kosong`);
  }
  const upd = h.latest_comic_updates[0];
  assert.ok(upd.series_slug, "series_slug ada");
  assert.ok(Array.isArray(upd.chapters) && upd.chapters.length > 0, "chapters ada");
  assert.match(upd.chapters[0].slug, /^chapter-/i, "chapter slug format bener");
}, { timeout: 60000 });

test("seriesDetail: metadata lengkap + genres array", async () => {
  const d = await seriesDetail(SERIES);
  assert.equal(d.slug, SERIES);
  assert.equal(d.type, "COMIC");
  assert.ok(d.title, "title ada");
  assert.ok(Array.isArray(d.genres), "genres array");
  assert.ok(typeof d.synopsis === "string", "synopsis ada");
  assert.ok(d.poster_image_url, "poster ada");
  assert.ok(Array.isArray(d.units), "units (chapters) array");
}, { timeout: 60000 });

test("chapterList: terurut asc + >= 10 chapter", async () => {
  const list = await chapterList(SERIES);
  assert.ok(list.length >= 10, `min 10 chapter (dapat ${list.length})`);
  for (let i = 1; i < list.length; i++) {
    assert.ok(
      Number(list[i].number) >= Number(list[i - 1].number),
      `urutan asc di index ${i}`
    );
  }
  assert.ok(list.every((c) => c.slug), "semua punya slug");
}, { timeout: 60000 });

test("getChapterImages: 12 halaman + URL absolut + nav", async () => {
  const d = await getChapterImages(SERIES, CHAPTER);
  assert.equal(d.chapterSlug, CHAPTER);
  assert.equal(d.pages.length, 12, `12 halaman (dapat ${d.pages.length})`);
  assert.equal(d.pages[0].n, 1, "halaman pertama = 1");
  for (const p of d.pages) {
    assert.match(p.url, /^https:\/\//, "URL gambar absolut");
    assert.ok(p.url.length > 15, "URL bukan placeholder");
  }
  // nav
  assert.ok(d.prev && d.prev.slug, "prev chapter ada");
}, { timeout: 60000 });

test("download gambar halaman via curl: valid webp > 50KB", async () => {
  const d = await getChapterImages(SERIES, CHAPTER);
  const url = d.pages[0].url;
  const out = "/tmp/ainz_test_live.webp";
  const s = await new Promise((resolve, reject) => {
    const c = spawn("curl", ["-sS", "-m", "30", "-o", out, "-w", "%{http_code} %{size_download}",
      "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
      url]);
    let ss = "", e = "";
    c.stdout.on("data", (x) => (ss += x));
    c.stderr.on("data", (x) => (e += x));
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve(ss.trim()) : reject(new Error(e || "curl " + code))));
  });
  const [code, sizeStr] = s.split(" ");
  assert.equal(code, "200", "HTTP 200");
  const size = Number(sizeStr);
  assert.ok(size > 50000, `>50KB (dapat ${size})`);
  // magic bytes webp = RIFF....WEBP
  const fs = await import("node:fs");
  const buf = fs.readFileSync(out);
  assert.equal(buf.subarray(0, 4).toString(), "RIFF");
  assert.equal(buf.subarray(8, 12).toString(), "WEBP");
  console.log(`  [image] ${url.slice(0, 60)}... ${size} bytes RIFF/WEBP OK`);
}, { timeout: 90000 });
