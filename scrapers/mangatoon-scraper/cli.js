#!/usr/bin/env node
// CLI mangatoon-scraper — semua output JSON ke stdout.
import {
  LANGS, home, genres, browse, hot, updated, byTag, search, series,
  episodeImages, download, booklist, booklistDetail, sitemap, sitemapIndex, walk,
} from "./src/index.js";

const argv = process.argv.slice(2);
const cmd = (argv[0] || "").toLowerCase();
const pos = argv.slice(1).filter((a) => !a.startsWith("--"));

const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(`--${name}`);
const out = (o) => console.log(JSON.stringify(o, null, 2));

const lang = flag("lang", "en");
const page = Number(flag("page", 1));

const usage = `mangatoon-scraper CLI  (--lang ${LANGS.join("|")}, default en)

  home                          banner + semua section homepage
  genres                        25 genre (id+nama) + 3 opsi status
  browse [--genre ID] [--status 0|1|2] [--page N]
                                listing 18 item/halaman, has_next
  hot [--page N]                terpopuler
  updated [--page N]            baru update
  tag <TAG_ID> [--page N]       listing per tag (id dari series().tags)
  search <KATA>                 pencarian (situs TIDAK punya pagination)
  series <CONTENT_ID>           detail + SELURUH daftar episode
  episode <CONTENT_ID> <EP_ID>  URL gambar satu episode
  download <CONTENT_ID> <EP_ID> <DIR> [--limit N]
                                unduh gambar episode ke folder
  booklist [--page N]           booklist buatan pengguna
  booklist-detail <ID>          isi satu booklist
  sitemap                       seluruh katalog 1 request (per bahasa)
  sitemap-index                 daftar 11 sitemap
  walk-tag <TAG_ID> [--max N]   walk semua halaman tag, dedup

Contoh:
  node cli.js series 21
  node cli.js episode 21 517
  node cli.js download 21 517 /tmp/hunk --limit 3
  node cli.js browse --genre 9 --page 2
  node cli.js sitemap --lang id
`;

try {
  switch (cmd) {
    case "home":
      out(await home({ lang }));
      break;
    case "genres":
      out(await genres({ lang }));
      break;
    case "browse":
      out(await browse({
        lang, page,
        genre: Number(flag("genre", 0)),
        status: Number(flag("status", 0)),
      }));
      break;
    case "hot":
      out(await hot({ lang, page }));
      break;
    case "updated":
      out(await updated({ lang, page }));
      break;
    case "tag":
      if (!pos[0]) throw new Error("butuh tag id: tag <TAG_ID>");
      out(await byTag({ lang, tag: Number(pos[0]), page }));
      break;
    case "search":
      if (!pos.length) throw new Error("butuh kata kunci: search <KATA>");
      out(await search({ lang, word: pos.join(" ") }));
      break;
    case "series":
      if (!pos[0]) throw new Error("butuh content_id: series <CONTENT_ID>");
      out(await series({ lang, id: Number(pos[0]), slug: pos[1] || "detail" }));
      break;
    case "episode":
      if (!pos[1]) throw new Error("butuh 2 argumen: episode <CONTENT_ID> <EP_ID>");
      out(await episodeImages({ lang, contentId: Number(pos[0]), episodeId: Number(pos[1]) }));
      break;
    case "download": {
      const dir = pos[2] || flag("out", "");
      if (!pos[1] || !dir) {
        throw new Error("butuh: download <CONTENT_ID> <EP_ID> <DIR> (atau --out DIR)");
      }
      out(await download({
        lang,
        contentId: Number(pos[0]),
        episodeId: Number(pos[1]),
        dir,
        limit: Number(flag("limit", 0)),
      }));
      break;
    }
    case "booklist":
      out(await booklist({ lang, page }));
      break;
    case "booklist-detail":
    case "booklistdetail":
      if (!pos[0]) throw new Error("butuh booklist id");
      out(await booklistDetail({ lang, id: Number(pos[0]) }));
      break;
    case "sitemap":
      out(await sitemap({ lang }));
      break;
    case "sitemap-index":
    case "sitemapindex":
      out(await sitemapIndex());
      break;
    case "walk-tag":
    case "walktag": {
      if (!pos[0]) throw new Error("butuh tag id");
      const res = await walk(byTag, { lang, tag: Number(pos[0]) }, {
        maxPages: Number(flag("max", 200)),
      });
      out(res);
      break;
    }
    default:
      process.stdout.write(usage);
      process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
