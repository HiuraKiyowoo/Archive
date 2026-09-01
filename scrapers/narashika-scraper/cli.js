#!/usr/bin/env node
// CLI narashika-scraper. JSON ke stdout, status/pesan ke stderr,
// jadi output bisa dipipe langsung ke jq tanpa kotor.

import {
  daftar,
  getFilm,
  getSerial,
  getEpisodeTerbaru,
  getTerpopuler,
  filter,
  filterBySlug,
  cari,
  cariSemua,
  getBySlug,
  getById,
  getDetail,
  getDetailHtml,
  getTerm,
  getGenre,
  semuaEpisode,
  TAKSONOMI,
  POST_TYPE,
  ORDERBY,
  ORDERBY_DITOLAK,
  MAX_PER_PAGE,
} from "./src/index.js";

const argv = process.argv.slice(2);
const perintah = argv[0];

function opsi(nama, bawaan = undefined) {
  const i = argv.indexOf(`--${nama}`);
  if (i < 0) return bawaan;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}
const angka = (nama, bawaan) => {
  const v = opsi(nama);
  return v === undefined ? bawaan : Number(v);
};
const posisi = (n) => argv.filter((a, i) => i > 0 && !a.startsWith("--") && !argv[i - 1]?.startsWith("--"))[n];

const keluar = (obj) => process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);

const BANTUAN = `
narashika-scraper — narashika.top (WordPress 6.8.8 + tema muvipro)

  KATALOG
    film                      daftar film        (post type posts,   ~1.427)
    serial                    daftar serial/drama (post type tv,      ~585)
    episode                   episode terbaru    (post type episode, ~7.403)
    daftar <tipe>             movie | tv | episode
    populer <tipe>            urut views (DIHITUNG LOKAL, server tolak orderby=views)

  CARI
    cari <kueri>              cari di satu post type (--tipe movie)
    cari-semua <kueri>        cari lintas semua post type (/wp/v2/search)

  DETAIL
    detail <slug>             REST + HTML: metadata, download, rating, iframe
    html <url-atau-slug>      cuma bagian HTML (rating, durasi, player, episode)
    slug <slug>               cuma REST (tanpa request HTML kedua)
    id <angka>                ambil berdasarkan id numerik

  TAKSONOMI
    genre                     66 genre (taksonomi categories, arsip /genre/)
    term <nama>               ${Object.keys(TAKSONOMI).join(" | ")}
    filter <tipe> <taks> <slug-term>    contoh: filter tv categories drama-korea

  SERIAL
    all-episode <slug-tv>     semua episode satu serial (--batas N, --no-player)

  ROUTE                       tampilkan seluruh peta route REST + arsip HTML

  Opsi umum: --page N  --perPage N (maks ${MAX_PER_PAGE})  --orderby ${ORDERBY.join("|")}
             --order asc|desc  --tipe movie|tv|episode  --batas N  --no-player

  orderby yang DITOLAK server: ${ORDERBY_DITOLAK.join(", ")}
`;

const opsiUmum = () => ({
  page: angka("page", 1),
  perPage: angka("perPage", 20),
  orderby: opsi("orderby", "date"),
  order: opsi("order", "desc"),
});

try {
  switch (perintah) {
    case "film":
      keluar(await getFilm(opsiUmum()));
      break;
    case "serial":
      keluar(await getSerial(opsiUmum()));
      break;
    case "episode":
      keluar(await getEpisodeTerbaru(opsiUmum()));
      break;
    case "daftar":
      keluar(await daftar(posisi(0) ?? "movie", opsiUmum()));
      break;
    case "populer":
      keluar(
        await getTerpopuler(posisi(0) ?? "movie", {
          halaman: angka("halaman", 3),
          perPage: angka("perPage", 100),
        }),
      );
      break;
    case "cari":
      keluar(await cari(posisi(0), { ...opsiUmum(), tipe: opsi("tipe", "movie"), orderby: opsi("orderby") }));
      break;
    case "cari-semua":
      keluar(await cariSemua(posisi(0), { page: angka("page", 1), perPage: angka("perPage", 20) }));
      break;
    case "detail": {
      const d = await getDetail(posisi(0), opsi("tipe", "movie"));
      if (!d) {
        process.stderr.write(`Tidak ditemukan: ${posisi(0)}\n`);
        process.exit(2);
      }
      keluar(d);
      break;
    }
    case "html":
      keluar(await getDetailHtml(posisi(0)));
      break;
    case "slug": {
      const d = await getBySlug(posisi(0), opsi("tipe", "movie"));
      if (!d) {
        process.stderr.write(`Tidak ditemukan: ${posisi(0)}\n`);
        process.exit(2);
      }
      keluar(d);
      break;
    }
    case "id":
      keluar(await getById(posisi(0), opsi("tipe", "movie")));
      break;
    case "genre":
      keluar(await getGenre({ page: angka("page", 1), perPage: angka("perPage", 100) }));
      break;
    case "term":
      keluar(
        await getTerm(posisi(0), {
          page: angka("page", 1),
          perPage: angka("perPage", 100),
          cari: opsi("cari"),
        }),
      );
      break;
    case "filter":
      keluar(await filterBySlug(posisi(0), posisi(1), posisi(2), opsiUmum()));
      break;
    case "all-episode":
      keluar(
        await semuaEpisode(posisi(0), {
          batas: angka("batas", 0),
          ambilPlayer: opsi("no-player") === undefined,
        }),
      );
      break;
    case "route":
      keluar({
        base: "https://narashika.top",
        rest: "https://narashika.top/wp-json/wp/v2",
        postType: POST_TYPE,
        taksonomi: TAKSONOMI,
        orderbyDidukung: ORDERBY,
        orderbyDitolak: ORDERBY_DITOLAK,
        maxPerPage: MAX_PER_PAGE,
        arsipHtml: Object.fromEntries(
          Object.entries(TAKSONOMI).map(([k, v]) => [k, `https://narashika.top/${v.url}/<slug>/`]),
        ),
        urlDetail: {
          film: "https://narashika.top/<slug>/",
          serial: "https://narashika.top/tv/<slug>/",
          episode: "https://narashika.top/eps/<slug>/",
        },
        hanyaDiHtml: ["rating", "jumlahVote", "durasi", "kualitas", "iframePlayer"],
        hanyaDiRest: ["download", "views", "id taksonomi", "tanggal", "diubah"],
      });
      break;
    default:
      process.stderr.write(BANTUAN);
      process.exit(perintah ? 1 : 0);
  }
} catch (e) {
  process.stderr.write(`${e.name ?? "Error"}: ${e.message}\n`);
  if (e.body) process.stderr.write(`upstream: ${e.body}\n`);
  process.exit(1);
}
