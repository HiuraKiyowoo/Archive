// narashika-scraper: pembungkus REST WordPress + pengurai HTML untuk
// narashika.top (film, drama Korea/China, episode serial).
//
// PEMBAGIAN TUGAS yang sudah diukur, bukan asumsi:
//
//   REST /wp-json/wp/v2/*  -> katalog, metadata, taksonomi, search, DOWNLOAD
//   HTML halaman           -> rating, durasi, iframe player  (TIDAK ada di REST)
//
// Bukti pembagian itu:
//   - `content.rendered` post film MEMUAT tautan download (1fichier,
//     buzzheavier, send.cm) — jadi download tidak perlu HTML.
//   - `content.rendered` TIDAK memuat `<iframe`, `short.ink`, atau `rpmvid`
//     sama sekali; iframe player cuma ada di HTML (tema muvipro menaruhnya
//     di custom field yang tidak diekspos REST).
//   - tidak ada satu pun key REST yang mengandung 'rat'/'score' → rating
//     (`ratingValue`/`ratingCount` schema.org) hanya ada di HTML.

import { restGet, htmlGet, ApiError, HttpError, BASE, REST } from "./http.js";

/** Batas keras REST WordPress: `per_page=101` -> 400 `rest_invalid_param`. */
export const MAX_PER_PAGE = 100;

/**
 * Tiga post type film di situs ini (dari `/wp-json/wp/v2/types`).
 * Angka = X-WP-Total pada 2026-09-01, dipakai cuma sebagai patokan urutan
 * besaran di test (bukan nilai yang di-hardcode ke logika).
 */
export const POST_TYPE = Object.freeze({
  movie: "posts", // 1.427 — film
  tv: "tv", // 585 — serial/drama
  episode: "episode", // 7.403 — episode per serial
});

/**
 * Taksonomi yang terdaftar (dari `/wp-json/wp/v2/taxonomies`), beserta
 * prefix URL arsip HTML-nya yang SUDAH DIVERIFIKASI 200 satu per satu.
 *
 * Catatan penting: `rest_base` (dipakai untuk REST) BERBEDA dari prefix URL
 * publik untuk beberapa taksonomi — `muvicast` -> `/cast/`,
 * `muvicountry` -> `/country/`, `muviyear` -> `/year/`. Jangan disamakan.
 */
export const TAKSONOMI = Object.freeze({
  categories: { rest: "categories", url: "genre", untuk: ["movie", "tv"], jumlah: 66 },
  tags: { rest: "tags", url: "tag", untuk: ["movie", "tv"], jumlah: 2320 },
  director: { rest: "muvidirector", url: "director", untuk: ["movie", "tv"], jumlah: 875 },
  cast: { rest: "muvicast", url: "cast", untuk: ["movie", "tv"], jumlah: 4485 },
  year: { rest: "muviyear", url: "year", untuk: ["movie", "tv"], jumlah: 28 },
  country: { rest: "muvicountry", url: "country", untuk: ["movie", "tv"], jumlah: 48 },
  network: { rest: "muvinetwork", url: "network", untuk: ["tv"], jumlah: 62 },
  quality: { rest: "muviquality", url: "quality", untuk: ["movie", "episode"], jumlah: 13 },
  index: { rest: "muviindex", url: "index", untuk: ["movie", "tv"], jumlah: 31 },
});

/** `orderby` yang TERBUKTI diterima (diuji satu per satu). */
export const ORDERBY = ["date", "modified", "title", "id", "slug", "include"];

/**
 * `orderby` yang DITOLAK upstream, dicatat supaya tidak dicoba lagi:
 *   relevance      -> 400 rest_no_search_term_defined (hanya sah bersama `search`)
 *   views          -> 400 rest_invalid_param  (padahal field `views` ADA di respons)
 *   meta_value_num -> 400 rest_invalid_param
 * Artinya: tidak bisa minta "terpopuler" dari server. Mau urut `views`?
 * harus tarik dulu lalu sortir sendiri — dan itu jujur disebut di `catatan`.
 */
