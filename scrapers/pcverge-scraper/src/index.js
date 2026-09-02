// pcverge-scraper: pembungkus REST WordPress + admin-ajax + parser HTML untuk
// pcverge.com (film, serial, episode).
//
// PERINGATAN ISI: katalog situs ini MENCAMPUR film umum dengan konten dewasa
// (kategori `film-semi` dan sejenisnya). Scraper ini tidak memfilter apa pun —
// keluarannya mengikuti apa yang ada di upstream. Lihat README bagian
// "Peringatan isi" sebelum memakai keluarannya di aplikasi publik.
//
// PEMBAGIAN TUGAS yang sudah diukur, bukan asumsi:
//
//   REST /wp-json/wp/v2/*     -> katalog, judul, slug, tanggal, poster, taksonomi
//   POST admin-ajax.php       -> iframe player (5 server)
//   HTML halaman              -> rating, durasi, kualitas, tautan download
//
// Bukti pembagian itu:
//   - `content.rendered` di sini cuma ~100 karakter (satu paragraf sinopsis).
//     TIDAK ada `<iframe>`, tidak ada tautan download. Beda dari narashika.top
//     yang menaruh tautan download di `content.rendered`.
//   - Player disimpan di 5 div KOSONG (`<div id="p1" class="tab-content-ajax">`)
//     yang diisi lewat AJAX. Endpointnya:
//     `POST admin-ajax.php` body `action=muvipro_player_content&tab=pN&post_id=ID`.
//   - `post_id` untuk AJAX = **`id` dari REST**, dikonfirmasi sama dengan
//     `data-id` di HTML (film 104124, episode 104277). Jadi player bisa diambil
//     TANPA mengunduh HTML sama sekali — satu POST ~200 byte per server.
//   - Tidak ada field `views` di post type mana pun (32 key di `posts`), jadi
//     tidak ada dasar untuk fungsi "terpopuler".

import { restGet, htmlGet, ajaxPost, ApiError, HttpError, BASE, REST, AJAX } from "./http.js";

/** Batas keras REST WordPress: `per_page=101` -> 400 `rest_invalid_param`. */
export const MAX_PER_PAGE = 100;

/** Jumlah tab player yang dirender tema (id `player1`..`player5`). */
export const JUMLAH_SERVER = 5;

/**
 * Post type di situs ini (dari `/wp-json/wp/v2/types`).
 * Angka = X-WP-Total pada 2026-09-01, dipakai sebagai patokan besaran di test.
 */
export const POST_TYPE = Object.freeze({
  movie: "posts", // 9.878 film
  tv: "tv", // 1.368 serial
  episode: "episode", // 13.776 episode
  blog: "blogs", // 1 (praktis kosong)
});

/**
 * Taksonomi yang terdaftar, beserta prefix URL arsip publiknya.
 *
 * `rest_base` (untuk REST) berbeda dari prefix URL publik pada taksonomi
 * `muvi*`: `muvicast` -> `/cast/`, `muviyear` -> `/year/`, `categories` ->
 * `/genre/`. Jangan disamakan.
 *
 * `jumlah` = X-WP-Total per 2026-09-01. Catat: `muvidirector` **5.294 term**
 * walau `HEAD ?per_page=1` sempat tidak mengirim header — nilainya diambil dari
 * request GET biasa. Jangan percaya HEAD saja.
 */
export const TAKSONOMI = Object.freeze({
  categories: { rest: "categories", url: "genre", untuk: ["movie", "tv"], jumlah: 47 },
  tags: { rest: "tags", url: "tag", untuk: ["movie", "tv"], jumlah: 249 },
  director: { rest: "muvidirector", url: "director", untuk: ["movie", "tv"], jumlah: 5294 },
  cast: { rest: "muvicast", url: "cast", untuk: ["movie", "tv"], jumlah: 14277 },
  year: { rest: "muviyear", url: "year", untuk: ["movie", "tv"], jumlah: 84 },
  country: { rest: "muvicountry", url: "country", untuk: ["movie", "tv"], jumlah: 119 },
  network: { rest: "muvinetwork", url: "network", untuk: ["tv"], jumlah: 141 },
  quality: { rest: "muviquality", url: "quality", untuk: ["movie", "tv", "episode"], jumlah: 13 },
  index: { rest: "muviindex", url: "index", untuk: ["movie", "tv"], jumlah: 36 },
});

