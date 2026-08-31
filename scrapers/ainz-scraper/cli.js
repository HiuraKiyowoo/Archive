#!/usr/bin/env node
// Ainz Scans ID scraper CLI
//
// Contoh:
//   node cli.js search "leveling"
//   node cli.js browse --sort latest --type COMIC --comic-type MANHWA --genre action
//   node cli.js genres
//   node cli.js home
//   node cli.js series <slug>
//   node cli.js chapters <slug>
//   node cli.js chapter <slug> <chapter-slug>
//   node cli.js images <slug> <chapter-slug>
//   node cli.js download <slug> <chapter-slug> --out ./ch49
//   node cli.js download <slug> <chapter-slug> --first 3   # cuma 3 halaman pertama

import {
  search,
  browse,
  genres,
  homeSections,
  seriesDetail,
  chapterList,
  getChapterImages,
} from "./src/index.js";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);
const flag = (name, dflt = null) => {
  const i = rest.indexOf("--" + name);
  return i >= 0 ? rest[i + 1] : dflt;
};
const pos = (n) => rest.filter((a) => !a.startsWith("--")).slice(0, 99)[n];
const bool = (name) => rest.includes("--" + name);

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function row(it) {
  const sub = (it.comic_subtype || it.type || "").padEnd(7);
  const rt = String(it.rating_average ?? "-").padStart(5);
  const upd = (it.updated_at || "").slice(0, 10);
  return `${sub} ${rt}  ${it.title}  [${it.slug}]  upd:${upd}`;
}

// download satu URL via curl (transport aman, referer/UA bener)
function curlDownload(url, outPath) {
  return new Promise((resolve, reject) => {
    const c = spawn(
      "curl",
      ["-sS", "-L", "-m", "60", "-o", outPath, "-w", "%{http_code} %{size_download}",
        "-A", UA, "-e", "https://v3.ainzscans01.com/", url],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let s = "", e = "";
    c.stdout.on("data", (x) => (s += x));
    c.stderr.on("data", (x) => (e += x));
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve(s.trim()) : reject(new Error(e || `curl exit ${code}`))));
  });
}

function extFromUrl(u) {
  const m = u.split("?")[0].match(/\.(webp|jpe?g|png)$/i);
  return m ? m[1].toLowerCase() : "webp";
}