export const ORDERBY_DITOLAK = ["relevance (tanpa search)", "views", "meta_value_num"];

function cekTipe(tipe) {
  const t = String(tipe ?? "movie").toLowerCase();
  if (!(t in POST_TYPE)) {
    throw new TypeError(`tipe harus salah satu dari: ${Object.keys(POST_TYPE).join(", ")} (dapat: ${tipe})`);
  }
  return t;
}

function cekHalaman(page, label = "page") {
  const n = Number(page ?? 1);
  if (!Number.isInteger(n) || n < 1) {
    throw new TypeError(`${label} harus bilangan bulat >= 1 (dapat: ${page})`);
  }
  return n;
}

function cekPerPage(v) {
  const n = Number(v ?? 20);
  if (!Number.isInteger(n) || n < 1) {
    throw new TypeError(`perPage harus bilangan bulat >= 1 (dapat: ${v})`);
  }
  if (n > MAX_PER_PAGE) {
    throw new RangeError(
      `perPage=${n} melebihi batas WordPress (${MAX_PER_PAGE}); upstream balas 400 rest_invalid_param.`,
    );
  }
  return n;
}

const bersih = (s) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#8216;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Normalkan host varian (`tv.narashika.top`, `narashika.site`) ke BASE. */
function normHost(u) {
  if (!u) return null;
  return String(u).replace(/^https?:\/\/(?:tv\.)?narashika\.(?:top|site)/i, BASE);
}

/**
 * Ambil tautan download dari `content.rendered`.
 * Struktur nyata di situs: baris `<p>` berisi "360p [Hardsub-Indo] – <a>1fichier</a>
 * | <a>Buzzheavier</a> | <a>send.cm</a>". Resolusi dikenali dari teks sebelum
 * rentetan tautan, jadi pengelompokan mengikuti isi, bukan urutan tebakan.
 */
function ambilDownload(html) {
  const out = [];
  const teks = String(html ?? "");
  const paragraf = teks.split(/<\/p>/i);
  for (const p of paragraf) {
    // Kutip ganda MAUPUN tunggal diterima: situs ini konsisten pakai kutip
    // ganda, tapi WordPress/plugin bisa menghasilkan keduanya di satu halaman.
    const tautan = [...p.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi)]
      .map((m) => ({ url: m[1], nama: bersih(m[2]) }))
      .filter((x) => /^https?:\/\//.test(x.url) && !/narashika|t\.me|trakteer/i.test(x.url));
    if (tautan.length === 0) continue;
    const label = bersih(p.replace(/<a[^>]*>.*?<\/a>/gi, " "));
    const reso = label.match(/(\d{3,4}p)/i);
    out.push({
      resolusi: reso ? reso[1].toLowerCase() : null,
      keterangan: label.slice(0, 120) || null,
      tautan,
    });
  }
  return out;
}

/** Normalisasi satu item REST (berlaku untuk posts/tv/episode). */
function normItem(x, tipe) {
  const emb = x._embedded ?? {};
  const media = emb["wp:featuredmedia"]?.[0];
  const terms = (emb["wp:term"] ?? []).flat();
  const konten = x.content?.rendered ?? "";
  const download = ambilDownload(konten);
  return {
    id: x.id ?? null,
    tipe,
    slug: x.slug ?? null,
    judul: bersih(x.title?.rendered),
    url: normHost(x.link),
    tanggal: x.date ?? null,
    diubah: x.modified ?? null,
    views: Number.isFinite(x.views) ? x.views : null,
    sinopsis: bersih(x.excerpt?.rendered) || bersih(konten).slice(0, 400) || null,
    poster: media?.source_url ? normHost(media.source_url) : null,
    // Taksonomi: id mentah selalu disertakan; nama hanya kalau _embed dipakai.
    kategoriId: x.categories ?? [],
    tagId: x.tags ?? [],
    tahunId: x.muviyear ?? [],
    negaraId: x.muvicountry ?? [],
    kualitasId: x.muviquality ?? [],
    sutradaraId: x.muvidirector ?? [],
    pemainId: x.muvicast ?? [],
    jaringanId: x.muvinetwork ?? [],
    term: terms.length
      ? terms.map((t) => ({ taksonomi: t.taxonomy, nama: bersih(t.name), slug: t.slug }))
      : [],
    download,
    // Sengaja TIDAK diisi di sini — hanya ada di HTML. Lihat getDetailHtml().
    rating: null,
    durasi: null,
    iframePlayer: null,
  };
}

