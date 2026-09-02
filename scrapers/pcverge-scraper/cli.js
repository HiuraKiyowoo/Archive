#!/usr/bin/env node
// CLI pcverge-scraper. JSON ke stdout, status/pesan ke stderr — jadi aman dipipe
// ke `jq` atau disimpan ke file.
//
// PERINGATAN: katalog pcverge.com memuat konten dewasa. Perintah apa pun bisa
// mengembalikan judul/poster dewasa tanpa pemberitahuan. Lihat README.

import {
  route,
  daftar,
  getFilm,
  getSerial,
  getEpisode,
  getBlog,
  getTerm,
  getGenre,
  filter,
  filterBySlug,
  cari,
  cariSemua,
  getBySlug,
  getById,
  getDetail,
  getDetailHtml,
  getPlayer,
  getSemuaPlayer,
  semuaEpisode,
  TAKSONOMI,
  POST_TYPE,
  ApiError,
  HttpError,
} from "./src/index.js";

const argv = process.argv.slice(2);
const perintah = argv[0];

/** Ambil `--flag nilai` / `--flag=nilai`; `--flag` sendiri = true. */
function opsi(nama, bawaan = undefined) {
  const i = argv.findIndex((a) => a === `--${nama}` || a.startsWith(`--${nama}=`));
  if (i < 0) return bawaan;
  const a = argv[i];
  if (a.includes("=")) return a.slice(a.indexOf("=") + 1);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) return true;
  return next;
}

/** Argumen posisional (bukan flag, bukan nilai flag). */
function posisi() {
  const out = [];
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (!a.includes("=")) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) i += 1;
      }
      continue;
    }
    out.push(a);
  }
  return out;
}

const num = (v, bawaan) => {
  if (v === undefined || v === true) return bawaan;
  const n = Number(v);
  return Number.isFinite(n) ? n : bawaan;
};

const opsiDaftar = () => ({
  page: num(opsi("halaman", opsi("page")), 1),
  perPage: num(opsi("perPage", opsi("per-page")), 20),
  orderby: opsi("orderby") === true ? undefined : opsi("orderby"),
  order: opsi("order") === true ? undefined : opsi("order"),
});

const tulis = (data) => process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);

const BANTUAN = `pcverge-scraper — scraper pcverge.com (WordPress REST + admin-ajax + HTML)

PERINGATAN ISI: katalog upstream mencampur film umum dengan konten DEWASA
(kategori film-semi dan sejenisnya). Keluaran perintah mana pun bisa memuat
judul/poster dewasa. Scraper ini tidak memfilter apa pun.

Pemakaian: node cli.js <perintah> [argumen] [--flag nilai]

  route                                  Peta endpoint, post type, taksonomi, batas
  film [--halaman N] [--perPage N]       Daftar film (post type posts, 9.878 item)
  serial [--halaman N] [--perPage N]     Daftar serial (tv, 1.368 item)
  episode [--halaman N] [--perPage N]    Episode terbaru (episode, 13.776 item)
  blog                                   Post type blogs (praktis kosong, 1 item)
  daftar <tipe>                          movie | tv | episode | blog

  detail <slug> [--tipe movie|tv|episode] [--no-player] [--maksTab N]
                                         REST + HTML + semua server player
  html <url|slug>                        Hanya bagian HTML (rating/durasi/download)
  slug <slug> [--tipe ...]               Item mentah dari REST saja
  id <angka> [--tipe ...]                Item berdasarkan id REST

  player <postId> [--tab N]              Satu tab player lewat admin-ajax
  semua-player <postId> [--maksTab N]    Semua tab player (default 5)

  genre [--perPage N]                    Daftar genre (taksonomi categories)
  term <nama> [--perPage N] [--cari teks]  Daftar term satu taksonomi
  taksonomi                              Daftar nama taksonomi yang tersedia
  filter <tipe> <taksonomi> <slug>       Filter via slug term (resolusi id otomatis)
  filter-id <tipe> <taksonomi> <id>      Filter via id term langsung

  cari <kueri> [--tipe ...]              Cari di satu post type
  cari-semua <kueri>                     Cari lintas post type (/wp/v2/search)
  all-episode <slugSerial> [--batas N]   Semua episode serial + player tiap episode

Taksonomi: ${Object.keys(TAKSONOMI).join(", ")}
Tipe: ${Object.keys(POST_TYPE).join(", ")}
`;

