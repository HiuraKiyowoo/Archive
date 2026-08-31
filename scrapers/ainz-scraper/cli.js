#!/usr/bin/env node
// Ainz Scans ID scraper CLI
// Contoh:
//   node cli.js search "leveling" --page 1
//   node cli.js home
//   node cli.js series <slug>
//   node cli.js chapters <slug>
//   node cli.js chapter <slug> <chapter-slug>
//   node cli.js images <slug> <chapter-slug>

import {
  search,
  homeSections,
  seriesDetail,
  chapterList,
  getChapterImages,
} from "./src/index.js";

const [cmd, ...args] = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const pos = (n) => args[n];

function die(msg) {
  console.error(msg);
  process.exit(1);
}

try {
  switch (cmd) {
    case "search": {
      const q = pos(0);
      if (!q) die("pakai: search <query> [--page N]");
      const r = await search(q, { page: Number(flag("page", 1)) });
      console.log(`total=${r.total} pages=${r.total_pages} page=${r.page}`);
      for (const it of r.items) {
        console.log(
          `${it.comic_subtype?.padEnd(7)} ${it.rating_average?.padStart(5)}  ${it.title}  [${it.slug}]  upd:${(it.updated_at || "").slice(0, 10)}`
        );
      }
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
          title: d.title,
          slug: d.slug,
          subtype: d.comic_subtype,
          status: d.series_status,
          rating: d.rating_average,
          followers: d.followers_count,
          views: d.view_count,
          synopsis: (d.synopsis || "").slice(0, 120),
          genres: (d.genres ?? []).map((g) => g.name),
          chapters: (d.units ?? []).length,
          poster: d.poster_image_url,
        },
        null, 2
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
    case "help":
    default:
      console.log(`ainz-scraper — Ainz Scans ID (v3.ainzscans01.com)
  search <query> [--page N]      cari comic
  home                            home sections (hot/popular/latest + chapter slugs)
  series <slug>                   detail series
  chapters <slug>                 daftar chapter (asc)
  chapter <slug> <chapter-slug>   detail chapter (jumlah halaman + nav)
  images <slug> <chapter-slug>    list URL gambar halaman`);
  }
} catch (e) {
  die("ERROR: " + (e?.message || e));
}
