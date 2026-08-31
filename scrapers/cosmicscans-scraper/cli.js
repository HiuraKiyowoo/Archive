#!/usr/bin/env node
// CLI cosmicscans-scraper. Output selalu JSON ke stdout; error ke stderr exit 1.

import {
  latest, heroSlider, popularToday, latestProject, projectAll, allComics,
  filter, textMode, search, seriesDetail, related, chapter, chapterImages,
  settings, announcements, walk,
} from "./src/index.js";

const USAGE = `Pemakaian: node cli.js <perintah> [argumen]

Listing:
  latest [limit]                     update chapter terbaru
  hero [limit]                       slider homepage
  popular [limit]                    populer hari ini
  projects [limit]                   update project
  project-all [limit]                semua project
  comics [limit]                     katalog All Comics
  filter [limit] [--order=update|popular|az|za] [--status=Ongoing]
                 [--type=Manhwa] [--genres=action,comedy] [--project]
  textmode [--order=az] [--status=] [--type=] [--genres=]
                                     SELURUH judul per abjad (tanpa cursor)
  search <kata>                      cari judul

Detail:
  series <slug>                      detail + semua chapter
  related <slug> [limit]             series terkait
  chapter <slug-chapter>             halaman baca (gambar + navigasi)
  images <slug-chapter>              hanya URL gambar

Ekstra:
  settings [general|homepage|menu|ads]
  announcements [limit]
  walk [pages] [limit] [--kind=filter|allComics|latest|projectAll|popularToday]

Contoh:
  node cli.js filter 10 --order=popular --type=Manhwa
  node cli.js series lookism
  node cli.js images lookism-chapter-622
`;

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter((a) => !a.startsWith("--"));
const flags = {};
for (const a of argv.slice(1)) {
  if (!a.startsWith("--")) continue;
  const [k, v] = a.replace(/^--/, "").split("=");
  flags[k] = v === undefined ? true : v;
}

const num = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const filterOpts = () => ({
  order: flags.order ?? "update",
  status: flags.status ?? null,
  type: flags.type ?? null,
  genres: flags.genres ? String(flags.genres).split(",") : [],
  project: flags.project === true || flags.project === "true",
});

async function run() {
  switch (cmd) {
    case "latest":        return latest({ limit: num(pos[0], 20) });
    case "hero":          return heroSlider({ limit: num(pos[0], 5) });
    case "popular":       return popularToday({ limit: num(pos[0], 15) });
    case "projects":      return latestProject({ limit: num(pos[0], 18) });
    case "project-all":   return projectAll({ limit: num(pos[0], 20) });
    case "comics":        return allComics({ limit: num(pos[0], 20) });
    case "filter":        return filter({ limit: num(pos[0], 20), ...filterOpts() });
    case "textmode":      return textMode({ order: flags.order ?? "az", status: flags.status ?? null, type: flags.type ?? null, genres: flags.genres ? String(flags.genres).split(",") : [] });
    case "search":
      if (!pos[0]) throw new Error("search butuh kata kunci");
      return search(pos.join(" "));
    case "series":
      if (!pos[0]) throw new Error("series butuh slug");
      return seriesDetail(pos[0]);
    case "related":
      if (!pos[0]) throw new Error("related butuh slug");
      return related(pos[0], { limit: num(pos[1], 10) });
    case "chapter":
      if (!pos[0]) throw new Error("chapter butuh slug chapter");
      return chapter(pos[0]);
    case "images":
      if (!pos[0]) throw new Error("images butuh slug chapter");
      return chapterImages(pos[0]);
    case "settings":      return settings(pos[0] ?? "general");
    case "announcements": return announcements({ limit: num(pos[0], 20) });
    case "walk":
      return walk({ pages: num(pos[0], 2), limit: num(pos[1], 20), kind: flags.kind ?? "filter", ...filterOpts() });
    default:
      process.stdout.write(USAGE);
      process.exit(0);
  }
}

run()
  .then((out) => process.stdout.write(JSON.stringify(out, null, 2) + "\n"))
  .catch((err) => {
    process.stderr.write(
      JSON.stringify({ ok: false, error: err.name || "Error", message: err.message, status: err.status ?? null, url: err.url ?? null }, null, 2) + "\n",
    );
    process.exit(1);
  });
