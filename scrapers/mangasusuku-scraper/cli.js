#!/usr/bin/env node
// Mangasusu scraper CLI
//
// Contoh:
//   node cli.js search "leveling"
//   node cli.js az A
//   node cli.js genres
//   node cli.js genre romance --page 2
//   node cli.js series solo-leveling
//   node cli.js images solo-leveling-chapter-155
//   node cli.js download solo-leveling-chapter-155 --out ./ch155 --first 3

import {
  search,
  azList,
  allSeries,
  genres,
  byGenre,
  series,
  chapterImages,
  downloadChapter,
} from "./src/index.js";

const [cmd, ...args] = process.argv.slice(2);

function flag(args, name, def = null) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) {
    const v = args[i + 1];
    if (v !== undefined && !v.startsWith("--")) return v;
  }
  return def;
}

const out = (x) => console.log(JSON.stringify(x, null, 2));

try {
  switch (cmd) {
    case "search": {
      const q = args.find((a) => !a.startsWith("--"));
      if (!q) throw new Error("pakai: search <query>");
      out(await search(q));
      break;
    }
    case "az": {
      const l = args[0] || "A";
      out(await azList(l));
      break;
    }
    case "all": {
      const letters = flag(args, "letters")?.split(",");
      out(await allSeries({ letters }));
      break;
    }
    case "genres": {
      out(await genres());
      break;
    }
    case "genre": {
      const slug = args[0];
      if (!slug) throw new Error("pakai: genre <slug> [--page N]");
      out(await byGenre(slug, { page: Number(flag(args, "page", 1)) }));
      break;
    }
    case "series": {
      const slug = args[0];
      if (!slug) throw new Error("pakai: series <slug>");
      out(await series(slug));
      break;
    }
    case "images": {
      const slug = args[0];
      if (!slug) throw new Error("pakai: images <chapter-slug|url>");
      out(await chapterImages(slug));
      break;
    }
    case "download": {
      const slug = args[0];
      const outDir = flag(args, "out", "./download");
      if (!slug) throw new Error("pakai: download <chapter-slug|url> --out <dir>");
      out(await downloadChapter(slug, outDir, { first: flag(args, "first") ? Number(flag(args, "first")) : undefined }));
      break;
    }
    default:
      console.log(`Mangasusu scraper — perintah:
  search <query>                 cari manga
  az <huruf|0-9|.\">              AZ list
  all [--letters A,B]            semua series
  genres                         daftar genre
  genre <slug> [--page N]        series per genre
  series <slug>                  detail + daftar chapter
  images <chapter-slug>          list URL gambar
  download <chapter-slug> --out <dir> [--first N]`);
  }
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