function bungkus({ data, url, total, totalHalaman }, { tipe, page, perPage, catatan = null }) {
  const arr = Array.isArray(data) ? data : [];
  return {
    jumlah: arr.length,
    halaman: page,
    perHalaman: perPage,
    totalItem: total,
    totalHalaman,
    sumber: url,
    catatan,
    hasil: arr.map((x) => normItem(x, tipe)),
  };
}

// ─────────────────────────── FUNGSI KATALOG (REST) ───────────────────────────

const FIELD_EMBED = "_embed";

/**
 * Daftar isi satu post type.
 * @param {"movie"|"tv"|"episode"} tipe
 * @param {{page?:number, perPage?:number, orderby?:string, order?:"asc"|"desc", embed?:boolean}} opsi
 */
export async function daftar(tipe = "movie", opsi = {}) {
  const t = cekTipe(tipe);
  const page = cekHalaman(opsi.page);
  const perPage = cekPerPage(opsi.perPage);
  const orderby = opsi.orderby ?? "date";
  if (!ORDERBY.includes(orderby)) {
    throw new TypeError(
      `orderby="${orderby}" tidak didukung upstream. Yang sah: ${ORDERBY.join(", ")}. ` +
        `Ditolak server: ${ORDERBY_DITOLAK.join(", ")}.`,
    );
  }
  const params = { page, per_page: perPage, orderby, order: opsi.order ?? "desc" };
  if (opsi.embed !== false) params[FIELD_EMBED] = 1;
  const res = await restGet(POST_TYPE[t], params);
  return bungkus(res, { tipe: t, page, perPage });
}

/** Film terbaru (post type `posts`). */
export const getFilm = (opsi = {}) => daftar("movie", opsi);

/** Serial/drama (post type `tv`). */
export const getSerial = (opsi = {}) => daftar("tv", opsi);

/** Episode terbaru lintas serial (post type `episode`) — ini "UPDATE TERBARU". */
export const getEpisodeTerbaru = (opsi = {}) => daftar("episode", opsi);

/**
 * Urut berdasarkan `views` TIDAK bisa diminta ke server
 * (`orderby=views` -> 400 rest_invalid_param), padahal field `views` ada di
 * respons. Jadi popularitas dihitung LOKAL dari N halaman pertama, dan
 * `catatan` menyatakan itu apa adanya supaya tidak dikira peringkat resmi.
 *
 * TERUKUR: field `views` HANYA ada di post type `posts` (film) — 32 key di
 * respons. Post type `tv` (27 key) dan `episode` (20 key) TIDAK punya field itu
 * sama sekali. Jadi tipe selain "movie" ditolak di sini, bukan dikembalikan
 * dengan urutan acak yang seolah-olah peringkat popularitas.
 */
