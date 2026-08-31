#!/usr/bin/env node
// kanzenin.info scraper CLI
//
// Contoh:
//   node cli.js search "love"
//   node cli.js search "love" --page 2
//   node cli.js az A
//   node cli.js az 0-9 --page 2
//   node cli.js genres
//   node cli.js genre romance --page 3
//   node cli.js series rooftop-sex-king
//   node cli.js images rooftop-sex-king-chapter-78
//   node cli.js download torokeru-tsuma-chichi-chapter-2 --out ./ch2 --first 3

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
      if (!q) throw new Error("pakai: search <query> [--page N]");
      out(await search(q, { page: Number(flag(args, "page", 1)) }));
      break;
    }
    case "az": {
      const l = args.find((a) => !a.startsWith("--")) || "A";
      out(await azList(l, { page: Number(flag(args, "page", 1)) }));
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
      const slug = args.find((a) => !a.startsWith("--"));
      if (!slug) throw new Error("pakai: genre <slug> [--page N]");
      out(await byGenre(slug, { page: Number(flag(args, "page", 1)) }));
      break;
    }
    case "series": {
      const slug = args.find((a) => !a.startsWith("--"));
      if (!slug) throw new Error("pakai: series <slug>");
      out(await series(slug));
      break;
    }
    case "images": {
      const slug = args.find((a) => !a.startsWith("--"));
      if (!slug) throw new Error("pakai: images <chapter-slug|url>");
      out(await chapterImages(slug));
      break;
    }
    case "download": {
      const slug = args.find((a) => !a.startsWith("--"));
      const outDir = flag(args, "out", "./download");
      if (!slug) throw new Error("pakai: download <chapter-slug|url> --out <dir>");
      out(await downloadChapter(slug, outDir, { first: flag(args, "first") ? Number(flag(args, "first")) : undefined }));
      break;
    }
    default:
      console.log(`kanzenin.info scraper — perintah:
  search <query> [--page N]          cari doujin (10/page)
  az <huruf|0-9|.\> [--page N]       A-Z list
  all [--letters A,B]                semua series
  genres                             daftar genre
  genre <slug> [--page N]            series per genre
  series <slug>                      detail + daftar chapter
  images <chapter-slug>              list URL gambar
  download <chapter-slug> --out <dir> [--first N]`);
  }
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
