# narashika-scraper

Scraper untuk **[narashika.top](https://narashika.top/)** — film, drama Korea/China, dan episode serial.

Zero-dependency (cuma `fetch` bawaan Node 18+). Node `--test` untuk pengujian, tanpa framework tambahan.

## Kenapa hybrid REST + HTML

Situs ini WordPress 6.8.8 dengan tema **muvipro** (kelas CSS `gmr-*`), dan REST API-nya **terbuka penuh tanpa auth**. Tapi tidak semua data ada di REST — ini sudah diukur, bukan diasumsikan:

| Data | Sumber | Bukti |
|---|---|---|
| katalog, judul, slug, tanggal, poster | REST | `/wp-json/wp/v2/posts` dst |
| id taksonomi + nama (via `_embed`) | REST | `wp:term` di respons |
| **tautan download** (1fichier, Buzzheavier, send.cm) | REST | ada di `content.rendered` |
| `views` | REST | hanya di post type `posts` |
| **rating & jumlah vote** | HTML | microdata `itemprop="ratingValue"` |
| **durasi** | HTML | `<span class="gmr-duration-item">` |
| **kualitas** | HTML | `<div class="gmr-quality-item">` |
| **iframe player** | HTML | `<div class="gmr-embed-responsive">` |
| daftar episode serial | HTML | `<div class="gmr-listseries">` |

Yang penting: `content.rendered` dari REST **tidak memuat `<iframe`, `short.ink`, maupun `rpmvid` sama sekali**. Tema muvipro menyimpan embed player di custom field yang tidak diekspos REST. Jadi metadata + download bisa dipanen borongan lewat REST, dan HTML hanya diambil kalau memang butuh player/rating — satu request tambahan per judul, bukan per katalog.

## Peta route

### REST — post type

Base: `https://narashika.top/wp-json/wp/v2`

| Alias | `rest_base` | Jumlah item | Isi |
|---|---|---|---|
| `movie` | `posts` | 1.427 | film |
| `tv` | `tv` | 585 | serial/drama |
| `episode` | `episode` | 7.403 | episode per serial |

Jumlah diambil dari header `X-WP-Total`; paginasi dari `X-WP-TotalPages`. `per_page` maksimum **100** (`per_page=101` → `400 rest_invalid_param`), jadi seluruh katalog 9.415 item butuh ~95 request.

### REST — taksonomi

`rest_base` untuk REST **berbeda** dari prefix URL arsip publik. Menyamakan keduanya menghasilkan 404.

| Alias | `rest_base` | Arsip HTML | Term | Berlaku untuk |
|---|---|---|---|---|
| `categories` | `categories` | `/genre/<slug>/` | 66 | movie, tv |
| `tags` | `tags` | `/tag/<slug>/` | 2.320 | movie, tv |
| `director` | `muvidirector` | `/director/<slug>/` | 875 | movie, tv |
| `cast` | `muvicast` | `/cast/<slug>/` | 4.485 | movie, tv |
| `year` | `muviyear` | `/year/<slug>/` | 28 | movie, tv |
| `country` | `muvicountry` | `/country/<slug>/` | 48 | movie, tv |
| `network` | `muvinetwork` | `/network/<slug>/` | 62 | tv |
| `quality` | `muviquality` | `/quality/<slug>/` | 13 | movie, episode |
| `index` | `muviindex` | `/index/<slug>/` | 31 | movie, tv |

Semua taksonomi `muvi*` bisa dipakai sebagai query param di `posts` maupun `tv` — mis. `?muviyear=7613&muvicountry=108`.

### REST — lain

- `/wp-json/wp/v2/search?search=<q>` — cari lintas semua post type; respons ringkas (`id`, `title`, `url`, `subtype`).
- `?search=<q>` pada tiap post type — hasil objek post penuh.
- `?slug=<slug>` — ambil satu item; array kosong kalau tidak ada.
- `/<rest_base>/<id>` — ambil per id; `404 rest_post_invalid_id` kalau tidak ada.

### URL front-end

- film → `https://narashika.top/<slug>/`
- serial → `https://narashika.top/tv/<slug>/`
- episode → `https://narashika.top/eps/<slug>/`

## Jebakan yang sudah ditutup

**`orderby=views` ditolak server** (`400 rest_invalid_param`) walaupun field `views` ADA di respons. Konsekuensinya: tidak ada endpoint "terpopuler" resmi. `getTerpopuler()` menarik N halaman lalu mengurutkan **lokal**, dan `catatan` di responsnya menyatakan itu apa adanya — bukan dilabeli sebagai peringkat server. `orderby` yang sah: `date`, `modified`, `title`, `id`, `slug`, `include`. Yang ditolak: `views`, `meta_value_num`, dan `relevance` (kecuali dibarengi `search`).

**`views` cuma ada di post type `posts`.** Respons `posts` punya 32 key, `tv` 27, `episode` 20 — dua terakhir tidak punya `views` sama sekali. Karena itu `getTerpopuler("tv")` **melempar error**, bukan mengembalikan urutan sembarang yang terlihat seperti popularitas.

**Filter dengan id term salah gagal secara sunyi** — balas `200` dengan 0 hasil. Karena itu `filterBySlug()` memverifikasi term dulu dan **melempar** kalau tidak ada, ketimbang mengembalikan array kosong yang ambigu.

**`gmr-numbeps` tidak dipakai.** Class itu muncul di kartu rekomendasi sidebar, bukan artikel utama — di halaman film `borderlands-2024` ia mengembalikan `Eps:8` milik serial lain. Jumlah episode dihitung dari `gmr-listseries`.

**Ikon SVG di dalam elemen teks.** Durasi ada di `<span class="gmr-duration-item"><svg…/></svg>105 min`, jadi regex naif `>([^<]+)` menangkap awal tag `<svg` dan menghasilkan `null`. Parser membuang `<svg>` dulu.

**Anchor form komentar menyamar jadi episode.** Tombol "Batalkan balasan" menunjuk `/eps/<slug>/#respond` dan lolos pola `/eps/`. Tautan ber-`#` dan `/feed/` dibuang.

**Host bercabang.** Situs pernah pindah domain: `guid` post dan sitemap masih menunjuk `narashika.site`, dan banyak tautan internal memakai `tv.narashika.top`. Semua dinormalkan ke `narashika.top`.

**`page` di luar rentang** dibalas `400 rest_post_invalid_page_number` — itu batas normal, bukan gangguan, jadi tidak diulang.

## Etika & transport

`robots.txt` situs ini hanya melarang `/wp-admin/`. **`/wp-json/` tidak dilarang** — jalur yang dipakai scraper ini sah menurut robots.

Transport tetap dibuat sopan: **serial satu koneksi, jeda 900 ms, nol paralelisme**, retry hanya untuk 5xx (4xx dianggap permanen), cache per-URL dalam proses. Alasannya bukan takut diblokir — dengan `per_page=100` seluruh katalog cuma butuh ~95 request, jadi tidak ada alasan menghajar server.

Cloudflare aktif di depan situs, tapi UA browser wajar lolos tanpa challenge (`cf-cache-status: DYNAMIC`) — tidak perlu spawn curl atau browser.

**Player adalah iframe pihak ketiga** (`short.ink`, `sf21.rpmvid.com`), bukan file video milik narashika. Scraper hanya menyalin URL iframe; tidak membuka, mengunduh, atau mem-proxy video.

## Pemakaian

### Library

```js
import { getFilm, getDetail, filterBySlug, semuaEpisode } from "./src/index.js";

const film = await getFilm({ perPage: 20, page: 1 });
// { jumlah, halaman, totalItem, totalHalaman, sumber, hasil: [...] }

const detail = await getDetail("borderlands-2024", "movie");
// REST + HTML: rating 6.8, durasi "105 min", iframePlayer, download[]

const korea = await filterBySlug("tv", "categories", "drama-korea", { perPage: 10 });

const eps = await semuaEpisode("s-line-2025-sub-indo", { batas: 5 });
```

### CLI

```bash
node cli.js route                                  # peta lengkap route + pembagian REST/HTML
node cli.js film --perPage 20 --page 2
node cli.js serial --orderby title --order asc
node cli.js episode --perPage 10
node cli.js populer movie --halaman 3              # urut views, dihitung lokal
node cli.js cari "love" --tipe movie
node cli.js cari-semua "cinta"                     # lintas post type
node cli.js detail borderlands-2024                # REST + HTML
node cli.js detail s-line-2025-sub-indo --tipe tv
node cli.js html https://narashika.top/borderlands-2024/
node cli.js genre                                  # 66 genre
node cli.js term country                           # 48 negara
node cli.js filter tv categories drama-korea
node cli.js all-episode s-line-2025-sub-indo --batas 5
```

JSON ke stdout, status/error ke stderr — aman dipipe ke `jq`.

## Test

```bash
node --test test/index.test.js test/live.test.js
```

Dipisah dua berkas:

- `test/index.test.js` — murni lokal, tanpa jaringan. Parser (download, daftar episode, normalisasi host) dan seluruh validasi argumen.
- `test/live.test.js` — menembak narashika.top sungguhan. Validasi **isi**, bukan status HTTP: total dari `X-WP-Total` konsisten dengan paginasi, halaman 2 bukan duplikat halaman 1, poster benar-benar URL `wp-content/uploads/`, rating dalam rentang 0–10, durasi cocok pola `\d+ min`, tiap episode dapat URL player berbeda, dan iframe stabil antar dua request.

Ada juga test yang memverifikasi **klaim pembagian REST/HTML** di README ini: `getBySlug()` harus mengembalikan `rating: null` dan `iframePlayer: null`, karena data itu memang tidak ada di REST. Kalau suatu hari situs mulai mengekspos keduanya, test itu gagal dan dokumentasi ini harus diperbarui.

## Bukti live

Dijalankan pada 2026-09-01 terhadap situs sungguhan:

```
film --perPage 3     → totalItem 1427, totalHalaman 476
  [44846] Borderlands (2024)          views=3204 poster=ADA dl=1 term=13
  [45632] Trap (2024)                 views=1573 poster=ADA dl=1 term=13
  [45617] The Desperate Chase (2024)  views=3855 poster=ADA dl=1 term=14

detail borderlands-2024
  rating 6.8 (15 vote) | durasi 105 min | kualitas WEBRip | views 3204
  iframePlayer https://short.ink/gGu4kJ-0_
  download 360p: 10 tautan (1fichier, Buzzheavier, Send, Upstream, …)
  term 13: category×4, post_tag, muvidirector, muvicast×3, muviyear,
           muvicountry, muviquality, muviindex

genre                → totalItem 66, prefixUrl /genre/
  [4508] Action (218 post)  [7] Action Movies (355)  [5087] Adventure (120)

filter tv categories drama-korea → term id 4, totalItem 374, totalHalaman 94

cari-semua "cinta"   → totalItem 400 lintas post type

all-episode s-line-2025-sub-indo --batas 2 → gagal: []
  S1E1 id=46933 https://sf21.rpmvid.com/#fla3i
  S1E2 id=46941 https://sf21.rpmvid.com/#lcdel
```

## Struktur

```
narashika-scraper/
├── package.json
├── README.md
├── cli.js              # 16 perintah
├── src/
│   ├── http.js         # transport serial + retry, header X-WP-*
│   └── index.js        # REST + parser HTML
└── test/
    ├── index.test.js   # lokal, tanpa jaringan
    └── live.test.js    # live terhadap narashika.top
```
