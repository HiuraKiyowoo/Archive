// moviezone-scraper: pembungkus API internal moviezone.web.id (Next.js + TMDB).
//
// Semua batas di bawah ini hasil PENGUKURAN, bukan asumsi. Lihat README.md
// bagian "Bukti live" untuk angka mentahnya.

import { apiGet, ApiError, HttpError, BASE, API } from "./http.js";

/**
 * TMDB memotong paginasi di halaman 500. Terbukti: popular?page=500 -> 200
 * (20 item), page=501 -> 500 `TMDB /movie/popular → 400 Bad Request`.
 * Jadi `total_pages` yang dilaporkan API (mis. 58.710) BOHONG untuk keperluan
 * crawling — yang bisa diambil cuma 500 halaman pertama.
 */
export const MAX_PAGE = 500;

/** Tipe yang diterima parameter `type`. */
export const TIPE = ["movie", "tv", "all"];

/**
 * Peta slug genre -> TMDB genre id, diekstrak dari chunk
 * `/_next/static/chunks/app/(main)/genre/[genre]/page-*.js`.
 *
 * PENTING: endpoint `/api/movies/discover` HANYA menerima ID ANGKA.
 * Terbukti: `?genre=action&type=movie` -> 200 tapi `total_results: 0`,
 * sedangkan `?genre=28&type=movie` -> 49.665 hasil. Halaman genre di situs
 * menerjemahkan slug -> id di sisi klien, bukan di server. Karena responsnya
 * 200-dengan-nol (bukan error), salah kirim slug akan tampak seperti
 * "genre ini memang kosong". Helper `resolveGenre` di bawah menutup jebakan itu.
 */
export const GENRE_SLUG = Object.freeze({
  action: 28,
  adventure: 12,
  animasi: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  "sci-fi": 878,
  thriller: 53,
  war: 10752,
  western: 37,
});

const SLUG_RE = /^(movie|tv)-(\d+)$/;

function bilanganHalaman(page, label = "page") {
  const n = Number(page ?? 1);
  if (!Number.isInteger(n) || n < 1) {
    throw new TypeError(`${label} harus bilangan bulat >= 1 (dapat: ${page})`);
  }
  if (n > MAX_PAGE) {
    throw new RangeError(
      `${label}=${n} melewati batas upstream. TMDB cuma melayani sampai halaman ${MAX_PAGE}.`,
    );
  }
  return n;
}

function cekTipe(type) {
  if (type === undefined || type === null) return undefined;
  const t = String(type).toLowerCase();
  if (!TIPE.includes(t)) {
    throw new TypeError(`type harus salah satu dari: ${TIPE.join(", ")} (dapat: ${type})`);
  }
  return t;
}

/**
 * Normalisasi satu item daftar. Field diambil apa adanya dari upstream —
 * tidak ada field karangan. `null` dipakai kalau upstream memang tidak
 * menyediakan, supaya pemakai bisa membedakan "kosong" vs "tidak ada".
 */
function normItem(x) {
  return {
    slug: x.slug ?? null,
    tmdbId: x.tmdbId ?? x.id ?? null,
    tipe: x.type ?? null, // "Movie" | "Series"
    judul: x.title ?? null,
    poster: x.poster ?? null,
    backdrop: x.backdrop ?? null,
    rating: x.rating ?? null,
    tahun: x.year ?? null,
    tanggalRilis: x.releaseDate ?? null,
    sinopsis: x.overview ?? null,
    genreIds: Array.isArray(x.genreIds) ? x.genreIds : [],
    url: x.slug ? `${BASE}/${x.type === "Series" ? "tv" : "movie"}/${x.slug}` : null,
  };
}

/**
 * Bungkus daftar + paginasi.
 *
 * `total_pages` upstream disalin apa adanya ke `halamanTotalUpstream`, tapi
 * `halamanBisaDiambil` = min(total_pages, 500) karena itu kenyataan yang
 * bisa dipakai. Membedakan keduanya = kejujuran, bukan cerewet: selisihnya
 * bisa 58.710 vs 500.
 */
function bungkusDaftar(data, { page, sumber }) {
  const results = Array.isArray(data.results) ? data.results : [];
  const totalUp = Number.isFinite(data.total_pages) ? data.total_pages : null;
  return {
    jumlah: results.length,
    halaman: page ?? null,
    halamanTotalUpstream: totalUp,
    halamanBisaDiambil: totalUp === null ? null : Math.min(totalUp, MAX_PAGE),
    totalHasil: Number.isFinite(data.total_results) ? data.total_results : null,
    sumber,
    hasil: results.map(normItem),
  };
}

