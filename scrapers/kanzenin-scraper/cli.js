#!/usr/bin/env node
// kanzenin.info scraper CLI
//
// Contoh:
//   node cli.js home
//   node cli.js feed
//   node cli.js project
//   node cli.js search "love" --page 2
//   node cli.js browse --order popular --type manhwa --status ongoing --page 2
//   node cli.js browse --genre 5,64
//   node cli.js list-mode
//   node cli.js az A --page 2
//   node cli.js all --letters A,B
//   node cli.js genres
//   node cli.js genre romance --page 3
//   node cli.js series rooftop-sex-king
//   node cli.js images rooftop-sex-king-chapter-78
//   node cli.js download rooftop-sex-king-chapter-78 --out ./ch78 [--first 3]

import {
  search,
  azList,
  allSeries,
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
  downloadChapter,
} from "./src/index.js";

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter((a) => !a.startsWith("--"));
const flag = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const out = (o) => console.log(JSON.stringify(o, null, 2));

const usage = `kanzenin-scraper CLI

  home                              4 section homepage + rilis chapter terbaru
  feed                              RSS: 10 rilis terakhir (+timestamp ISO)
  project                           series garapan sendiri tim kanzenin
  search <query> [--page N]         cari (10/page)
  browse [filter]                   directory /manga/ (27/page)
      --genre <id,id>               ID genre (dari 'genres'), semantik AND
      --status ongoing|completed|hiatus
      --type manga|manhwa|manhua|comic|novel
      --order title|titlereverse|update|latest|popular
      --page N
  list-mode                         SELURUH katalog dalam 1 request (+post_id)
  az <letter> [--page N]            A-Z list (A..Z, 0-9, .)
  all [--letters A,B]               semua series via az-list
  genres                            44 genre (id + slug + nama)
  genre <slug> [--page N]           series per genre (via /genres/<slug>/)
  series <slug>                     detail + chapter list (dedup)
  images <chapter-slug>             URL gambar chapter
  download <chapter-slug> --out DIR [--first N]
  slug <series-slug> <number>       bikin slug chapter (67.5 -> chapter-67-5)`;

try {
  switch (cmd) {
    case "home": {
      const h = await home();
      out({
        sections: Object.fromEntries(
          Object.entries(h.sections).map(([k, v]) => [k, { count: v.length, items: v }])
        ),
        latest_chapters: h.latest_chapters,
      });
      break;
    }
    case "feed":
      out(await feed());
      break;
    case "project":
      out(await project());
      break;
    case "search": {
      if (!pos[0]) throw new Error("butuh query");
      out(await search(pos[0], { page: Number(flag("page", 1)) }));
      break;
    }
    case "browse": {
      const gen = flag("genre");
      out(
        await browse({
          genre: gen ? gen.split(",").map((x) => x.trim()).filter(Boolean) : [],
          status: flag("status", ""),
          type: flag("type", ""),
          order: flag("order", ""),
          page: Number(flag("page", 1)),
        })
      );
      break;
    }
    case "list-mode":
    case "listmode": {
      const lm = await listMode();
      out({ total: lm.total, letters: lm.letters, items: lm.items });
      break;
    }
    case "az":
      out(await azList(pos[0] || "A", { page: Number(flag("page", 1)) }));
      break;
    case "all": {
      const l = flag("letters");
      out(await allSeries(l ? { letters: l.split(",") } : {}));
      break;
    }
    case "genres":
      out(await genres());
      break;
    case "genre": {
      if (!pos[0]) throw new Error("butuh slug genre");
      out(await byGenre(pos[0], { page: Number(flag("page", 1)) }));
      break;
    }
    case "series": {
      if (!pos[0]) throw new Error("butuh slug series");
      out(await series(pos[0]));
      break;
    }
    case "images": {
      if (!pos[0]) throw new Error("butuh slug chapter");
      out(await chapterImages(pos[0]));
      break;
    }
    case "download": {
      if (!pos[0]) throw new Error("butuh slug chapter");
      // dir bisa dari --out DIR atau argumen posisi ke-2
      const dir = flag("out") || pos[1];
      if (!dir) throw new Error("butuh folder tujuan: download <slug> <dir> atau --out DIR");
      const first = flag("first");
      out(await downloadChapter(pos[0], dir, first ? { first: Number(first) } : {}));
      break;
    }
    case "slug": {
      if (!pos[0] || !pos[1]) throw new Error("butuh <series-slug> <number>");
      console.log(chapterSlug(pos[0], pos[1]));
      break;
    }
    default:
      console.log(usage);
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error("ERROR:", e.message + (e.status ? ` (HTTP ${e.status})` : ""));
  process.exit(1);
}
