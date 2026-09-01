#!/usr/bin/env node
// CLI moviezone-scraper. Semua output JSON ke stdout, pesan status ke stderr.
import {
  getHero,
  getTrending,
  getPopular,
  getTopRated,
  getLatest,
  getUpcoming,
  getGenres,
  discover,
  search,
  getDetail,
  getEpisodes,
  getSemuaEpisode,
  ambilHalaman,
  GENRE_SLUG,
  MAX_PAGE,
} from "./src/index.js";

const BANTUAN = `moviezone-scraper — moviezone.web.id (API internal Next.js, data TMDB)

Pemakaian:
  node cli.js <perintah> [opsi]

Perintah:
  hero                          6 judul slider depan (tanpa paginasi)
  trending                      trending pekan ini (movie + series campur)
  popular                       terpopuler
  top-rated                     rating tertinggi
  latest                        rilisan terbaru
  upcoming                      akan datang (film saja, katalog pendek)
  genres                        daftar genre + ID TMDB
  discover --genre <slug|id>    telusuri per genre
  search --q <kata>             cari judul
  detail <slug>                 detail movie-<id> / tv-<id>
  episodes <slug> [--season N]  episode satu season
  all-episodes <slug>           semua episode semua season

Opsi:
  --type movie|tv|all           default movie (hero/trending/upcoming: diabaikan)
  --page N                      halaman (1..${MAX_PAGE})
  --pages N                     ambil N halaman berurutan + dedupe
  --season N                    nomor season (default 1)
  --specials                    ikutkan season 0 di all-episodes
  --pretty                      JSON berindentasi
  --help                        tampilkan ini

Genre slug: ${Object.keys(GENRE_SLUG).join(", ")}
Genre khusus serial (mis. 10759) kirim ID angkanya, lihat perintah genres.

Contoh:
  node cli.js trending --pretty
  node cli.js popular --type tv --pages 3
  node cli.js discover --genre horror --page 2
  node cli.js search --q "spider" --pretty
  node cli.js detail movie-860508
  node cli.js all-episodes tv-108978
`;

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const nama = a.slice(2);
    const next = argv[i + 1];
    if (nama === "pretty" || nama === "help" || nama === "specials") {
      out.flags[nama] = true;
    } else if (next === undefined || next.startsWith("--")) {
      out.flags[nama] = true;
    } else {
      out.flags[nama] = next;
      i += 1;
    }
  }
  return out;
}

function angka(v, nama) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new TypeError(`--${nama} harus bilangan bulat (dapat: ${v})`);
  return n;
}

async function main() {
  const { _: pos, flags } = parseArgs(process.argv.slice(2));
  const perintah = pos[0];

  if (!perintah || flags.help) {
    process.stdout.write(BANTUAN);
    return;
  }

  const page = angka(flags.page, "page") ?? 1;
  const pages = angka(flags.pages, "pages");
  const type = typeof flags.type === "string" ? flags.type : undefined;

  // Kalau --pages dipakai, jalankan lewat ambilHalaman (dedupe antar halaman).
  const jalan = async (fn, opsi = {}) => {
    if (pages && pages > 1) {
      return ambilHalaman(fn, { ...opsi, mulai: page, jumlahHalaman: pages });
    }
    return fn({ ...opsi, page });
  };

  let hasil;
  switch (perintah) {
    case "hero":
      hasil = await getHero();
      break;
    case "trending":
      hasil = await jalan(getTrending);
      break;
    case "popular":
      hasil = await jalan(getPopular, { type: type ?? "movie" });
      break;
    case "top-rated":
      hasil = await jalan(getTopRated, { type: type ?? "movie" });
      break;
    case "latest":
      hasil = await jalan(getLatest, { type: type ?? "movie" });
      break;
    case "upcoming":
      hasil = await jalan(getUpcoming);
      break;
    case "genres":
      hasil = await getGenres();
      break;
    case "discover": {
      if (!flags.genre || flags.genre === true) {
        throw new TypeError("discover butuh --genre <slug|id>. Lihat: node cli.js genres");
      }
      hasil = await jalan(discover, { genre: flags.genre, type: type ?? "movie" });
      break;
    }
    case "search": {
      const q = typeof flags.q === "string" ? flags.q : pos[1];
      if (!q) throw new TypeError('search butuh --q "kata kunci"');
      hasil = await jalan(search, { q });
      break;
    }
    case "detail":
      if (!pos[1]) throw new TypeError("detail butuh slug, contoh: detail movie-860508");
      hasil = await getDetail(pos[1]);
      break;
    case "episodes":
      if (!pos[1]) throw new TypeError("episodes butuh slug tv-*, contoh: episodes tv-108978");
      hasil = await getEpisodes(pos[1], angka(flags.season, "season") ?? 1);
      break;
    case "all-episodes":
      if (!pos[1]) throw new TypeError("all-episodes butuh slug tv-*");
      hasil = await getSemuaEpisode(pos[1], { sertakanSpecials: Boolean(flags.specials) });
      break;
    default:
      process.stderr.write(`Perintah tidak dikenal: ${perintah}\n\n`);
      process.stdout.write(BANTUAN);
      process.exitCode = 2;
      return;
  }

  process.stdout.write(`${JSON.stringify(hasil, null, flags.pretty ? 2 : 0)}\n`);
}

main().catch((e) => {
  process.stderr.write(`GAGAL: ${e.name}: ${e.message}\n`);
  process.exitCode = 1;
});
