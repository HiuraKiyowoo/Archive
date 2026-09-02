# pcverge-scraper

Scraper untuk **pcverge.com** (branding: *LK21 / Layarkaca21*) — WordPress + tema
**muvipro**. Zero dependency, cuma butuh Node 18+ (pakai `fetch` bawaan).

---

## ⚠️ PERINGATAN ISI: KATALOG MEMUAT KONTEN DEWASA

**Situs ini mencampur film umum dengan konten dewasa (film semi / JAV) di satu
katalog yang sama.** Ini bukan kategori terpisah yang bisa diabaikan — kontennya
ada di aliran utama:

- Genre `film-semi` berisi **3.156 judul**, `semi-jepang` **2.073 judul**,
  `film-jepang` **2.206 judul** — semuanya termasuk 5 genre terbesar di situs.
- Post **terbaru** yang keluar dari `getFilm()` tanpa filter apa pun seringkali
  judul dewasa, karena upstream memposting kategori itu paling sering.
- Judul, sinopsis, poster, dan nama pemain di kategori tersebut bersifat eksplisit.

**Scraper ini tidak memfilter apa pun** — keluarannya persis mengikuti upstream.
Konsekuensi yang perlu dipertimbangkan sebelum memakainya:

- Jangan tampilkan hasil mentah `getFilm()` / `getEpisode()` / `cariSemua()` di
  antarmuka publik, aplikasi anak, atau demo, tanpa penyaringan sendiri.
- Kalau butuh keluaran aman, saring **berdasarkan id term genre** (ambil daftarnya
  dengan `getGenre()`, lalu buang id genre dewasa dari hasil). Menyaring
  berdasarkan kata di judul tidak cukup andal.
- Log test live sengaja menampilkan judul apa adanya (lihat `test/live.test.js`),
  jadi output test pun bisa memuat teks eksplisit.

Selain itu, situs ini mendistribusikan film/serial berhak cipta tanpa lisensi.
Scraper ini dibuat untuk keperluan analisis teknis. Pemakaiannya jadi tanggung
jawab pemakai.

---

## Etika & robots.txt

`robots.txt` pcverge.com:

```
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
```

Dua jalur yang dipakai scraper ini dua-duanya sah:

- `/wp-json/wp/v2/*` — **tidak** dilarang.
- `/wp-admin/admin-ajax.php` — **diizinkan secara eksplisit** lewat `Allow:`.

Transport-nya sopan: 1 koneksi, **serial**, jeda **900 ms** antar request, nol
paralelisme, dan cache dalam-proses supaya URL yang sama tidak diambil dua kali.

---

## Skala katalog

Angka `X-WP-Total` per 2026-09-01:

| Post type | REST base | Jumlah |
|---|---|---|
| Film | `posts` | 9.878 |
| Serial | `tv` | 1.368 |
| Episode | `episode` | 13.776 |
| Blog | `blogs` | 1 |

Total **±25.023 entri**. Dengan `per_page=100` (batas maksimum), katalog penuh
butuh ±251 request — sekitar 4 menit dengan jeda 900 ms.

---

## Cara kerja: tiga sumber, masing-masing untuk hal berbeda

Pembagiannya diukur, bukan diasumsikan:

| Sumber | Menyediakan |
|---|---|
| `GET /wp-json/wp/v2/*` | katalog, judul, slug, tanggal, poster (`_embed`), id + nama taksonomi |
| `POST /wp-admin/admin-ajax.php` | **iframe player** (5 server) |
| `GET` halaman HTML | rating + jumlah vote, durasi, kualitas, tautan download, daftar episode |

**Kenapa tidak semua dari REST:** `content.rendered` di situs ini cuma ±100
karakter (satu paragraf sinopsis, isinya sama dengan `excerpt`). Tidak ada
`<iframe>`, tidak ada tautan download di dalamnya. Field `views` juga tidak ada
di post type mana pun.

**Kenapa player tidak perlu HTML:** player disimpan di 5 div kosong
(`<div id="p1" class="tab-content-ajax"></div>`) yang diisi lewat AJAX:

```
POST https://pcverge.com/wp-admin/admin-ajax.php
Content-Type: application/x-www-form-urlencoded

action=muvipro_player_content&tab=p1&post_id=104124
```

`post_id` itu **sama dengan `id` dari REST** (sudah dikonfirmasi: film 104124,
episode 104277 — `data-id` di HTML identik dengan id REST). Jadi player bisa
diambil tanpa mengunduh halaman 150 KB sama sekali: satu POST ±200 byte per
server, dan **tanpa nonce** (endpoint tidak memvalidasi apa pun).