// ─────────────────────────── daftar / katalog ───────────────────────────

/**
 * Slider utama halaman depan. 6 item, campuran Movie + Series, lengkap dengan
 * `titleLogo` (satu-satunya endpoint yang punya field itu).
 * Paginasi TIDAK ADA — `?page=2` mengembalikan byte yang identik dengan page 1
 * (dicek lewat perbandingan hash), jadi parameter page sengaja tidak diterima.
 */
export async function getHero() {
  const { data, url } = await apiGet("hero");
  const results = Array.isArray(data.results) ? data.results : [];
  return {
    jumlah: results.length,
    sumber: url,
    hasil: results.map((x) => ({ ...normItem(x), titleLogo: x.titleLogo ?? null })),
  };
}

/**
 * Trending (TMDB /trending/all/week). Campuran Movie + Series.
 * Parameter `type` DIABAIKAN upstream — `?type=tv`, `?type=movie`, dan tanpa
 * param mengembalikan judul pertama yang sama. Karena itu fungsi ini tidak
 * menerima `type`: lebih baik tidak menyediakan tombol yang tidak berfungsi.
 */
export async function getTrending({ page = 1 } = {}) {
  const p = bilanganHalaman(page);
  const { data, url } = await apiGet("trending", { page: p });
  return bungkusDaftar(data, { page: p, sumber: url });
}

/** Terpopuler. `type: "all"` = gabungan movie+tv dalam satu respons (40 item). */
export async function getPopular({ type = "movie", page = 1 } = {}) {
  const t = cekTipe(type);
  const p = bilanganHalaman(page);
  const { data, url } = await apiGet("popular", { type: t, page: p });
  return bungkusDaftar(data, { page: p, sumber: url });
}

/** Rating tertinggi. */
export async function getTopRated({ type = "movie", page = 1 } = {}) {
  const t = cekTipe(type);
  const p = bilanganHalaman(page);
  const { data, url } = await apiGet("top-rated", { type: t, page: p });
  return bungkusDaftar(data, { page: p, sumber: url });
}

/** Rilisan terbaru (now playing / on the air). */
export async function getLatest({ type = "movie", page = 1 } = {}) {
  const t = cekTipe(type);
  const p = bilanganHalaman(page);
  const { data, url } = await apiGet("latest", { type: t, page: p });
  return bungkusDaftar(data, { page: p, sumber: url });
}

/**
 * Akan datang. HANYA FILM: `?type=tv` mengembalikan 19 item yang semuanya
 * bertipe "Movie", sama persis dengan tanpa param. Katalognya pendek
 * (total_pages: 2, halaman 3 = 0 item), jadi jangan berharap banyak.
 */
export async function getUpcoming({ page = 1 } = {}) {
  const p = bilanganHalaman(page);
  const { data, url } = await apiGet("upcoming", { page: p });
  return bungkusDaftar(data, { page: p, sumber: url });
}

/** Daftar genre beserta ID TMDB-nya. Nama sudah dalam bahasa Indonesia. */
export async function getGenres() {
  const { data, url } = await apiGet("genres");
  const g = Array.isArray(data.genres) ? data.genres : [];
  return { jumlah: g.length, sumber: url, hasil: g.map((x) => ({ id: x.id, nama: x.name })) };
}

/**
 * Ubah slug / nama / angka menjadi ID genre TMDB.
 * Menolak nilai tak dikenal dengan error, BUKAN mengembalikan daftar kosong.
 */
export function resolveGenre(genre) {
  if (genre === undefined || genre === null || genre === "") {
    throw new TypeError("genre wajib diisi (slug seperti 'action', atau ID TMDB seperti 28)");
  }
  if (typeof genre === "number" || /^\d+$/.test(String(genre))) {
    const n = Number(genre);
    if (!Number.isInteger(n) || n <= 0) throw new TypeError(`ID genre tidak valid: ${genre}`);
    return n;
  }
  const key = String(genre).trim().toLowerCase();
  if (key in GENRE_SLUG) return GENRE_SLUG[key];
  throw new TypeError(
    `Genre '${genre}' tidak dikenal. Slug yang didukung: ${Object.keys(GENRE_SLUG).join(", ")}. ` +
      "Untuk genre khusus serial (mis. 10759 Aksi & Petualangan) kirim ID angkanya, " +
      "daftarnya dari getGenres().",
  );
}