/** `orderby` yang TERBUKTI diterima (diuji satu per satu). */
export const ORDERBY = ["date", "modified", "title", "id", "slug"];

/**
 * `orderby` yang DITOLAK upstream, dicatat supaya tidak dicoba lagi:
 *   views     -> 400 rest_invalid_param  (dan fieldnya pun tidak ada)
 *   relevance -> 400 rest_no_search_term_defined (hanya sah bersama `search`)
 *   include   -> 400 rest_orderby_include_missing_include (butuh `include=`)
 */
export const ORDERBY_DITOLAK = ["views", "relevance (tanpa search)", "include (tanpa include=)"];

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
    .replace(/&#8217;|&#039;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&hellip;/g, "…")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Normalkan host varian ke BASE. */
function normHost(u) {
  if (!u) return null;
  return String(u).replace(/^https?:\/\/(?:www\.)?pcverge\.com/i, BASE);
}

/** Normalisasi satu item REST (berlaku untuk posts/tv/episode). */
function normItem(x, tipe) {
  const emb = x._embedded ?? {};
  const media = emb["wp:featuredmedia"]?.[0];
  const terms = (emb["wp:term"] ?? []).flat();
  return {
    id: x.id ?? null,
    tipe,
    slug: x.slug ?? null,
    judul: bersih(x.title?.rendered),
    url: normHost(x.link),
    tanggal: x.date ?? null,
    diubah: x.modified ?? null,
    sinopsis: bersih(x.excerpt?.rendered) || bersih(x.content?.rendered) || null,
    poster: media?.source_url ? normHost(media.source_url) : null,
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
    // Sengaja TIDAK diisi di sini — sumbernya bukan REST.
    rating: null,
    durasi: null,
    kualitas: null,
    server: null,
    download: null,
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
 * @param {"movie"|"tv"|"episode"|"blog"} tipe
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

/** Film (post type `posts`). Kontennya campur umum dan dewasa — lihat README. */
export const getFilm = (opsi = {}) => daftar("movie", opsi);

/** Serial/drama (post type `tv`). */
export const getSerial = (opsi = {}) => daftar("tv", opsi);

/** Episode terbaru lintas serial (post type `episode`). */
export const getEpisode = (opsi = {}) => daftar("episode", opsi);

/** Post type `blogs` — terdaftar tapi praktis kosong (1 item). */
export const getBlog = (opsi = {}) => daftar("blog", opsi);

/**
 * Filter berdasarkan taksonomi. Kunci = nama di TAKSONOMI (genre pakai
 * `categories`). Nilai boleh id angka atau array id.
 *
 * Terverifikasi: taksonomi `muvi*` bisa dipakai sebagai query param di `posts`
 * maupun `tv` (mis. `?muviyear=<id>`).
 *
 * Catat: **id term tidak boleh ditebak** — `muvicountry?per_page=1` mengembalikan
 * term ber-tahun (slug `2017`) karena urut default-nya aneh. Selalu ambil id
 * lewat `getTerm()`, atau pakai `filterBySlug()`.
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

/** Cari judul di satu post type. */
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

/** Cari lintas semua post type lewat `/wp/v2/search`. Respons ringkas. */
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

/** Ambil satu item berdasarkan slug (null kalau tidak ada). */
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
  if (!Number.isInteger(n) || n < 1) {
    throw new TypeError(`id harus bilangan bulat >= 1 (dapat: ${id})`);
  }
  const t = cekTipe(tipe);
  const res = await restGet(`${POST_TYPE[t]}/${n}`, { [FIELD_EMBED]: 1 });
  return normItem(res.data, t);
}

// ────────────────────────────── TAKSONOMI (REST) ──────────────────────────────

/**
 * Daftar term satu taksonomi.
 *
 * `url` term dibangun dari prefix arsip publik yang sudah diverifikasi
 * (`TAKSONOMI[x].url`), BUKAN dari field `link` upstream — supaya konsisten
 * walau upstream sempat mengirim host/permalink lain.
 */
export async function getTerm(nama, { page = 1, perPage = 100, orderby = "count", order = "desc", cari: q = null } = {}) {
  const def = TAKSONOMI[nama];
  if (!def) {
    throw new TypeError(`taksonomi "${nama}" tidak dikenal. Yang ada: ${Object.keys(TAKSONOMI).join(", ")}.`);
  }
  const p = cekHalaman(page);
  const pp = cekPerPage(perPage);
  const res = await restGet(def.rest, {
    page: p,
    per_page: pp,
    orderby,
    order,
    search: q || undefined,
    _fields: "id,name,slug,count,description",
  });
  const arr = Array.isArray(res.data) ? res.data : [];
  return {
    taksonomi: nama,
    restBase: def.rest,
    prefixUrl: `/${def.url}/`,
    untuk: def.untuk,
    jumlah: arr.length,
    halaman: p,
    totalItem: res.total,
    totalHalaman: res.totalHalaman,
    sumber: res.url,
    hasil: arr.map((t) => ({
      id: t.id ?? null,
      nama: bersih(t.name),
      slug: t.slug ?? null,
      jumlahPost: t.count ?? null,
      url: t.slug ? `${BASE}/${def.url}/${t.slug}/` : null,
    })),
  };
}

/** Alias genre = taksonomi `categories` (URL publiknya `/genre/`). */
export const getGenre = (opsi = {}) => getTerm("categories", opsi);

/**
 * Resolusi slug term -> id, lalu filter.
 *
 * Melempar ApiError kalau slug tidak ada, karena memfilter dengan id ngawur
 * membalas **200 + 0 hasil** (gagal senyap yang gampang disalahartikan
 * sebagai "kategori ini kosong").
 */
export async function filterBySlug(tipe, namaTaks, slug, opsi = {}) {
  const def = TAKSONOMI[namaTaks];
  if (!def) {
    throw new TypeError(`taksonomi "${namaTaks}" tidak dikenal. Yang ada: ${Object.keys(TAKSONOMI).join(", ")}.`);
  }
  const s = String(slug ?? "").trim();
  if (!s) throw new TypeError("slug term tidak boleh kosong.");
  const res = await restGet(def.rest, { slug: s, per_page: 1, _fields: "id,name,slug,count" });
  const arr = Array.isArray(res.data) ? res.data : [];
  if (!arr.length) {
    throw new ApiError(res.url, `Term "${s}" tidak ada di taksonomi "${namaTaks}".`, "term_tidak_ada");
  }
  const term = arr[0];
  const out = await filter(tipe, { [namaTaks]: term.id }, opsi);
  out.term = { id: term.id, nama: bersih(term.name), slug: term.slug, jumlahPost: term.count ?? null };
  out.urlArsip = `${BASE}/${def.url}/${term.slug}/`;
  return out;
}

// ─────────────────── PLAYER via admin-ajax (tanpa unduh HTML) ───────────────────

/**
 * Ambil iframe player satu tab.
 *
 * `postId` = `id` REST. Sudah dikonfirmasi identik dengan `data-id` di
 * `<div id="muvipro_player_content_id" data-id="...">` pada HTML (film 104124,
 * episode 104277), jadi tidak perlu mengunduh halaman 150 KB hanya untuk
 * mendapatkan angka itu.
 *
 * Balasannya potongan HTML ~200 byte berisi satu `<iframe>`. Terukur: **tidak
 * butuh nonce**, dan referer pun tidak wajib.
 */
export async function getPlayer(postId, tab = 1) {
  const n = Number(postId);
  if (!Number.isInteger(n) || n < 1) throw new TypeError(`postId harus bilangan bulat >= 1 (dapat: ${postId})`);
  const idx = Number(tab);
  if (!Number.isInteger(idx) || idx < 1) throw new TypeError(`tab harus bilangan bulat >= 1 (dapat: ${tab})`);

  const { html, url } = await ajaxPost({
    action: "muvipro_player_content",
    tab: `p${idx}`,
    post_id: String(n),
  });
  const src = html.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] ?? null;
  return {
    tab: idx,
    label: `Server ${idx}`,
    embed: src,
    host: src ? hostDari(src) : null,
    kosong: !src,
    sumber: url,
    mentah: html.length <= 400 ? html.trim() : `${html.slice(0, 400).trim()}…`,
  };
}

function hostDari(u) {
  try {
    return new URL(u, BASE).host;
  } catch {
    return null;
  }
}

/**
 * Ambil semua server player satu item (default 5 tab, sesuai jumlah tab yang
 * dirender tema). Tab yang balasannya tanpa iframe dibuang dari `server` dan
 * dicatat di `tabKosong` — bukan dijadikan entri null.
 */
export async function getSemuaPlayer(postId, { maksTab = JUMLAH_SERVER } = {}) {
  return ambilPlayerTab(
    postId,
    Array.from({ length: maksTab }, (_, i) => i + 1),
  );
}

/** Ambil sekumpulan tab tertentu (dipakai kalau daftar tab sudah diketahui). */
export async function ambilPlayerTab(postId, daftarTab) {
  const hasil = [];
  const kosong = [];
  for (const i of daftarTab) {
    // Transport sudah mengantre, jadi loop ini otomatis serial + berjeda.
    const p = await getPlayer(postId, i);
    if (p.embed) hasil.push({ tab: p.tab, label: p.label, embed: p.embed, host: p.host });
    else kosong.push(p.tab);
  }
  return { postId: Number(postId), jumlahServer: hasil.length, server: hasil, tabKosong: kosong };
}

// ───────────────────────────── PARSER HTML ─────────────────────────────
//
// Yang HANYA ada di HTML: rating + jumlah vote, durasi, kualitas, tautan
// download, dan daftar episode. Sisanya sudah dicukupi REST.

/** Buang blok `<svg>...</svg>` sebelum regex teks dijalankan. */
function buangSvg(s) {
  return String(s ?? "").replace(/<svg[\s\S]*?<\/svg>/gi, " ");
}

/**
 * Potong wilayah artikel utama.
 *
 * WAJIB dilakukan sebelum parsing apa pun. Kelas `gmr-rating-item`,
 * `gmr-duration-item`, dan `gmr-quality-item` muncul **15–18 kali** di satu
 * halaman, dan SEMUANYA milik kartu rekomendasi di bawah/samping artikel —
 * nol di artikel utama. Kalau di-regex mentah, yang kepanen adalah rating film
 * lain (terukur: `9.2` dari kartu "APNS-419", padahal film yang dibuka 9.0).
 *
 * Artikel utama di sini memakai pola berbeda: `gmr-moviedata` dengan pasangan
 * `<strong>Label:</strong>`.
 */
function potongArtikel(html) {
  const h = String(html ?? "");
  const mulai = h.indexOf("<article");
  if (mulai < 0) return h;
  const kandidat = ['class="gmr-related', "gmr-related", "idmuvi-rp", 'id="sidebar']
    .map((p) => h.indexOf(p, mulai))
    .filter((i) => i > mulai);
  const akhir = kandidat.length ? Math.min(...kandidat) : h.length;
  return h.slice(mulai, akhir);
}

/**
 * Baca pasangan `<strong>Label:</strong> nilai` dari blok `gmr-moviedata`.
 * Label yang terukur ada: By, Posted on, Views, Genre, Quality, Year,
 * Duration, Country, Director, Cast.
 */
function ambilMovieData(mainHtml) {
  const out = {};
  const re = /<div class="gmr-moviedata[^"]*">\s*<strong>([^<]*)<\/strong>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(mainHtml)) !== null) {
    const label = bersih(m[1]).replace(/:$/, "").toLowerCase();
    const isi = m[2];
    const tautan = [...isi.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((a) => ({
      nama: bersih(a[2]),
      url: normHost(a[1]),
    }));
    out[label] = { teks: bersih(buangSvg(isi)), tautan };
  }
  return out;
}