Host embed yang terukur: `player.abyssplayer.com`, `embedpyrox.xyz`, `veev.to`,
`morencius.com`, `hgcloud.to`. Host download: `veev.to`, `morencius.com`,
`hgcloud.to`.

---

## Pemakaian CLI

```bash
cd scrapers/pcverge-scraper
node cli.js route                    # peta endpoint, post type, taksonomi, batas
node cli.js film --perPage 5         # daftar film
node cli.js serial --perPage 5       # daftar serial
node cli.js episode --perPage 5      # episode terbaru
node cli.js detail <slug>                        # film: REST + HTML + 5 player
node cli.js detail <slug> --tipe tv              # serial
node cli.js detail <slug> --tipe episode         # episode
node cli.js detail <slug> --no-player            # lewati AJAX player
node cli.js player 104124 --tab 3                # satu server saja
node cli.js semua-player 104124                  # semua server
node cli.js genre --perPage 10                   # daftar genre
node cli.js term cast --cari "yusuke"            # cari term di taksonomi
node cli.js filter movie categories drama        # filter via slug term
node cli.js filter tv network netflix
node cli.js cari-semua "avatar"                  # lintas post type
node cli.js all-episode <slugSerial> --batas 3   # episode + player masing-masing
```

JSON keluar di stdout, pesan status/error di stderr — jadi aman dipipe:

```bash
node cli.js film --perPage 50 | jq '.hasil[].judul'
```

## Pemakaian sebagai modul

```js
import { getFilm, getDetail, getSemuaPlayer, filterBySlug } from "./src/index.js";

const katalog = await getFilm({ perPage: 20, page: 1 });
const detail  = await getDetail("the-westies-2026", "tv");
const player  = await getSemuaPlayer(104124);          // 5 server
const drama   = await filterBySlug("movie", "categories", "drama", { perPage: 10 });
```

---

## Taksonomi

`rest_base` **berbeda** dari prefix URL arsip publik — jangan disamakan:

| Nama di scraper | REST base | URL arsip | Berlaku untuk | Term |
|---|---|---|---|---|
| `categories` | `categories` | `/genre/` | film, tv | 47 |
| `tags` | `tags` | `/tag/` | film, tv | 249 |
| `cast` | `muvicast` | `/cast/` | film, tv | 14.277 |
| `director` | `muvidirector` | `/director/` | film, tv | 5.294 |
| `year` | `muviyear` | `/year/` | film, tv | 84 |
| `country` | `muvicountry` | `/country/` | film, tv | 119 |
| `network` | `muvinetwork` | `/network/` | **tv saja** | 141 |
| `quality` | `muviquality` | `/quality/` | film, tv, episode | 13 |
| `index` | `muviindex` | `/index/` | film, tv | 36 |

Semua taksonomi `muvi*` berfungsi sebagai query filter di `posts` maupun `tv`.
`filterBySlug()` melempar `ApiError` kalau slug term tidak ada — karena memfilter
dengan id ngawur membalas **200 + 0 hasil**, gagal senyap yang gampang
disalahartikan sebagai "kategori ini kosong".

---

## Pola URL

- Film: `https://pcverge.com/<kategori>/<slug>/`
- Serial: `https://pcverge.com/tv/<slug>/`
- Episode: `https://pcverge.com/eps/<slug>/`

Segmen `<kategori>` pada URL film **diabaikan server** — `/xyzngawur/<slug>/`,
`/2026/<slug>/`, dan `/film-semi/<slug>/` semuanya membalas 200 dengan
`<link rel="canonical">` yang sama. Slug-nya yang menentukan. Scraper tetap
memakai `link` dari REST supaya konsisten dengan canonical.

---

## Batas & perilaku upstream yang sudah diuji

| Hal | Hasil |
|---|---|
| `per_page=101` | `400 rest_invalid_param` |
| `page` melewati halaman akhir | `400` (batas normal, jangan diretry) |
| `orderby` yang sah | `date`, `modified`, `title`, `id`, `slug` |
| `orderby=views` | `400 rest_invalid_param` |
| `orderby=relevance` tanpa `search` | `400 rest_no_search_term_defined` |
| `orderby=include` tanpa `include=` | `400 rest_orderby_include_missing_include` |
| Field `views` | **tidak ada** di post type mana pun |
| Nonce untuk `admin-ajax` | **tidak diperlukan** |
| Embed berotasi antar request? | Tidak — stabil |

**Tidak ada fungsi "terpopuler"** di scraper ini. Alasannya: field `views` tidak
ada di REST, `orderby=views` ditolak, dan angka "Views:" di HTML selalu `0`
karena plugin Post Views Counter memuatnya lewat AJAX terpisah. Mengurutkan
apa pun dan menyebutnya "populer" berarti menyajikan urutan palsu.