export async function getTerpopuler(tipe = "movie", { halaman = 3, perPage = 100 } = {}) {
  const t = cekTipe(tipe);
  if (t !== "movie") {
    throw new TypeError(
      `getTerpopuler hanya berlaku untuk tipe "movie". Post type "${POST_TYPE[t]}" ` +
        `tidak mengekspos field views di REST, jadi tidak ada dasar untuk mengurutkannya.`,
    );
  }
  const n = cekHalaman(halaman, "halaman");
  const kumpul = [];
  let totalItem = null;
  let totalHalaman = null;
  for (let p = 1; p <= n; p += 1) {
    const r = await daftar(t, { page: p, perPage, embed: false });
    totalItem = r.totalItem;
    totalHalaman = r.totalHalaman;
    kumpul.push(...r.hasil);
    if (r.jumlah === 0 || p >= (r.totalHalaman ?? n)) break;
  }
  kumpul.sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  return {
    jumlah: kumpul.length,
    totalItem,
    totalHalaman,
    catatan:
      `Diurutkan LOKAL menurut field views dari ${n} halaman terbaru (${kumpul.length} item), ` +
      `bukan peringkat populer dari server: upstream menolak orderby=views dengan 400.`,
    hasil: kumpul,
  };
}

/**
 * Filter berdasarkan taksonomi. Kunci = nama di TAKSONOMI (genre pakai
 * `categories`). Nilai boleh id angka atau array id.
 *
 * Diverifikasi: taksonomi muvi* MEMANG bisa dipakai sebagai query param di
 * `posts` maupun `tv` (mis. `?muviyear=7613`, `?muvicountry=108`).
 */
export async function filter(tipe = "movie", filterTaks = {}, opsi = {}) {
  const t = cekTipe(tipe);
  const page = cekHalaman(opsi.page);
  const perPage = cekPerPage(opsi.perPage);
  const params = { page, per_page: perPage, orderby: opsi.orderby ?? "date", order: opsi.order ?? "desc" };
  if (opsi.embed !== false) params[FIELD_EMBED] = 1;

  let adaFilter = false;
  for (const [k, v] of Object.entries(filterTaks)) {
    if (v === undefined || v === null || v === "") continue;
    const def = TAKSONOMI[k];
    if (!def) {
      throw new TypeError(
        `taksonomi "${k}" tidak dikenal. Yang ada: ${Object.keys(TAKSONOMI).join(", ")}.`,
      );
    }
    if (!def.untuk.includes(t)) {
      throw new TypeError(
        `taksonomi "${k}" tidak berlaku untuk tipe "${t}" (hanya: ${def.untuk.join(", ")}).`,
      );
    }
    params[def.rest] = v;
    adaFilter = true;
  }
  if (!adaFilter) throw new TypeError("filter kosong — beri minimal satu taksonomi.");

  const res = await restGet(POST_TYPE[t], params);
  const out = bungkus(res, { tipe: t, page, perPage });
  if (out.jumlah === 0) {
    out.catatan =
      "0 hasil. Cek id term-nya benar (pakai getTerm) dan taksonomi itu memang dipakai post type ini.";
  }
  return out;
}

/** Cari judul. `orderby=relevance` baru sah kalau `search` diisi. */
export async function cari(kueri, opsi = {}) {
  const q = String(kueri ?? "").trim();
  if (!q) throw new TypeError("kueri pencarian tidak boleh kosong.");
  const t = cekTipe(opsi.tipe ?? "movie");
  const page = cekHalaman(opsi.page);
  const perPage = cekPerPage(opsi.perPage);
  const params = { search: q, page, per_page: perPage };
  if (opsi.orderby) params.orderby = opsi.orderby;
  if (opsi.embed !== false) params[FIELD_EMBED] = 1;
  const res = await restGet(POST_TYPE[t], params);
  const out = bungkus(res, { tipe: t, page, perPage });
  out.kueri = q;
  return out;
}

/**
 * Cari lintas semua post type sekaligus lewat `/wp/v2/search`.
 * Respons endpoint ini ringkas (id/title/url/subtype) — bukan objek post penuh.
 */