/** Ambil daftar nama dari satu label taksonomi (Genre/Cast/Director/dst). */
function namaDari(md, label) {
  const blok = md[label];
  if (!blok) return [];
  if (blok.tautan.length) return blok.tautan.map((t) => t.nama).filter(Boolean);
  return blok.teks
    ? blok.teks.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean)
    : [];
}

function angkaDari(teks) {
  const m = String(teks ?? "").match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Ambil tautan download dari blok `gmr-download-wrap`.
 *
 * Teks anchor-nya BUKAN label yang berguna — isinya instruksi iklan
 * ("CLOSE 2X/3X TAB IKLAN…") yang sama untuk semua tautan. Urutan/nomor diambil
 * dari atribut `title` ("Download link 1 …"). Host terukur: veev.to,
 * morencius.com, hgcloud.to. Berbeda dari narashika.top yang mengelompokkan
 * per resolusi; di sini tidak ada pengelompokan resolusi.
 */
export function ambilDownload(html) {
  const h = String(html ?? "");
  const i = h.indexOf("gmr-download-wrap");
  if (i < 0) return [];
  const j = h.indexOf("gmr-download-list", i);
  if (j < 0) return [];
  const akhirUl = h.indexOf("</ul>", j);
  const blok = h.slice(j, akhirUl < 0 ? j + 6000 : akhirUl);

  const hasil = [];
  const re = /<a[^>]+href=["'](https?:\/\/[^"']+)["']([^>]*)>/gi;
  let m;
  while ((m = re.exec(blok)) !== null) {
    const url = m[1];
    if (/pcverge\.com|t\.me|telegram|trakteer/i.test(url)) continue; // tautan internal/donasi
    const title = bersih(m[2].match(/title=["']([^"']*)["']/i)?.[1] ?? "");
    hasil.push({
      nomor: angkaDari(title.match(/link\s*(\d+)/i)?.[1] ?? "") ?? hasil.length + 1,
      url,
      host: hostDari(url),
      judulTautan: title || null,
    });
  }
  return hasil;
}

/**
 * Daftar episode dari `gmr-listseries`.
 *
 * Anchor pertama ("View All Episodes") menunjuk ke halaman serial, bukan
 * episode — dibuang lewat filter pola `/eps/`. Tautan ber-`#` dan `/feed/`
 * juga dibuang (pengaman terhadap anchor komentar/feed).
 */
export function daftarEpisodeDariHtml(html) {
  const h = String(html ?? "");
  const i = h.indexOf("gmr-listseries");
  if (i < 0) return [];
  const blok = h.slice(i, i + 40000);
  const out = [];
  const lihat = new Set();
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(blok)) !== null) {
    const url = normHost(m[1]);
    if (!url || !url.includes("/eps/")) continue;
    if (url.includes("#") || url.includes("/feed/")) continue;
    if (lihat.has(url)) continue;
    lihat.add(url);
    const label = bersih(buangSvg(m[2]));
    const s = label.match(/S(\d+)/i)?.[1] ?? url.match(/season-(\d+)/i)?.[1] ?? null;
    const e = label.match(/Eps?\s*(\d+)/i)?.[1] ?? url.match(/episode-(\d+)/i)?.[1] ?? null;
    out.push({
      label: label || null,
      season: s ? Number(s) : null,
      episode: e ? Number(e) : null,
      slug: url.replace(/\/+$/, "").split("/").pop(),
      url,
    });
  }
  return out.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
}

