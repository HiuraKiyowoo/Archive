# API mangatoon-scraper

Semua fungsi `async` kecuali yang ditandai. Semua menerima objek opsi; `lang` default `"en"`
dan wajib salah satu dari `LANGS` (`en`, `id`, `es`, `pt`, `th`) — kalau tidak, `Error`.

Kegagalan HTTP dilempar sebagai `HttpError` dengan properti `.status` dan `.url`.

Penomoran `page` di API ini **1-based** (halaman 1 = halaman pertama). Situs sendiri 0-based;
konversi ditangani library. `page < 1` → `Error`.

---

## Konstanta & util

```js
LANGS                                  // ["en","id","es","pt","th"]
HttpError                              // class, punya .status & .url
httpGet(url, { retries, binary })      // GET mentah, throttle 500ms, fallback curl
parseCount("253.6M")                   // 253600000   (sync)
decodeEnt("Boys&#8217; Love")           // "Boys’ Love" (sync)
stripTags("<b>x</b><br>y")             // "x\ny"      (sync)
toWatermark(encryptedUrl, lang)        // /encrypted/x.webp -> /watermark/x.jpg (sync)
```

---

## `home({ lang })`

```js
{
  lang, url,
  banner: [Card], banner_count,
  sections: [{ title, count, items: [Card] }], section_count,
  count            // total item semua section
}
```

`Card` = `{ content_id, slug, title, url, cover }`.

Live en: 7 section (`👏🏻 Read with Editor`, `Completed Classics👍🏻`, `Hottest Comics`, `Genres`,
`New Comics`, `Completed`, `Manga Update Today`), 4 banner, 44 item. Jumlah section berbeda per bahasa
(id 6, th 5) — itu memang beda konten, bukan parser gagal.

## `genres({ lang })`

```js
{ lang, url, genres: [{ id, name, url }], genre_count, status: [{ id, name, url }], status_count }
```