export async function cariSemua(kueri, { page = 1, perPage = 20 } = {}) {
  const q = String(kueri ?? "").trim();
  if (!q) throw new TypeError("kueri pencarian tidak boleh kosong.");
  const p = cekHalaman(page);
  const pp = cekPerPage(perPage);
  const res = await restGet("search", { search: q, page: p, per_page: pp });
  const arr = Array.isArray(res.data) ? res.data : [];
  return {
    kueri: q,
    jumlah: arr.length,
    halaman: p,
    totalItem: res.total,
    totalHalaman: res.totalHalaman,
    sumber: res.url,
    hasil: arr.map((x) => ({
      id: x.id ?? null,
      judul: bersih(x.title),
      url: normHost(x.url),
      tipe: x.subtype ?? x.type ?? null,
    })),
  };
}

/** Ambil satu item berdasarkan slug (mengembalikan null kalau tidak ada). */
export async function getBySlug(slug, tipe = "movie") {
  const s = String(slug ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!s) throw new TypeError("slug tidak boleh kosong.");
  const t = cekTipe(tipe);
  const res = await restGet(POST_TYPE[t], { slug: s, [FIELD_EMBED]: 1 });
  const arr = Array.isArray(res.data) ? res.data : [];
  return arr.length ? normItem(arr[0], t) : null;
}

/** Ambil satu item berdasarkan id numerik. */
export async function getById(id, tipe = "movie") {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) throw new TypeError(`id harus bilangan bulat >= 1 (dapat: ${id})`);
  const t = cekTipe(tipe);
  const res = await restGet(`${POST_TYPE[t]}/${n}`, { [FIELD_EMBED]: 1 });
  return normItem(res.data, t);
}

// ─────────────────────────── TAKSONOMI (REST) ───────────────────────────

/**
 * Daftar term satu taksonomi (genre, tahun, negara, kualitas, dst).
 * `url` tiap term dibangun dari prefix arsip publik yang sudah diverifikasi 200
 * — BUKAN dari `link` upstream, karena sebagian `link` masih menunjuk host lama.
 */
export async function getTerm(nama, { page = 1, perPage = 100, cari: q } = {}) {
  const def = TAKSONOMI[nama];
  if (!def) {
    throw new TypeError(`taksonomi "${nama}" tidak dikenal. Yang ada: ${Object.keys(TAKSONOMI).join(", ")}.`);
  }
  const p = cekHalaman(page);
  const pp = cekPerPage(perPage);
  const res = await restGet(def.rest, { page: p, per_page: pp, search: q, orderby: "name", order: "asc" });
  const arr = Array.isArray(res.data) ? res.data : [];
  return {
    taksonomi: nama,
    restBase: def.rest,
    prefixUrl: `/${def.url}/`,
    jumlah: arr.length,
    halaman: p,
    totalItem: res.total,
    totalHalaman: res.totalHalaman,
    sumber: res.url,
    hasil: arr.map((t) => ({
      id: t.id ?? null,
      nama: bersih(t.name),
      slug: t.slug ?? null,
      jumlahPost: Number.isFinite(t.count) ? t.count : null,
      url: t.slug ? `${BASE}/${def.url}/${t.slug}/` : null,
    })),
  };
}

/** Pintasan: 66 genre situs (taksonomi `categories`, arsip `/genre/<slug>/`). */
export const getGenre = (opsi = {}) => getTerm("categories", { perPage: 100, ...opsi });

/**
 * Cari id term dari slug/nama, lalu langsung filter.
 * Melempar kalau term tidak ketemu — bukan diam-diam balikin kosong, karena
 * filter dengan id salah balas 200 + 0 hasil (gagal sunyi).
 */
export async function filterBySlug(tipe, namaTaksonomi, slugTerm, opsi = {}) {
  const s = String(slugTerm ?? "").trim();
  if (!s) throw new TypeError("slug term tidak boleh kosong.");
  const def = TAKSONOMI[namaTaksonomi];
  if (!def) {
    throw new TypeError(
      `taksonomi "${namaTaksonomi}" tidak dikenal. Yang ada: ${Object.keys(TAKSONOMI).join(", ")}.`,
    );
  }
  const res = await restGet(def.rest, { slug: s, per_page: 1 });
  const arr = Array.isArray(res.data) ? res.data : [];
  if (!arr.length) {
    throw new ApiError(res.url, `Term "${s}" tidak ada di taksonomi ${namaTaksonomi}. Cek dengan getTerm().`);
  }
  const out = await filter(tipe, { [namaTaksonomi]: arr[0].id }, opsi);
  out.term = { id: arr[0].id, nama: bersih(arr[0].name), slug: arr[0].slug };
  return out;
}