async function main() {
  const p = posisi();

  switch (perintah) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(BANTUAN);
      return;

    case "route":
      tulis(route());
      return;

    case "taksonomi":
      tulis(
        Object.fromEntries(
          Object.entries(TAKSONOMI).map(([k, v]) => [
            k,
            { rest: v.rest, urlArsip: `/${v.url}/`, untuk: v.untuk, perkiraanJumlahTerm: v.jumlah },
          ]),
        ),
      );
      return;

    case "film":
      tulis(await getFilm(opsiDaftar()));
      return;
    case "serial":
      tulis(await getSerial(opsiDaftar()));
      return;
    case "episode":
      tulis(await getEpisode(opsiDaftar()));
      return;
    case "blog":
      tulis(await getBlog(opsiDaftar()));
      return;
    case "daftar":
      if (!p[0]) throw new TypeError("butuh <tipe>: movie | tv | episode | blog");
      tulis(await daftar(p[0], opsiDaftar()));
      return;

    case "detail": {
      if (!p[0]) throw new TypeError("butuh <slug>");
      const tipe = opsi("tipe", "movie");
      const noPlayer = opsi("no-player", false) !== false;
      tulis(
        await getDetail(p[0], tipe === true ? "movie" : tipe, {
          player: !noPlayer,
          maksTab: num(opsi("maksTab"), 5),
        }),
      );
      return;
    }

    case "html": {
      if (!p[0]) throw new TypeError("butuh <url atau slug>");
      const target = p[0].startsWith("http") ? p[0] : `https://pcverge.com/${p[0].replace(/^\/+/, "")}/`;
      tulis(await getDetailHtml(target));
      return;
    }

    case "slug": {
      if (!p[0]) throw new TypeError("butuh <slug>");
      const tipe = opsi("tipe", "movie");
      const hasil = await getBySlug(p[0], tipe === true ? "movie" : tipe);
      if (!hasil) {
        process.stderr.write(`tidak ada item dengan slug "${p[0]}"\n`);
        process.exitCode = 2;
        return;
      }
      tulis(hasil);
      return;
    }

    case "id": {
      if (!p[0]) throw new TypeError("butuh <id angka>");
      const tipe = opsi("tipe", "movie");
      tulis(await getById(p[0], tipe === true ? "movie" : tipe));
      return;
    }

    case "player":
      if (!p[0]) throw new TypeError("butuh <postId>");
      tulis(await getPlayer(p[0], num(opsi("tab"), 1)));
      return;

    case "semua-player":
      if (!p[0]) throw new TypeError("butuh <postId>");
      tulis(await getSemuaPlayer(p[0], { maksTab: num(opsi("maksTab"), 5) }));
      return;

    case "genre":
      tulis(await getGenre({ perPage: num(opsi("perPage"), 100), page: num(opsi("halaman"), 1) }));
      return;

    case "term": {
      if (!p[0]) throw new TypeError(`butuh <nama taksonomi>: ${Object.keys(TAKSONOMI).join(", ")}`);
      const q = opsi("cari");
      tulis(
        await getTerm(p[0], {
          perPage: num(opsi("perPage"), 100),
          page: num(opsi("halaman"), 1),
          cari: q === true ? null : q,
        }),
      );
      return;
    }

    case "filter":
      if (p.length < 3) throw new TypeError("butuh <tipe> <taksonomi> <slug>");
      tulis(await filterBySlug(p[0], p[1], p[2], opsiDaftar()));
      return;

    case "filter-id":
      if (p.length < 3) throw new TypeError("butuh <tipe> <taksonomi> <id>");
      tulis(await filter(p[0], { [p[1]]: p[2] }, opsiDaftar()));
      return;

    case "cari": {
      if (!p[0]) throw new TypeError("butuh <kueri>");
      const tipe = opsi("tipe", "movie");
      tulis(await cari(p.join(" "), { ...opsiDaftar(), tipe: tipe === true ? "movie" : tipe }));
      return;
    }

    case "cari-semua":
      if (!p[0]) throw new TypeError("butuh <kueri>");
      tulis(await cariSemua(p.join(" "), { page: num(opsi("halaman"), 1), perPage: num(opsi("perPage"), 20) }));
      return;

    case "all-episode":
      if (!p[0]) throw new TypeError("butuh <slug serial>");
      tulis(
        await semuaEpisode(p[0], {
          batas: num(opsi("batas"), 0),
          maksTab: num(opsi("maksTab"), 5),
        }),
      );
      return;

    default:
      process.stderr.write(`perintah tidak dikenal: ${perintah}\n\n${BANTUAN}`);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  if (e instanceof HttpError) {
    process.stderr.write(`HttpError ${e.status} — ${e.url}\n${e.body ?? ""}\n`);
  } else if (e instanceof ApiError) {
    process.stderr.write(`ApiError${e.code ? ` [${e.code}]` : ""} — ${e.message}\n${e.url}\n`);
  } else {
    process.stderr.write(`${e.name}: ${e.message}\n`);
  }
  process.exitCode = 1;
});