25 genre (`All`=0, Romance 8, Fantasy 10, CEO 17, Boys' Love 9, Action 7, …) + 3 status
(`Hottest`=0, `Updated`=1, `Completed`=2).

## `browse({ lang, genre, status, page })`

Listing utama. `genre` & `status` id dari `genres()`; `0` = semua.

```js
{ lang, page, url, genre, status, items: [ListCard], count, has_next, next_page }
```

`ListCard` = `{ content_id, slug, title, url, cover, likes, likes_raw, tags: [string], episode_count, views, views_raw }`

- 18 item per halaman, konsisten di semua bahasa.
- `has_next=false` di halaman terakhir; `next_page` = `0` saat habis.
- Halaman melewati batas → `HttpError 404` (bukan list kosong).
- `episode_count` diurai dari teks situs `"Up to Ep.215"` → `215`; `0` kalau situs tidak menampilkannya.

## `hot({ lang, page })` / `updated({ lang, page })`

Sama seperti `browse()` tapi ke `/genre/hot` dan `/genre/new`.

## `byTag({ lang, tag, page })`

`tag` = id dari `series().tags[].id`. Bentuk hasil sama seperti `browse()`.
Tag tidak valid → `HttpError 404`. Contoh live: tag 2 (School life) habis di halaman 26 dengan 14 item.

## `search({ lang, word })`

```js
{ lang, word, url, items: [SearchCard], count, comic_count, novel_count, found }
```

`SearchCard` = `{ kind, content_id, novel_id, slug, title, url, cover, type: [string] }`

- **Tidak ada parameter `page`** — situs mengembalikan hasil identik untuk `?page=N`.
- `kind: "comic"` → `content_id > 0`, bisa dipakai `series()`.
- `kind: "novel"` → `content_id: 0`, `novel_id > 0`, URL ke `noveltoon.mobi` (novel teks, di luar cakupan).
- Query tanpa hasil: situs balas HTTP 404 → dinormalisasi jadi `found: false, count: 0, items: []`.
- `word` kosong → `Error`.

## `series({ lang, id, slug })`

`id` = `content_id` (wajib). `slug` opsional — situs 302 ke slug kanonik, jadi `series({ id: 21 })` cukup.

```js
{
  content_id, lang, url, slug,
  title, status,               // "completed" | "on going"
  author, score,               // score 0 kalau belum dinilai
  views, views_raw, likes, likes_raw,
  cover,                       // dari og:image
  description,
  tags: [{ id, name }], tag_count,
  latest_episode,              // angka dari "Update to episode N"
  latest_episode_raw,
  episodes: [Episode], episode_count
}
```

`Episode` = `{ episode_id, number, title, url, date, views, views_raw, likes, likes_raw }`

- ⚠️ **Situs merender daftar episode 2x (asc + desc).** Library sudah ambil blok pertama + dedup
  `data-id`. `episode_count` selalu cocok dengan `latest_episode`.
- `episode_id` **tidak berurutan** (Hunk No.1: ep1=517, ep2=518, ep3=516). Jangan menebak id.
- `date` format `YYYY-MM-DD`.
- `content_id` tidak ada → `HttpError 404`.

## `episodeImages({ lang, contentId, episodeId })`

```js
{
  content_id, episode_id, lang, url,
  title, series_title, series_url,
  prev_episode, next_episode,   // 0 = tidak ada
  pages: [{ index, url, encrypted_url, width, height, size }],
  count
}
```

- `url` = `/watermark/*.jpg` (bisa dibuka). `encrypted_url` = `/encrypted/*.webp` asli dari situs,
  **isinya terenkripsi** — disimpan hanya untuk referensi.
- Jumlah halaman dari JSON `let pictures`, bukan dari tag `<img>` (HTML kadang cuma render sebagian).
- ⚠️ `contentId` di URL diabaikan server; hanya `episodeId` yang menentukan. `contentId` ngawur → 404.
- `episodeId` palsu → situs balas 200 dengan `pictures` kosong; library melempar `HttpError 404`.
- Referer **tidak** diperlukan untuk mengunduh gambar.

## `download({ lang, contentId, episodeId, dir, limit })`

Unduh gambar episode ke `dir` sebagai `p001.jpg`, `p002.jpg`, … `limit > 0` membatasi jumlah.

```js
{ content_id, episode_id, dir, saved: [{ index, file, bytes, url }], count }
```

## `booklist({ lang, page })`

Koleksi buatan pengguna. 40 kartu per halaman.

```js
{ lang, page, url, items: [BooklistCard], count, has_next, next_page }
```

`BooklistCard` = `{ booklist_id, url, user, user_avatar, date, title, description, series: [Ref], series_count, comic_count, novel_count }`

`Ref` = `{ kind, content_id, novel_id, slug, url }` — sama seperti search, campuran komik + novel.

- `user`/`user_avatar` bisa `""` (pemilik anonim/terhapus) — bukan bug.
- `date` format `dd/mm/yyyy`.
- Sebagian kartu tidak punya blok rekomendasi → `series_count: 0`, tapi kartunya tetap dikembalikan.

## `booklistDetail({ lang, id })`

```js
{ booklist_id, lang, url, page_title, user, user_avatar, date, title, description,
  series: [Ref], series_count, comic_count, novel_count }
```

Halaman detail memakai `<img src>` (bukan lazyload `data-src`) — sudah ditangani.

## `sitemap({ lang })`

Seluruh katalog satu bahasa dalam **1 request**. Jalur termurah untuk full sync.

```js
{ lang, url, items: [{ content_id, slug, url, lastmod, cover }], count }
```

Live 2026-08-31: en 570, id 349, es 240, pt 213, th 221. Sebagian entry tanpa `<lastmod>` → `""`.

## `sitemapIndex()`

```js
{ url, items: [{ url, lastmod }], count }   // 11 sitemap: detail_×5, genre_×5, static
```

## `walk(fn, args, { maxPages })`

Paginasi otomatis sampai `has_next=false` atau 404, dedup by `content_id`.

```js
const all = await walk(byTag, { tag: 2 }, { maxPages: 50 });
// { items, count, pages, stopped_at }
// live: { count: 464, pages: 26, stopped_at: "halaman terakhir (26)" }
```

`fn` harus fungsi listing yang menerima `{ page }` dan mengembalikan `{ items, has_next }`
(`browse`, `hot`, `updated`, `byTag`, `booklist`). Dedup memakai `content_id`, jatuh ke
`booklist_id` untuk `booklist`. `stopped_at` menjelaskan alasan berhenti:
`"halaman terakhir (N)"`, `"404 di halaman N"`, atau `"batas maxPages (N)"`.

---

## Etika & batas

- Throttle bawaan 500 ms antar request, retry 3x dengan backoff. Jangan diturunkan.
- Route `/api` **tidak dipakai** karena `robots.txt` melarangnya; seluruh data dari HTML yang di-`Allow`.
- Episode berbayar/terkunci tidak dibuka, enkripsi gambar tidak dipecahkan.