/**
 * Ambil bagian yang hanya ada di HTML. `postId` dibaca dari
 * `<div id="muvipro_player_content_id" data-id="...">` — dipakai kalau
 * pemanggil belum punya id REST.
 */
export async function getDetailHtml(url) {
  const { html, url: final } = await htmlGet(url);
  const main = potongArtikel(html);
  const md = ambilMovieData(main);

  const rating = angkaDari(main.match(/itemprop=["']ratingValue["'][^>]*>([^<]+)/i)?.[1]);
  const vote = angkaDari(main.match(/itemprop=["']ratingCount["'][^>]*>([^<]+)/i)?.[1]);
  const postId = angkaDari(html.match(/id=["']muvipro_player_content_id["'][^>]*data-id=["'](\d+)["']/i)?.[1]);
  const tabPlayer = [...new Set([...html.matchAll(/id=["']player(\d+)["']/gi)].map((m) => Number(m[1])))].sort(
    (a, b) => a - b,
  );

  return {
    sumber: final,
    postId,
    rating,
    jumlahVote: vote,
    durasi: md.duration?.teks ?? null,
    kualitas: md.quality?.teks ?? null,
    tahun: angkaDari(md.year?.teks),
    negara: namaDari(md, "country"),
    genre: namaDari(md, "genre"),
    sutradara: namaDari(md, "director"),
    pemain: namaDari(md, "cast"),
    // Label berikut hanya muncul di sebagian tipe halaman:
    //   film    : Genre, Quality, Year, Duration, Country, Director, Cast
    //   serial  : + Release, Last Air Date, Number Of Episode, Network
    //   episode : Episode Name, Quality, Release (TIDAK ada Duration/Genre)
    // Yang tidak ada dibiarkan null/[] — bukan diisi tebakan.
    jaringan: namaDari(md, "network"),
    rilis: md.release?.teks ?? null,
    tayangTerakhir: md["last air date"]?.teks ?? null,
    jumlahEpisodeMeta: angkaDari(md["number of episode"]?.teks),
    namaEpisode: md["episode name"]?.teks ?? null,
    // Plugin Post Views Counter memuat angkanya lewat AJAX terpisah; di HTML
    // awal nilainya selalu 0. Tidak dipakai sebagai metrik populer.
    viewsHtml: angkaDari(md.views?.teks),
    tabPlayer,
    download: ambilDownload(html),
    episode: daftarEpisodeDariHtml(html),
  };
}

// ──────────────────────── GABUNGAN: REST + AJAX + HTML ────────────────────────

/**
 * Detail lengkap satu judul.
 *
 * Biaya request: 1 REST (katalog+taksonomi) + 1 HTML (rating/durasi/download)
 * + N AJAX (player, default 5) = 7 request. HTML tetap diunduh karena
 * rating/durasi/kualitas/download memang tidak ada di REST.
 *
 * `postId` untuk AJAX diambil dari REST — HTML tidak wajib berhasil supaya
 * data tetap keluar walau halaman berubah bentuk. Kegagalan HTML dicatat di
 * `catatan`, bukan disembunyikan.
 */
export async function getDetail(slug, tipe = "movie", { player = true, maksTab = JUMLAH_SERVER } = {}) {
  const t = cekTipe(tipe);
  const item = await getBySlug(slug, t);
  if (!item) throw new ApiError(`${REST}/${POST_TYPE[t]}?slug=${slug}`, `Slug "${slug}" tidak ada di tipe "${t}".`, "tidak_ada");

  const catatan = [];
  let html = null;
  try {
    html = await getDetailHtml(item.url);
  } catch (e) {
    catatan.push(`HTML gagal diambil (${e.name}: ${e.message}) — rating/durasi/download tidak tersedia.`);
  }

  let server = [];
  let tabKosong = [];
  const postId = item.id ?? html?.postId ?? null;

  // Tab yang ditembak dibatasi ke tab yang MEMANG dirender halaman
  // (`id="playerN"`). Halaman serial (`tv`) tidak merender tab player sama
  // sekali — player-nya ada di halaman episode. Tanpa pembatasan ini, tiap
  // serial memicu 5 POST AJAX sia-sia dan `tabKosong` terisi [1..5] yang
  // menyesatkan (seolah player ada tapi rusak).
  //
  // `null` = HTML gagal diambil (tab tidak diketahui) -> coba semua tab.
  // `[]`   = HTML berhasil TAPI tidak ada tab -> jangan tembak AJAX sama sekali.
  const tabTersedia = html ? html.tabPlayer.filter((n) => n <= maksTab) : null;

  if (player && postId && (tabTersedia === null || tabTersedia.length > 0)) {
    const p = tabTersedia
      ? await ambilPlayerTab(postId, tabTersedia)
      : await getSemuaPlayer(postId, { maksTab });
    server = p.server;
    tabKosong = p.tabKosong;
    if (!server.length) catatan.push("Semua tab player balik tanpa iframe.");
  } else if (player && postId) {
    catatan.push(
      "Halaman ini tidak merender tab player (tidak ada id=\"playerN\"); untuk serial, player ada di halaman episode.",
    );
  }

  return {
    ...item,
    rating: html?.rating ?? null,
    jumlahVote: html?.jumlahVote ?? null,
    durasi: html?.durasi ?? null,
    kualitas: html?.kualitas ?? null,
    tahun: html?.tahun ?? null,
    negara: html?.negara ?? [],
    genre: html?.genre ?? [],
    sutradara: html?.sutradara ?? [],
    pemain: html?.pemain ?? [],
    jaringan: html?.jaringan ?? [],
    rilis: html?.rilis ?? null,
    tayangTerakhir: html?.tayangTerakhir ?? null,
    jumlahEpisodeMeta: html?.jumlahEpisodeMeta ?? null,
    namaEpisode: html?.namaEpisode ?? null,
    // Angka views di HTML awal selalu 0 (plugin memuatnya lewat AJAX terpisah),
    // jadi tidak ada metrik popularitas yang bisa dipercaya di situs ini.
    views: null,
    jumlahServer: server.length,
    server,
    tabKosong,
    download: html?.download ?? [],
    daftarEpisode: html?.episode ?? [],
    catatan: catatan.length ? catatan : null,
    sumber: { rest: item.url, html: html?.sumber ?? null, ajax: AJAX },
  };
}

/**
 * Semua episode satu serial, lengkap dengan player tiap episode.
 *
 * Daftar episode diambil dari HTML halaman serial (`gmr-listseries`) karena REST
 * `episode` tidak menyimpan relasi ke serial induk dalam bentuk yang bisa
 * difilter. `batas` wajib dipakai untuk serial panjang — tiap episode makan
 * 1 REST + N AJAX.
 */
export async function semuaEpisode(slugSerial, { batas = 0, maksTab = JUMLAH_SERVER } = {}) {
  const serial = await getBySlug(slugSerial, "tv");
  if (!serial) {
    throw new ApiError(`${REST}/tv?slug=${slugSerial}`, `Serial "${slugSerial}" tidak ada.`, "tidak_ada");
  }
  const halaman = await getDetailHtml(serial.url);
  let daftarEps = halaman.episode;
  if (batas > 0) daftarEps = daftarEps.slice(0, batas);

  const hasil = [];
  const gagal = [];
  for (const e of daftarEps) {
    try {
      const item = await getBySlug(e.slug, "episode");
      const postId = item?.id ?? null;
      const p = postId ? await getSemuaPlayer(postId, { maksTab }) : { server: [], tabKosong: [] };
      // Merge selektif: JANGAN spread `item` mentah, karena field `episode`
      // pada item REST bisa menimpa nomor episode hasil parsing daftar.
      hasil.push({
        id: postId,
        label: e.label,
        season: e.season,
        episode: e.episode,
        slug: e.slug,
        url: e.url,
        judul: item?.judul ?? null,
        tanggal: item?.tanggal ?? null,
        jumlahServer: p.server.length,
        server: p.server,
      });
    } catch (err) {
      gagal.push({ slug: e.slug, alasan: `${err.name}: ${err.message}` });
    }
  }

  return {
    serial: { id: serial.id, judul: serial.judul, slug: serial.slug, url: serial.url },
    totalEpisodeDiHalaman: halaman.episode.length,
    jumlahEpisode: hasil.length,
    gagal,
    episode: hasil,
  };
}

/** Peta route/endpoint yang dipakai scraper ini — buat dokumentasi cepat. */
export function route() {
  return {
    base: BASE,
    rest: REST,
    ajax: AJAX,
    ajaxAction: "muvipro_player_content (field: action, tab=pN, post_id)",
    postType: POST_TYPE,
    urlDetail: {
      film: `${BASE}/<kategori>/<slug>/  (prefix kategori diabaikan server — slug yang menentukan)`,
      serial: `${BASE}/tv/<slug>/`,
      episode: `${BASE}/eps/<slug>/`,
    },
    batas: { perPage: MAX_PER_PAGE, orderbySah: ORDERBY, orderbyDitolak: ORDERBY_DITOLAK },
    taksonomi: Object.fromEntries(
      Object.entries(TAKSONOMI).map(([k, v]) => [
        k,
        { rest: v.rest, url: `/${v.url}/`, untuk: v.untuk, jumlah: v.jumlah },
      ]),
    ),
  };
}

export {
  ApiError,
  HttpError,
  BASE,
  REST,
  AJAX,
  bersih,
  normHost,
  buangSvg,
  potongArtikel,
  ambilMovieData,
  angkaDari,
  hostDari,
  restGet,
  htmlGet,
  ajaxPost,
};