---

## Jebakan yang ditemukan (dan cara scraper ini mengatasinya)

1. **Kartu rekomendasi menyamar sebagai data artikel.** Kelas `gmr-rating-item`,
   `gmr-duration-item`, dan `gmr-quality-item` muncul **15–18 kali** per halaman,
   dan **nol** di antaranya milik artikel utama — semuanya kartu rekomendasi.
   Regex mentah memanen rating film lain (terukur: `9.2` dari kartu "APNS-419",
   padahal film yang dibuka `9.0`). Solusi: `potongArtikel()` memotong dari
   `<article` sampai sebelum `gmr-related`/`idmuvi-rp`/`sidebar` dulu; data
   artikel utama dibaca dari blok `gmr-moviedata` (`<strong>Label:</strong>`).

2. **Ikon `<svg>` menyempil sebelum teks.** Nilai `Duration:` dan tautan download
   diawali `<svg>...</svg>`, jadi pola naif `>([^<]+)` menangkap tag `<svg`
   dan menghasilkan `null`. Solusi: `buangSvg()` dijalankan sebelum regex teks.

3. **Halaman serial tidak punya tab player.** `id="playerN"` cuma ada di halaman
   film dan episode. Kalau tetap ditembak, tiap serial memicu 5 POST AJAX sia-sia
   dan `tabKosong` terisi `[1,2,3,4,5]` — seolah player-nya rusak. Solusi:
   `getDetail()` hanya menembak tab yang benar-benar dirender, dan menaruh
   penjelasan di `catatan` kalau memang tidak ada.

4. **Teks tautan download bukan label.** Semua anchor unduhan berteks sama
   ("CLOSE 2X/3X TAB IKLAN LALU BALIK KE LINK DOWNLOAD LAGI"). Nomor urutnya
   diambil dari atribut `title` ("Download link 1 …"). Tidak ada pengelompokan
   resolusi di situs ini.

5. **Label meta berbeda per tipe halaman.** Film punya Genre/Quality/Year/
   Duration/Country/Director/Cast; serial menambah Release, Last Air Date,
   Number Of Episode, Network; episode **tidak punya** Duration maupun Genre
   (yang ada: Episode Name, Quality, Release). Field yang tidak tersedia
   dibiarkan `null`/`[]`, tidak diisi tebakan.

6. **Anchor bukan-episode di daftar episode.** `gmr-listseries` diawali tombol
   "View All Episodes" yang menunjuk ke halaman serial. Tautan ber-`#` dan
   `/feed/` juga dibuang sebagai pengaman.

7. **`<meta generator>` bilang "WordPress 7.1"** — versi itu tidak ada. Jangan
   pakai nilai itu untuk mendeteksi kemampuan API.

8. **Urutan default term taksonomi tidak intuitif.** `muvicountry?per_page=1`
   sempat mengembalikan term ber-slug tahun. Jangan pernah menebak id term;
   ambil lewat `getTerm()` atau pakai `filterBySlug()`.

---

## Test

```bash
npm test              # 20 lokal + 30 live = 50 test
npm run test:lokal    # cuma fixture, tanpa jaringan
npm run test:live     # cuma yang menembak upstream
npm run check         # node --check semua file
```

- `test/index.test.js` — **20 test lokal**, murni fixture. Fixture-nya sengaja
  memuat kartu rekomendasi pengganggu, ikon `<svg>`, `href` kutip tunggal
  **dan** ganda, serta anchor `#respond`/`/feed/`.
- `test/live.test.js` — **30 test live** ke upstream: skala katalog, batas
  `per_page`/`page`/`orderby`, taksonomi + prefix URL, filter via slug, player
  AJAX 5 server, stabilitas embed, rating/durasi/download dari HTML, detail
  film/serial/episode, dan `semuaEpisode`.

Hasil terakhir: **50 pass / 0 fail**, 149 s (jeda sopan 900 ms mendominasi waktu).

Dipisah dua berkas supaya gangguan jaringan tidak terlihat seperti parser rusak.
Test live memakai batas bawah (`totalItem >= 9800`), bukan kesamaan persis,
karena situs terus memposting.

---

## Struktur

```
pcverge-scraper/
├── package.json
├── README.md
├── cli.js                 # 20 perintah (+ help)
├── src/
│   ├── http.js            # transport serial + retry + cache
│   └── index.js           # REST + admin-ajax + parser HTML
└── test/
    ├── index.test.js      # 20 test lokal
    └── live.test.js       # 30 test live
```
