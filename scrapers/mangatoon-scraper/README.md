# mangatoon-scraper

Scraper **zero-dependency** (Node ≥ 18) untuk [mangatoon.mobi](https://mangatoon.mobi/) — komik/manhwa multi-bahasa.

Situs pakai **PHP 7.3 + HTML server-side render, tanpa Cloudflare challenge**, jadi seluruh library ini
HTTP murni: `fetch` bawaan Node (fallback `curl` kalau fetch gagal). Tidak ada headless browser,
tidak ada dependency npm.

`robots.txt` situs melarang `/api`, `/dev`, `/documents`, `/Statistic`, `/index/login`, `/site/login`,
`/site/register`. **Library ini tidak menyentuh satu pun dari itu** — semua data diambil dari route HTML
yang di-`Allow`.

## Pakai cepat

```bash
node cli.js series 21                     # detail + 350 episode
node cli.js episode 21 517                # URL gambar 1 episode
node cli.js download 21 517 ./out         # unduh gambar JPEG
node cli.js browse --genre 9 --page 2     # listing Boys' Love halaman 2
node cli.js sitemap --lang id             # seluruh katalog Indonesia, 1 request
```

```js
import { series, episodeImages, browse, search } from "./src/index.js";

const s = await series({ id: 21 });                 // slug opsional, situs 302 sendiri
const ep = await episodeImages({ contentId: 21, episodeId: s.episodes[0].episode_id });
console.log(s.title, s.episode_count, ep.pages[0].url);
```

## Route yang didukung

| Fungsi | Route situs | Catatan hasil live |
| --- | --- | --- |
| `home()` | `/` , `/{lang}` | 7 section + 4 banner, 44 item (en) |
| `genres()` | widget filter `/genre/comic` | 25 genre + 3 status, semua ber-id |
| `browse()` | `/genre/comic`, `/genre/category/{genre}/{status}` | 18 item/halaman |
| `hot()` | `/genre/hot` | shortcut listing |
| `updated()` | `/genre/new` | shortcut listing |
| `byTag()` | `/genre/tags/{id}` | id tag dari `series().tags` |
| `search()` | `/search?word=` | **tanpa pagination** (lihat batasan) |
| `series()` | `/{slug}?content_id=N` | metadata + SELURUH episode inline |
| `episodeImages()` | `/watch/{cid}/{eid}` | URL `/watermark/*.jpg` |
| `download()` | — | tulis JPEG ke disk |
| `booklist()` | `/book/list` | 40 kartu/halaman |
| `booklistDetail()` | `/booklist-detail/{id}` | isi 1 booklist |
| `sitemap()` | `/sitemap/detail_{lang}.xml` | katalog penuh 1 request |
| `sitemapIndex()` | `/sitemap_index.xml` | 11 sitemap |
| `walk()` | — | paginasi otomatis + dedup |

Bahasa: `en` `id` `es` `pt` `th` (konstanta `LANGS`). Domain lain (`fr.`, `ar.`, `mangatooncom.vn`) tidak dicakup.

Angka katalog per bahasa dari sitemap (2026-08-31): en 570, id 349, es 240, pt 213, th 221.

## 8 jebakan situs yang sudah ditangani

Semua ini ditemukan lewat pengujian live, bukan asumsi. Kalau kode diubah, tes ulang bagian ini.

1. **Daftar episode di-render dua kali.** Halaman detail punya blok ascending *dan* descending:
   700 `episode-item-new` padahal aslinya 350. Parser ambil blok pertama saja lalu dedup `data-id`.
   Diverifikasi: Hunk No.1 700→350, Bossy President 1342→671, Kiss Goodbye 352→176 — dan semuanya
   cocok dengan klaim situs sendiri (`Update to episode N`).
2. **`let pictures` di reader berisi WEBP terenkripsi.** URL `/encrypted/*.webp` balik HTTP 200 tapi
   isinya byte acak (magic `45ba c3c3`), bukan WebP. Yang bisa dibuka: varian `/watermark/*.jpg`.
   JSON itu tetap dipakai sebagai sumber **jumlah** halaman, karena tag `<img>` di HTML kadang cuma
   sebagian — episode `5/40` merender 8 entry JSON tapi hanya 2 `<img>`.
3. **`content_id` di URL `/watch/` cuma dekorasi.** `/en/watch/5/517` mengembalikan episode Hunk No.1
   (content_id 21) yang sama. Yang menentukan hanya `episode_id`. `content_id` yang tidak ada → 404.
4. **Episode id palsu balik HTTP 200, bukan 404.** `/en/watch/21/99999999` merender halaman dengan
   `pictures` kosong + title placeholder `{1} - {0}`. Library melempar `HttpError 404`.
5. **Tombol prev/next di reader class-nya salah.** Di sebagian episode kedua tombol memakai
   `page-icons-next` sekaligus. Parser membaca **label teks** (`Previous Episode` / `Next Episode`).
   Di episode pertama, tombol Previous menunjuk ke dirinya sendiri → dinormalisasi jadi `0`.
6. **Param `page` 0-based.** URL tanpa query = halaman 1, `?page=1` = halaman 2. API library
   memakai penomoran 1-based yang normal dan menerjemahkannya. `?page=0` → 301, halaman melewati
   batas → 404 (dipakai sebagai sinyal habis), halaman terakhir tanpa tombol Next.
7. **Search: tidak ada pagination dan nol hasil = HTTP 404.** `?word=love&page=2` identik dengan
   halaman 1, jadi `search()` sengaja tidak menerima `page`. Query tanpa hasil dinormalisasi jadi
   `{ found: false, count: 0, items: [] }`, bukan exception.
8. **Search & booklist dicampur judul NovelToon.** Situs saudara (novel teks) muncul di hasil yang
   sama: search `bossy` = 18 hasil, 6 komik MangaToon + 12 novel `noveltoon.mobi`. Semua tetap
   dikembalikan dengan penanda `kind: "comic" | "novel"` supaya tidak ada yang hilang senyap —
   hanya `kind: "comic"` yang bisa diteruskan ke `series()`.

Dua bug parser sendiri yang ketangkap audit dan sudah diperbaiki: pola pemotong kartu
`</a></div>` menelan 2 dari 40 kartu booklist (kartu tanpa blok rekomendasi), dan `<a href=` dengan
newline di antaranya membuat 2 kartu section "Hottest Comics" hilang.

## Kebijakan "tidak ada null"

Tidak ada field yang pernah bernilai `null`, `undefined`, atau `NaN`. Angka yang tidak tersedia = `0`,
teks yang tidak tersedia = `""`. Field berikut **memang boleh kosong** karena situs sendiri tidak
menyediakannya — bukan bug parser:

| Field | Kapan kosong |
| --- | --- |
| `episodes[].title` | banyak episode tanpa subtitle, hanya bernomor |
| `episodes[].views_raw` / `likes_raw` | episode lama tanpa statistik |
| `series().author` | sebagian series tidak mencantumkan penulis |
| `series().description` | sebagian series tanpa sinopsis |
| `booklist().user` / `user_avatar` | pemilik anonim/terhapus (situs render `<p>` kosong) |
| `sitemap().items[].lastmod` | sebagian entry XML tanpa `<lastmod>` |

Angka ringkas situs (`253.6M`, `37.6k`) selalu diurai ke integer **dan** disimpan mentahnya:
`views: 253600000` + `views_raw: "253.6M"`.

## Test

```bash
node --test test/index.test.js
```

**42 test live, semua lolos** (~72 s). Isinya: unit parser, validasi argumen, home multi-bahasa
(termasuk section dengan markup tak seragam), genre + filter, pagination sampai halaman terakhir
sungguhan, tag, search (termasuk 404 & campuran NovelToon), series (dedup 700→350, series 900+
episode, slug salah, 404), reader (nav label, episode palsu), download JPEG nyata ke disk, booklist
(40 kartu termasuk kartu tanpa rekomendasi), sitemap 5 bahasa, `walk()` sampai halaman 26, dan satu
test audit yang memindai seluruh response dari 14 endpoint untuk `null`/`undefined`/`NaN`.

Dua skrip audit tambahan (lokal, tidak masuk suite):

- `node audit.js` — bandingkan hitungan parser vs hitungan langsung dari HTML mentah, untuk menangkap
  kehilangan senyap. Hasil terakhir: 17/17 cocok.
- `node audit2.js` — 12 series tersebar merata dari sitemap + 1 episode acak masing-masing:
  **2.698 episode diperiksa, nol field bermasalah**.

## Batasan jujur

- **Total halaman tidak pernah diberikan situs.** Tidak ada `page-numbers`, cuma tombol Next. Untuk
  tahu jumlah halaman, harus di-walk (`walk()`) atau pakai `sitemap()` yang mengembalikan seluruh
  katalog dalam 1 request.
- **Search dibatasi 18 hasil** dan tidak bisa di-page — itu perilaku situs.
- **Episode berbayar/terkunci tidak dibuka.** Halaman detail memuat penanda `lock`/`coin`/`purchase`,
  dan episode premium butuh login + saldo. Library tidak mencoba melewatinya.
- **Gambar mengandung watermark MangaToon.** Varian tanpa watermark hanya ada dalam bentuk
  terenkripsi yang didekripsi di klien resmi; tidak dibuka di sini.
- **URL avatar booklist bertanda tangan waktu** (`?sign=...&t=...`) dan berubah setiap request —
  jangan dipakai sebagai cache key.
- **Data situs kadang tidak konsisten** (judul episode kosong, statistik hilang di episode lama).
  Library memantulkan apa adanya, tidak menambal.

Throttle bawaan 500 ms antar request + retry 3x. Jangan diturunkan.