// ───────────── HTML: rating, durasi, iframe player, daftar episode ─────────────

function ambilAttr(html, pola) {
  const m = String(html ?? "").match(pola);
  return m ? bersih(m[1]) : null;
}

/**
 * Ambil teks di dalam elemen ber-class tertentu, dengan ikon <svg> di awalnya
 * dibuang lebih dulu. Dipakai untuk `gmr-duration-item` dan `gmr-numbeps`, yang
 * di tema muvipro isinya `<svg ...>...</svg>101 Min`.
 */
function ambilTeksSetelahIkon(html, kelas) {
  const teks = String(html ?? "");
  const i = teks.indexOf(`class="${kelas}"`);
  if (i < 0) return null;
  const potong = teks.slice(i, i + 3000);
  const tutup = potong.indexOf(">");
  if (tutup < 0) return null;
  const isi = potong
    .slice(tutup + 1)
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .split(/<\/(?:span|div|li)>/i)[0];
  const hasil = bersih(isi);
  return hasil || null;
}

/**
 * Ambil data yang HANYA ada di HTML. Terverifikasi tidak ada di REST:
 *   - rating & jumlah vote  -> microdata schema.org `itemprop="ratingValue"`
 *   - durasi                -> `<span class="gmr-duration-item" property="duration">`
 *   - iframe player         -> `<div class="gmr-embed-responsive"><iframe src=...>`
 *
 * Nilai iframe stabil (diuji 3x request halaman sama -> URL identik), jadi
 * tidak ada rotasi yang perlu diakali.
 */
export async function getDetailHtml(url) {
  const { html, url: final } = await htmlGet(url);
  const iframe = [...html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)]
    .map((m) => m[1])
    .filter((u) => !/facebook|disqus|google|youtube\.com\/embed\/subscribe/i.test(u));
  const rating = ambilAttr(html, /itemprop="ratingValue"[^>]*>([^<]+)/i);
  const vote = ambilAttr(html, /itemprop="ratingCount"[^>]*>([^<]+)/i);
  // Tema muvipro menyelipkan <svg> ikon SEBELUM teks di dalam span yang sama,
  // jadi teksnya harus diambil setelah svg ditutup — bukan langsung setelah `>`.
  // Regex naif `>([^<]+)` cuma menangkap awal tag svg dan menghasilkan null.
  const durasi = ambilTeksSetelahIkon(html, "gmr-duration-item");
  const kualitas = ambilAttr(html, /class="gmr-quality-item"[^>]*>\s*<a[^>]*>([^<]+)/i);
  // CATATAN: `gmr-numbeps` (jumlah episode) SENGAJA TIDAK dipakai. Terbukti
  // class itu muncul di kartu rekomendasi di sidebar, bukan di artikel utama —
  // di halaman film "Borderlands (2024)" ia mengembalikan "Eps:8" milik serial
  // lain. Jumlah episode yang benar dihitung dari daftarEpisodeDariHtml().
  const judul = ambilAttr(html, /<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]+)/i);
  return {
    url: final,
    judul,
    rating: rating ? Number(rating) : null,
    jumlahVote: vote ? Number(vote.replace(/\D/g, "")) : null,
    durasi: durasi || null,
    kualitas: kualitas || null,
    jumlahEpisodeHtml: null, // sengaja tidak diisi; lihat catatan gmr-numbeps di atas
    iframePlayer: iframe[0] ?? null,
    semuaIframe: iframe,
    episode: daftarEpisodeDariHtml(html),
  };
}