/**
 * Telusuri per genre.
 *
 * Genre film dan genre serial di TMDB adalah dua himpunan BERBEDA. Mengirim
 * genre film ke `type=tv` menghasilkan 200 dengan nol hasil, bukan error —
 * terukur: genre 53/878/27/14/12/10752/10402 -> 0 item untuk type=tv,
 * sementara 10759/18/16/36 -> 20 item. Kalau hasilnya nol dan kombinasinya
 * memang mustahil, `catatan` menjelaskannya supaya tidak dikira bug.
 */
export async function discover({ genre, type = "movie", page = 1 } = {}) {
  const id = resolveGenre(genre);
  const t = cekTipe(type) ?? "movie";
  const p = bilanganHalaman(page);
  const { data, url } = await apiGet("discover", { genre: id, type: t, page: p });
  const out = bungkusDaftar(data, { page: p, sumber: url });
  out.genreId = id;
  out.catatan =
    out.jumlah === 0
      ? `Nol hasil. Genre ID ${id} kemungkinan tidak berlaku untuk type='${t}' ` +
        "(TMDB memisahkan genre film dan genre serial). Cek getGenres()."
      : null;
  return out;
}

/** Pencarian judul. `q` kosong ditolak upstream dengan 400 "Query wajib diisi". */
export async function search({ q, page = 1 } = {}) {
  if (typeof q !== "string" || q.trim() === "") {
    throw new TypeError("q wajib diisi dan tidak boleh string kosong");
  }
  const p = bilanganHalaman(page);
  const { data, url } = await apiGet("search", { q: q.trim(), page: p });
  return bungkusDaftar(data, { page: p, sumber: url });
}

// ─────────────────────────── detail / episode ───────────────────────────

/** Validasi slug `movie-<id>` / `tv-<id>`; upstream balas 400 kalau formatnya salah. */
export function parseSlug(slug) {
  const m = SLUG_RE.exec(String(slug ?? "").trim());
  if (!m) {
    throw new TypeError(
      `Slug tidak valid: '${slug}'. Format wajib 'movie-{tmdbId}' atau 'tv-{tmdbId}'.`,
    );
  }
  return { tipe: m[1], tmdbId: Number(m[2]), slug: `${m[1]}-${m[2]}` };
}

/**
 * Detail satu judul.
 *
 * Field `stream` berisi tautan IFRAME PIHAK KETIGA (2Embed, SuperEmbed,
 * VidSrc, VidLink) yang dirakit dari ID TMDB — bukan file video milik situs
 * ini. Scraper cuma menyalin tautannya, tidak menyentuh/mengunduh videonya.
 */
export async function getDetail(slug) {
  const s = parseSlug(slug);
  const { data, url } = await apiGet(`detail/${s.slug}`);
  const stream = data.stream ?? {};
  return {
    slug: data.slug ?? s.slug,
    tmdbId: data.id ?? s.tmdbId,
    tipe: data.type ?? null,
    judul: data.title ?? null,
    poster: data.poster ?? null,
    backdrop: data.backdrop ?? null,
    rating: data.rating ?? null,
    tahun: data.year ?? null,
    tanggalRilis: data.releaseDate ?? null,
    sinopsis: data.synopsis ?? null,
    tagline: data.tagline ?? null,
    durasi: data.duration ?? null,
    status: data.status ?? null,
    genre: Array.isArray(data.genres) ? data.genres : [],
    sutradara: data.director ?? null,
    pemain: Array.isArray(data.cast) ? data.cast : [],
    pemainDetail: Array.isArray(data.castDetailed) ? data.castDetailed : [],
    trailer: data.trailer ?? null,
    imdbId: data.imdbId ?? null,
    jumlahSeason: data.numberOfSeasons ?? null,
    jumlahEpisode: data.numberOfEpisodes ?? null,
    season: Array.isArray(data.seasons)
      ? data.seasons.map((s2) => ({
          nomor: s2.season_number,
          nama: s2.name ?? null,
          jumlahEpisode: s2.episode_count ?? null,
          tanggalTayang: s2.air_date ?? null,
          poster: s2.poster_path ? `https://image.tmdb.org/t/p/w500${s2.poster_path}` : null,
          rating: s2.vote_average ?? null,
        }))
      : [],
    iframeUtama: stream.primaryIframe ?? null,
    server: Array.isArray(stream.servers)
      ? stream.servers.map((x) => ({ nama: x.server, url: x.url }))
      : [],
    sumber: url,
  };
}