try {
  switch (cmd) {
    case "search": {
      const q = pos(0);
      if (!q) die("pakai: search <query> [--page N] [--limit N]");
      const r = await search(q, {
        page: Number(flag("page", 1)),
        limit: flag("limit") ? Number(flag("limit")) : undefined,
        sort: flag("sort"), type: flag("type"),
        comic_type: flag("comic-type"), genre: flag("genre"), status: flag("status"),
      });
      console.log(`total=${r.total} pages=${r.total_pages} page=${r.page} (tampilkan ${r.items.length})`);
      for (const it of r.items) console.log(row(it));
      break;
    }
    case "browse": {
      const r = await browse({
        page: Number(flag("page", 1)),
        limit: flag("limit") ? Number(flag("limit")) : 20,
        sort: flag("sort", "popular"),
        type: flag("type"),
        comic_type: flag("comic-type"),
        genre: flag("genre"),
        status: flag("status"),
      });
      console.log(`browse sort=${flag("sort", "popular")} total=${r.total} pages=${r.total_pages} page=${r.page}`);
      for (const it of r.items) console.log(row(it));
      break;
    }
    case "genres": {
      const g = await genres();
      for (const it of g) console.log(`  ${it.slug.padEnd(20)} ${it.name}`);
      break;
    }
    case "home": {
      const h = await homeSections();
      for (const k of ["hot_weekly", "popular_daily", "latest_projects"]) {
        console.log(`\n## ${k} (${h[k]?.length})`);
        for (const it of h[k] ?? []) {
          const s = it.series_slug ?? it.slug;
          console.log(`  ${(it.series_title ?? it.title ?? "")}  [${s}]`);
        }
      }
      console.log(`\n## latest_comic_updates (${h.latest_comic_updates?.length})`);
      for (const it of (h.latest_comic_updates ?? []).slice(0, 10)) {
        const ch = it.chapters?.map((c) => c.slug).join(", ");
        console.log(`  ${it.series_title}  -> ${ch}`);
      }
      break;
    }
    case "series": {
      const slug = pos(0);
      if (!slug) die("pakai: series <slug>");
      const d = await seriesDetail(slug);
      console.log(JSON.stringify(
        {
          title: d.title, slug: d.slug, subtype: d.comic_subtype, status: d.series_status,
          rating: d.rating_average, followers: d.followers_count, views: d.view_count,
          synopsis: (d.synopsis || "").slice(0, 120),
          genres: (d.genres ?? []).map((g) => g.name),
          chapters: (d.units ?? []).length, poster: d.poster_image_url,
        }, null, 2
      ));
      break;
    }
    case "chapters": {
      const slug = pos(0);
      if (!slug) die("pakai: chapters <slug>");
      const list = await chapterList(slug);
      console.log(`${list.length} chapters (asc):`);
      for (const c of list) {
        console.log(`  ${String(c.number).padStart(6)}  ${c.slug}${c.is_premium ? " [PREMIUM]" : ""}${c.is_locked ? " [LOCKED]" : ""}  ${c.title}`);
      }
      break;
    }
    case "chapter": {
      const slug = pos(0), ch = pos(1);
      if (!slug || !ch) die("pakai: chapter <series-slug> <chapter-slug>");
      const d = await getChapterImages(slug, ch);
      console.log(JSON.stringify(
        { series: d.series, chapter: d.chapter, number: d.number, pages: d.pages.length, first: d.pages[0], prev: d.prev, next: d.next },
        null, 2
      ));
      break;
    }
    case "images": {
      const slug = pos(0), ch = pos(1);
      if (!slug || !ch) die("pakai: images <series-slug> <chapter-slug>");
      const d = await getChapterImages(slug, ch);
      for (const p of d.pages) console.log(`${String(p.n).padStart(3)}  ${p.url}`);
      break;
    }
    case "download": {
      const slug = pos(0), ch = pos(1);
      if (!slug || !ch) die("pakai: download <series-slug> <chapter-slug> [--out DIR] [--first N]");
      const out = flag("out", "./ainz_dl");
      const first = flag("first") ? Number(flag("first")) : Infinity;
      const d = await getChapterImages(slug, ch);
      await mkdir(out, { recursive: true });
      const pages = d.pages.slice(0, first);
      let ok = 0, fail = 0;
      for (const p of pages) {
        const safe = String(p.n).padStart(3, "0");
        const fp = path.join(out, `${safe}.${extFromUrl(p.url)}`);
        try {
          const w = await curlDownload(p.url, fp);
          const [code, size] = w.split(" ");
          if (code === "200" && Number(size) > 1000) { ok++; }
          else { fail++; console.error(`  [skip] p${p.n} HTTP ${code} ${size}b`); }
        } catch (e) { fail++; console.error(`  [err] p${p.n} ${e.message}`); }
        process.stdout.write(`\r  ${ok + fail}/${pages.length}  `);
      }
      console.log(`\nSELESAI: ${ok} ok, ${fail} gagal -> ${out}`);
      break;
    }
    case "help":
    default:
      console.log(`ainz-scraper — Ainz Scans ID (v3.ainzscans01.com)
  search <query> [--page N] [--limit N] [--sort S] [--type T]
                  [--comic-type CT] [--genre G] [--status S]
  browse [--sort popular|latest|rating|views] [--type COMIC|ANIME|NOVEL]
         [--comic-type MANHUA|MANHWA|MANGA] [--genre G] [--status S]
         [--page N] [--limit N]
  genres                                daftar genre (slug)
  home                                  home sections + slug chapter terbaru
  series <slug>                         detail series
  chapters <slug>                       daftar chapter (asc)
  chapter <slug> <chapter-slug>         detail chapter (jumlah halaman + nav)
  images <slug> <chapter-slug>          list URL gambar tiap halaman
  download <slug> <chapter-slug> [--out DIR] [--first N]
                                        unduh gambar chapter (curl)`);
  }
} catch (e) {
  die("ERROR: " + (e?.message || e));
}
