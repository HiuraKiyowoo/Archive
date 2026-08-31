# cosmicscans-scraper

Scraper **zero-dependency** untuk [03.cosmicscans.to](https://03.cosmicscans.to/) — situs baca manga / manhwa / manhua bahasa Indonesia (CosmicScans ID).

Node ≥ 18, tanpa npm install, tanpa browser. Semua data lewat HTTP murni pakai `fetch` bawaan Node.

## Kenapa API, bukan HTML

Situsnya **SvelteKit tanpa SSR** — HTML yang dikirim server cuma shell kosong (nol kartu series di dalamnya). Semua isi diambil frontend dari REST API publik.

Base API diambil dari chunk build (`PUBLIC_COSMIC_API_BASE_URL`), bukan tebakan:

| Peran | Host |
|---|---|
| API data | `https://cdncid.csmcscns.id` |
| Pengaturan situs | `https://dash.csmcscns.id` |
| CDN gambar chapter | `https://cdn.uqni.net` |

Tidak ada Cloudflare challenge. `robots.txt` mengizinkan `User-agent: *` dengan `Allow: /` (yang di-`Disallow` hanya bot AI training: GPTBot, ClaudeBot, CCBot, Bytespider, dll).

Envelope API selalu `{ success: true, data: ..., cursor?: {...} }`. Respons dengan `success !== true` ditolak sebagai `ApiError`.

## Instalasi

```bash
cd scrapers/cosmicscans-scraper
node --test test/index.test.js   # 21 test live
```

## Pemakaian library

```js
import { latest, seriesDetail, chapter, filter } from "./src/index.js";

const baru = await latest({ limit: 10 });
const seri = await seriesDetail("lookism");        // 623 chapter
const bab  = await chapter("lookism-chapter-622"); // 18 gambar
const pop  = await filter({ limit: 20, order: "popular", type: "Manhwa" });
```

### Fungsi

Listing (semua balas `{ count, pagination, data }`):
- `latest({ limit, after, before })` — update chapter terbaru
- `heroSlider({ limit })` — slider homepage
- `popularToday({ limit })` — populer hari ini
- `latestProject({ limit })` / `projectAll({ limit })` — garapan tim sendiri
- `allComics({ limit })` — katalog umum
- `filter({ genres, status, type, order, project, limit, after, before })`
- `textMode({ genres, status, type, order })` — **seluruh katalog** (4.466 judul) dikelompokkan per abjad, satu request, tanpa cursor
- `search(q)` — cari judul

Detail:
- `seriesDetail(slug)` — metadata + **semua** chapter
- `related(slug, { limit })`
- `chapter(slug)` — gambar + navigasi prev/next + daftar chapter
- `chapterImages(slug)` — hanya array URL gambar

Ekstra:
- `settings("general"|"homepage"|"menu"|"ads")`
- `announcements({ limit, offset })`
- `walk({ pages, limit, kind })` — susuri cursor otomatis, hasil sudah dedupe

## CLI

```bash
node cli.js latest 10
node cli.js filter 20 --order=popular --type=Manhwa --status=Ongoing
node cli.js filter 10 --genres=action,comedy
node cli.js textmode
node cli.js search lookism
node cli.js series lookism
node cli.js chapter lookism-chapter-622
node cli.js images lookism-chapter-622
node cli.js walk 3 20 --kind=filter --order=az
```

Output JSON ke stdout. Error → JSON ke stderr, exit 1.

## Pagination: cursor, bukan nomor halaman

API pakai cursor opaque (base64), jadi tidak ada `?page=2`:

```js
const p1 = await latest({ limit: 20 });
const p2 = await latest({ limit: 20, after: p1.pagination.next_cursor });
const kembali = await latest({ limit: 20, before: p2.pagination.prev_cursor });
```

`pagination` = `{ has_next, has_prev, next_cursor, prev_cursor }`. `limit` minimal 1 — `limit=0` ditolak server dengan HTTP 400.

## Parameter filter

| Opsi | Param API | Nilai |
|---|---|---|
| `order` | `order_by` | `update` (default), `popular`, `az`, `za` |
| `status` | `release_status` | `Ongoing`, `Completed`, `Hiatus`, `Dropped` |
| `type` | `type_manga` | `Manga`, `Manhwa`, `Manhua` |
| `genres` | `genres_slug` | array slug, diulang per elemen |
| `project` | `is_project` | `true` = hanya garapan sendiri |

Semua sudah diverifikasi **benar-benar menyaring** (bukan cuma diterima lalu diabaikan): `status=Completed` hanya balas item Completed, `genres=action` hanya item bergenre Action, `order=az` benar-benar urut abjad.

## Jebakan yang sudah ditangani

Empat hal ini bikin parser naif salah, semuanya ketemu dari probe live:

1. **`readingPage.chapters` itu daftar GAMBAR, bukan daftar chapter.** Daftar chapter ada di `otherChapters`. Nama field-nya menyesatkan.
2. **Tiap entri gambar berupa string HTML** `<img src='https://cdn.uqni.net/...jpeg'>`, bukan URL polos — harus diekstrak dari atributnya.
3. **Tidak ada endpoint daftar genre.** `/v1/manga/genres`, `/v1/genres`, `/v1/manga/genre` semuanya 404. Genre hanya muncul sebagai field di tiap series.
4. **`sinopsis` mengandung tag HTML + entitas** (`&amp;`, `&#39;`) — dibersihkan jadi teks polos di field `synopsis`.

Dua perilaku situs yang dilaporkan apa adanya, bukan disembunyikan:

- **Search memecah query per token dan mencocokkan OR**, bukan frasa utuh. Jadi `"zzzqqqxxx-judul-tidak-ada-999"` tetap balas 100 hasil karena token `judul` / `ada` / `999` cocok ke judul lain. Token tunggal yang benar-benar tidak ada (`zzzqqqxxx`) balas 0. Hasil dipatok maksimal 100 → ditandai `limit_capped: true`.
- **Katalog punya 10 entri kembar**: slug sama, judul beda tipis (apostrof lurus `'` vs `’`, `-` vs `:`). Jadi 4.466 entri = 4.456 slug unik. `textMode()` melaporkan `total`, `unique_total`, dan `duplicate_slugs` sekaligus.

## URL situs publik

Diverifikasi live, karena tidak bisa ditebak dari API:

- Series → `https://03.cosmicscans.to/series/{slug}/`
- Chapter → `https://03.cosmicscans.to/chapter/{slug}/`

Pola lain (`/manga/{slug}/`, `/{slug}/`, `/read/{slug}/`) semuanya 404.

## Field yang memang kosong dari sumbernya

Ini batasan data situs, bukan parser gagal (dicek pada 8 series populer):

| Field | Catatan |
|---|---|
| `big_cover` | selalu `null` — tidak dipakai situs |
| `author`, `artist` | kosong di ~6 dari 8 series |
| `published`, `badge` | kosong di ~3 dari 8 series |
| `serialization` | kosong di ~2 dari 8 series |

Field inti (`title`, `slug`, `cover`, `synopsis`, `status`, `rating`, `views`, `genres`, `chapters`) terisi penuh — dijaga oleh test audit anti-null.

## Test

21 test live, semua lolos (~49 detik). Bukan cek HTTP 200 saja:

- Listing: field kartu terisi, cursor maju **tidak overlap**, cursor mundur kembali ke isi halaman 1
- Filter: setiap `order_by` mengubah hasil; `status`/`type`/`genre`/`project` diverifikasi menyaring isi
- Series: 623 chapter, urut terbaru → terlama, slug unik, `time` format ISO
- Chapter: navigasi dua arah diuji di chapter terbaru (next `null`), tengah (dua arah terisi), dan paling lama (prev `null`)
- **Gambar diunduh nyata dan diperiksa magic number** JPEG/PNG/WEBP, ukuran > 5 KB
- Error: slug ngawur → `HttpError` 404 dengan pesan server; `limit=0` → 400
- Audit anti-null: 27 field wajib

Plus 19 subcommand CLI diverifikasi menghasilkan JSON valid, termasuk jalur usage dan jalur error.

## Catatan

- Request diserialkan dengan spacing 400 ms; retry hanya untuk 5xx / error jaringan (4xx dianggap permanen)
- Cache in-memory per URL, bersihkan dengan `clearCache()`
- URL gambar CDN tidak bertanda tangan / tidak terikat IP — aman diunduh belakangan, kirim `Referer` situs
- Hormati ToS situs; jangan hajar dengan request paralel besar
