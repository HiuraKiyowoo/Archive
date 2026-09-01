#!/usr/bin/env node
// CLI okyykomik-scraper. Output selalu JSON ke stdout; error JSON ke stderr exit 1.

import {
  latest, latestChapters, seriesList, seriesDetail, chapter, chapterImages,
  search, labels, byLabel, stats, sitemap, walkSeries,
} from "./src/index.js";

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter((a) => !a.startsWith("--"));
const flags = {};
for (const a of argv.slice(1)) {
  if (!a.startsWith("--")) continue;
  const [k, v] = a.slice(2).split("=");
  flags[k] = v === undefined ? true : v;
}
const num = (v, d) => (v === undefined ? d : Number(v));
// Limit boleh lewat posisi (`latest 10`) atau flag (`latest --limit=10`).
const lim = (d) => num(pos.find((p) => /^\d+$/.test(p)) ?? flags.limit, d);

const USAGE = `okyykomik-scraper — scraper www.okyykomik.my.id (Blogger feed API)

Pemakaian: node cli.js <perintah> [argumen] [--opsi=nilai]

  latest [n]                    post terbaru (series + chapter campur)
  chapters [n]                  chapter terbaru saja
  series [n] [--status=Ongoing] [--type=Manga] [--country=JP] [--genre=Romance]
                                katalog series (41 judul)
  detail <judul|label|slug>     detail series + seluruh chapter
  chapter <slug|id|judul>       satu chapter: gambar + nav prev/next
  images <slug|id|judul>        hanya URL gambar chapter
  search <kata> [n]             cari post (feed q=)
  labels                        semua label dikelompokkan
  label <nama> [n]              post ber-label tertentu
  stats                         statistik blog
  sitemap                       semua URL post dari sitemap.xml
  walk [n]                      susuri n series + hitung chapter

Contoh:
  node cli.js latest 10
  node cli.js series 20 --type=Manhwa --status=Ongoing
  node cli.js detail "Villain Classroom"
  node cli.js chapter villain-classroom-chapter-27
  node cli.js search regressor
`;

function keluar(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

try {
  let hasil;
  switch (cmd) {
    case "latest":
      hasil = await latest({ limit: lim(20) });
      break;
    case "chapters":
      hasil = await latestChapters({ limit: lim(20) });
      break;
    case "series":
      hasil = await seriesList({
        limit: lim(Infinity),
        status: flags.status,
        type: flags.type,
        country: flags.country,
        genre: flags.genre,
      });
      break;
    case "detail":
      if (!pos[0]) throw new TypeError("detail butuh judul/label/slug series");
      hasil = await seriesDetail(pos.join(" "));
      break;
    case "chapter":
      if (!pos[0]) throw new TypeError("chapter butuh slug/id/judul");
      hasil = await chapter(pos.join(" "));
      break;
    case "images":
      if (!pos[0]) throw new TypeError("images butuh slug/id/judul");
      hasil = await chapterImages(pos.join(" "));
      break;
    case "search":
      if (!pos[0]) throw new TypeError("search butuh kata kunci");
      hasil = await search(pos.filter((p) => !/^\d+$/.test(p)).join(" ") || pos[0], {
        limit: lim(25),
      });
      break;
    case "labels":
      hasil = await labels();
      break;
    case "label":
      if (!pos[0]) throw new TypeError("label butuh nama label");
      hasil = await byLabel(pos.filter((p) => !/^\d+$/.test(p)).join(" "), {
        limit: lim(50),
      });
      break;
    case "stats":
      hasil = await stats();
      break;
    case "sitemap":
      hasil = await sitemap();
      break;
    case "walk":
      hasil = await walkSeries({ limit: lim(5) });
      break;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      process.exit(0);
      break;
    default:
      throw new TypeError(`perintah tidak dikenal: ${cmd}`);
  }
  keluar(hasil);
} catch (e) {
  process.stderr.write(JSON.stringify({
    ok: false,
    error: e.name || "Error",
    message: e.message,
    status: e.status ?? null,
    url: e.url ?? null,
  }, null, 2) + "\n");
  process.exit(1);
}