/**
 * Episode satu season. Hanya untuk slug `tv-*`.
 * Season yang tidak ada -> upstream balas 500 berisi `TMDB /tv/x/season/99 → 404`.
 */
export async function getEpisodes(slug, season = 1) {
  const s = parseSlug(slug);
  if (s.tipe !== "tv") {
    throw new TypeError(`getEpisodes hanya untuk serial (slug tv-*), dapat '${s.slug}'`);
  }
  const n = Number(season);
  if (!Number.isInteger(n) || n < 0) {
    throw new TypeError(`season harus bilangan bulat >= 0 (dapat: ${season})`);
  }
  const { data, url } = await apiGet(`episodes/${s.slug}`, { season: n });
  const eps = Array.isArray(data.episodes) ? data.episodes : [];
  return {
    slug: s.slug,
    season: n,
    jumlah: eps.length,
    sumber: url,
    hasil: eps.map((e) => ({
      episode: e.episode ?? null,
      season: e.season ?? n,
      judul: e.title ?? null,
      sinopsis: e.overview ?? null,
      thumbnail: e.still ?? null,
      tanggalTayang: e.airDate ?? null,
      durasi: e.runtime ?? null,
      server: Array.isArray(e.servers)
        ? e.servers.map((x) => ({ nama: x.server, url: x.url }))
        : [],
    })),
  };
}

/**
 * Semua episode dari semua season sebuah serial.
 * Season 0 (Specials) DILEWATI kecuali `sertakanSpecials: true`.
 * Season yang gagal dicatat di `gagal[]`, tidak dilempar — supaya satu season
 * rusak tidak membatalkan sisa serial. Serial 4 season = 5 request (1 detail +
 * 4 season) dengan jeda 1,2 s, jadi hitung ~6 detik.
 */
export async function getSemuaEpisode(slug, { sertakanSpecials = false } = {}) {
  const detail = await getDetail(slug);
  if (detail.tipe !== "Series") {
    throw new TypeError(`'${slug}' bukan serial (tipe: ${detail.tipe})`);
  }
  const nomor = detail.season
    .map((s) => s.nomor)
    .filter((n) => Number.isInteger(n) && (sertakanSpecials || n > 0));

  const hasil = [];
  const gagal = [];
  for (const n of nomor) {
    try {
      hasil.push(await getEpisodes(slug, n));
    } catch (e) {
      gagal.push({ season: n, error: e.message });
    }
  }
  return {
    slug: detail.slug,
    judul: detail.judul,
    jumlahSeason: detail.jumlahSeason,
    seasonDiambil: hasil.length,
    totalEpisode: hasil.reduce((a, s) => a + s.jumlah, 0),
    gagal,
    season: hasil,
  };
}

/**
 * Ambil beberapa halaman sekaligus dari fungsi daftar mana pun, dengan dedupe
 * berbasis slug. Serial (tidak paralel) karena transport-nya memang serial.
 * Berhenti lebih awal kalau halaman kosong atau tidak ada item baru.
 */
export async function ambilHalaman(fn, { mulai = 1, jumlahHalaman = 3, ...opsi } = {}) {
  const terlihat = new Set();
  const hasil = [];
  const halaman = [];
  for (let i = 0; i < jumlahHalaman; i += 1) {
    const p = mulai + i;
    if (p > MAX_PAGE) break;
    const r = await fn({ ...opsi, page: p });
    let baru = 0;
    for (const item of r.hasil) {
      const key = item.slug ?? `${item.tipe}-${item.tmdbId}`;
      if (terlihat.has(key)) continue;
      terlihat.add(key);
      hasil.push(item);
      baru += 1;
    }
    halaman.push({ halaman: p, jumlah: r.jumlah, baru });
    if (r.jumlah === 0 || baru === 0) break;
  }
  return { jumlah: hasil.length, halaman, hasil };
}

export { ApiError, HttpError, BASE, API };
