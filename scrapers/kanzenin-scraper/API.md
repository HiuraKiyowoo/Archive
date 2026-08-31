# API — kanzenin-scraper

Semua fungsi `async` kecuali `chapterSlug()`. Semua melempar `Error` dengan properti `.status` (kode HTTP) pada kegagalan HTTP.

```js
import {
  home, feed, project, genres,
  search, browse, listMode, azList, allSeries, byGenre,
  series, chapterImages, chapterSlug, downloadChapter,
} from "./src/index.js";
```

---

## `home()`

Homepage. 4 section + rilis chapter terbaru.

```js
{
  sections: {
    "Popular Today":   [ item, ... ],   // 7  (kind: "series")
    "Project Update":  [ item, ... ],   // 10 (kind: "chapter")
    "Latest Update":   [ item, ... ],   // 25 (kind: "chapter")
    "Recommendation":  [ item, ... ],   // 25 (kind: "series")
  },
  latest_chapters: [
    { series, series_title, chapter, url, date }, ...   // 30, sudah dedup
  ]
}
```

**item** (kartu `div.bsx`):

```js
{
  url, title, image,
  status,        // "Ongoing" | "Completed" | null
  type,          // "Manga" | "Manhwa" | "Manhua" | null
  latest,        // teks episode di kartu, contoh "Ch.78"
  rating,        // number | null
  date,          // null di kebanyakan section
  kind,          // "series" | "chapter"
  series_slug,
  series_url,    // SELALU /manga/<slug>/
  chapter_url,   // hanya kalau kind === "chapter"
  chapter,       // number, hanya kalau kind === "chapter"
}
```

Kartu di section "Latest Update"/"Project Update" menunjuk URL **chapter**, bukan series — makanya ada `kind`. Pakai `series_url` kalau butuh halaman series.

---

## `feed()`

`/feed/` (RSS). 10 rilis terakhir, timestamp presisi.

```js
[ { title, url, date /* "Mon, 31 Aug 2026 02:56:09 +0000" */, iso /* "2026-08-31T02:56:09.000Z" */ }, ... ]
```

Berguna untuk polling murah (1 request, ~10 KB).

---

## `project()`

`/project/` — series garapan tim sendiri. Tidak ada pagination di site.

```js
{ count: 20, items: [ item, ... ] }
```

---

## `genres()`

44 genre dari widget filter `/manga/`.

```js
[ { id: 1607, slug: "action", name: "Action" }, ... ]
```

`id` dipakai untuk `browse({ genre: [...] })`, `slug` untuk `byGenre()`.

---

## `search(query, { page = 1 })`

Route `/page/N/?s=<query>`. 10 item/halaman.

```js
{ query, page, max_page, items: [ item, ... ] }
```

- `max_page` diambil dari link `page-numbers` (nomor halaman terakhir selalu dirender).
- Query tanpa hasil → `items: []`, bukan error.
- `page` melebihi `max_page` → throw `404`.

---

## `browse({ genre, status, type, order, page })`

Route `/manga/?page=N&...`. 27 item/halaman. **Ini satu-satunya jalur dengan filter gabungan.**

```js
await browse({ type: "manhwa", status: "completed", order: "popular", page: 2 })
```

| Param | Nilai |
|---|---|
| `genre` | array ID numerik dari `genres()` — beberapa ID = AND |
| `status` | `ongoing` \| `completed` \| `hiatus` |
| `type` | `manga` \| `manhwa` \| `manhua` |
| `order` | `title` \| `titlereverse` \| `update` \| `latest` \| `popular` |
| `page` | 1-based |

```js
{ page, has_next, next_page, filter: {...}, items: [ item, ... ] }
```

Site **tidak** merender total halaman di mode ini, jadi yang tersedia `has_next` (dari tombol Next) — walk sampai `has_next === false`. Filter ikut terbawa antar halaman (diverifikasi: tidak ada item duplikat antar p1/p2).

Nilai invalid diabaikan site (fallback ke default), bukan error. `genre` ID tak dikenal → 0 item.

---