/**
 * Daftar episode dari blok `<div class="gmr-listseries">` (ada di halaman serial
 * MAUPUN halaman episode). Label aslinya berbentuk "S1 Eps3"; tombol pertama
 * ("Streaming Episode =>") menunjuk halaman serial, bukan episode, jadi dibuang.
 */
export function daftarEpisodeDariHtml(html) {
  const teks = String(html ?? "");
  const i = teks.indexOf("gmr-listseries");
  if (i < 0) return [];
  const blok = teks.slice(i, i + 20000);
  const out = [];
  const seen = new Set();
  for (const m of blok.matchAll(/href="([^"]*\/eps\/[^"]+)"[^>]*>([^<]{1,40})</gi)) {
    const url = normHost(m[1]);
    // Buang: feed RSS, dan tautan anchor form komentar ("Batalkan balasan" ->
    // `/eps/<slug>/#respond`) yang kalau lolos akan muncul sebagai episode palsu
    // dengan season/episode null. Keduanya terbukti ada di HTML nyata.
    if (!url || /\/feed\/?$/.test(url) || url.includes("#") || seen.has(url)) continue;
    seen.add(url);
    const label = bersih(m[2]);
    const cocok = label.match(/S\s*(\d+)\s*Eps?\s*(\d+)/i);
    out.push({
      label,
      season: cocok ? Number(cocok[1]) : null,
      episode: cocok ? Number(cocok[2]) : null,
      slug: url.replace(/^.*\/eps\//, "").replace(/\/+$/, ""),
      url,
    });
  }
  return out;
}

/**
 * Detail lengkap: gabungan REST (metadata + download) dan HTML (rating, durasi,
 * iframe). Dua request per judul — tidak bisa satu, karena datanya memang
 * terpisah di dua tempat.
 */
export async function getDetail(slug, tipe = "movie") {
  const item = await getBySlug(slug, tipe);
  if (!item) return null;
  const h = await getDetailHtml(item.url);
  return {
    ...item,
    rating: h.rating,
    jumlahVote: h.jumlahVote,
    durasi: h.durasi,
    kualitas: h.kualitas,
    iframePlayer: h.iframePlayer,
    semuaIframe: h.semuaIframe,
    episode: h.episode,
    sumber: { rest: `${REST}/${POST_TYPE[cekTipe(tipe)]}?slug=${item.slug}`, html: h.url },
  };
}

/** Semua episode satu serial: daftar dari HTML serial, lalu detail per episode. */
export async function semuaEpisode(slugSerial, { batas = 0, ambilPlayer = true } = {}) {
  const serial = await getBySlug(slugSerial, "tv");
  if (!serial) throw new ApiError(`${REST}/tv?slug=${slugSerial}`, `Serial "${slugSerial}" tidak ditemukan.`);
  const h = await getDetailHtml(serial.url);
  let daftarEps = h.episode;
  if (batas > 0) daftarEps = daftarEps.slice(0, batas);
  const hasil = [];
  const gagal = [];
  for (const e of daftarEps) {
    try {
      const eps = ambilPlayer ? await getDetail(e.slug, "episode") : await getBySlug(e.slug, "episode");
      // JANGAN spread mentah: `e.episode` = nomor episode (angka), sedangkan
      // `eps.episode` = daftar episode hasil parsing HTML (array). Spread naif
      // membuat nomor episode tertimpa array dan outputnya jadi "S1E[{...}]".
      const { episode: _daftarUlang, ...detail } = eps ?? {};
      hasil.push({ ...detail, label: e.label, season: e.season, episode: e.episode, url: e.url });
    } catch (err) {
      gagal.push({ slug: e.slug, alasan: err.message });
    }
  }
  return {
    serial: { id: serial.id, judul: serial.judul, slug: serial.slug, url: serial.url },
    jumlahEpisode: hasil.length,
    gagal,
    hasil,
  };
}

export { ApiError, HttpError, BASE, REST, bersih, normHost, ambilDownload };