## `listMode()`

Route `/manga/?list` — **seluruh katalog dalam 1 request** (~2.328 series). Cara termurah untuk full sync.

```js
{
  total: 2328,
  letters: { "#": 12, A: 118, B: 126, K: 222, M: 229, S: 248, ... },   // 26 grup
  items: [ { post_id, slug, url, title, letter }, ... ]
}
```

Tidak ada metadata status/type di mode ini — cuma judul + slug + `post_id`.

---

## `azList(letter, { page = 1 })`

Route `/a-z-list/?show=<letter>`. 10 item/halaman, ada `max_page`.

```js
{ letter, page, max_page, items: [ item, ... ] }
```

Huruf valid: `A`–`Z`, `0-9`, `.`. Huruf tanpa hasil (contoh `X`) → `items: []`.

## `allSeries({ letters })`

Loop `azList` untuk beberapa huruf, hasil digabung + dedup by URL.

```js
await allSeries({ letters: ["Q", "Z"] })   // -> [ item, ... ]
```

Untuk full sync, `listMode()` jauh lebih murah.

---

## `byGenre(slug, { page = 1, limit })`

Route `/genres/<slug>/page/N/`. 10 item/halaman, `max_page` tersedia.

```js
{ genre: "romance", page, max_page: 127, items: [ item, ... ] }
```

Slug tidak dikenal → throw `404`.

---

## `series(slug)`

Route `/manga/<slug>/`. Metadata lengkap + seluruh chapter (tidak ada pagination chapter).

```js
{
  slug, title, url, image,        // image = cover asli dari div.thumb
  status, type, released,
  author, artist, serialization,
  posted_on, updated_on,
  views,                          // string | null
  rating, rating_count, followers,
  genres: ["Comedy", "Mature", ...],
  genre_slugs: ["comedy", "mature", ...],
  posted_by, posted_at, updated_at,
  post_id,
  first_chapter, latest_chapter,
  synopsis,
  chapters: [
    {
      number,       // 45   (number | null kalau benar-benar tak keparse)
      number_raw,   // "45 End"
      label,        // "End" | null
      is_end,       // true kalau raw mengandung end/tamat/final
      url,          // URL PASTI — pakai ini, jangan bikin sendiri
      title,        // "Chapter 45 End"
      date,
    }, ...
  ]   // urut desc, sudah dedup by nomor
}
```

Slug tidak ada → throw `404`.

---

## `chapterImages(chapterUrl)`

Terima slug (`"rooftop-sex-king-chapter-78"`) atau URL penuh.

```js
{ url, number, title, pages: [ { n, url }, ... ], count }
```

Parsing nomor menangani semua varian slug yang ada di site: `-chapter-5`, `-chapter-67-5` (= 67.5), `-chapter-45-end`, dan `/im-a-vampire-43/` (tanpa kata "chapter").

Gambar difilter di dalam `#readerarea` dengan aturan **host bukan `kanzenin.info`** — semua halaman reader dilayani CDN eksternal, sementara ads/cover/sidebar selalu di domain site. Sebagian URL memakai `http://` biasa.

Chapter tidak ada → throw `404`.

## `chapterSlug(seriesSlug, number)`

```js
chapterSlug("x", 67.5)   // "x-chapter-67-5"
```

Best-effort saja — banyak chapter di site tidak mengikuti pola ini. Prefer `series().chapters[].url`.

## `downloadChapter(chapterUrl, outDir, { first, referer = true })`

Download gambar ke `outDir` sebagai `p001.jpeg`, `p002.jpeg`, ... via `curl` (dengan header `Referer`). Melempar error kalau ada file 0 byte.

```js
{ chapter, dir, count, files: [ { n, file, bytes }, ... ] }
```

---

## Perilaku HTTP

- UA browser Chrome 126 di semua request.
- `fetch` dulu → fallback `curl --compressed` kalau `fetch` gagal.
- Throttle 600 ms antar request, retry + exponential backoff pada 429/5xx.
- Error HTTP dilempar sebagai `Error` dengan `.status`.
