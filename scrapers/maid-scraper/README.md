# maid-scraper

Scraper untuk **maid.my.id** — situs baca manga/manhwa berbahasa Indonesia.
Pendekatan **plain HTTP + Cheerio** (tanpa browser automation), plus WordPress
REST API untuk metadata.

## Kenapa bisa di-scrape (tanpa Cloudflare)

- Server **LiteSpeed**, bukan Cloudflare → tidak ada challenge JS / turnstile.
- Domain non-www (`maid.my.id`) di-redirect `301` ke `www.maid.my.id`.
- **Penting:** server memblokir User-Agent **Chrome 126** dengan `403`, tapi
  menerima UA **Safari**. Scraper sudah memakai UA Safari — jangan diganti
  sembarangan.
- Model data WordPress: **Category = series manga**, **Post = chapter**.
- Gambar chapter di CDN `cdn.imgchest.com`, di-load lazy (`data-lazy-src`).

## Setup

```bash
npm install
```

## Perintah (CLI)

```bash
node scraper.js home                          # manga + chapter terbaru
node scraper.js list                          # daftar semua manga (pagination)
node scraper.js az                            # daftar A-Z semua manga (type + ID)
node scraper.js series "slug"                 # metadata + daftar chapter
node scraper.js chapter "URL-chapter"         # daftar gambar chapter
node scraper.js post "URL-chapter"            # metadata chapter via REST
node scraper.js search "kata"                 # pencarian manga
node scraper.js genre "slug"                  # daftar manga per genre
node scraper.js genre-list                    # semua genre + jumlah
node scraper.js advanced [key=value ...]      # pencarian lanjutan
```

Contoh:

```bash
node scraper.js series furoufushi-shoujo-no-naedoko-ryokouki
node scraper.js chapter "https://www.maid.my.id/furoufushi-shoujo-no-naedoko-ryokouki-chapter-22-2-bahasa-indonesia/"
node scraper.js search solo
node scraper.js genre ecchi
node scraper.js advanced type=Manhwa genre=romance order=latest
node scraper.js advanced status=completed order=popular
node scraper.js advanced author=fuj year=2024 order=rating
```

Param `advanced`: `type` (Manga/Manhwa/Manhua/One-shot/Doujin), `status`
(ongoing/completed), `order` (latest/update/popular/rating/title/titereverse),
`genre` (bisa diulang), `title`, `author`, `year`. Catatan: `order` wajib agar
hasil muncul (default `latest`).

## API (import modul)

```js
import * as s from './scraper.js';

await s.home();                 // { total_items, items: [{title,url,poster,chapters[]}] }
await s.mangaList({ maxPages });
await s.mangaListAZ();          // { total_items, items: [{slug,title,url,type,id}] }
await s.series(slugOrUrl);      // { title, poster, score, author, published, genres[], chapters[] }
await s.chapter(url);           // { title, image_count, images: [{url, alt}] }
await s.search(query);
await s.genre(slugOrUrl);
await s.genreList();            // { total_genres, genres: [{slug,name,count,url}] }
await s.advancedSearch({ type, status, order, genre, title, author, year });
await s.post(url);              // { id, title, slug, date, categories[] }
```

## Struktur output `series`

```jsonc
{
  "slug": "furoufushi-shoujo-no-naedoko-ryokouki",
  "url": "https://www.maid.my.id/manga/.../",
  "title": "Furoufushi Shoujo no Naedoko Ryokouki",
  "poster": "https://www.maid.my.id/wp-content/uploads/...jpg",
  "score": "7.60",
  "author": "Luna Usagi, Fujihan",
  "published": "Jan 05, 2024",
  "total_chapter": "? Chapter",
  "genres": [{ "name": "Ecchi", "url": "https://www.maid.my.id/genres/ecchi/" }],
  "chapter_count": 43,
  "chapters": [{ "label": "Chapter 22.2", "url": "...", "date": "Agustus 29, 2026" }]
}
```

## Catatan

- Tidak ada endpoint `/random` yang andal (timeout) → tidak disediakan.
- Slug genre bisa di-enumerate via `genre-list` (56 genre) atau dari halaman series.
- `list` (route `/manga/`) default memindai sampai halaman terakhir (±56 halaman).
  Batasi dengan `{ maxPages: N }`. Alternatif: `az` (route `/manga-list/`) memberi
  semua 666 manga dalam 1 request, lengkap dengan type + post ID.
- `advanced` butuh param `order` agar hasil muncul (default `latest`).
- Ada section anime terpisah di `/anime/` (baru ±4 series) — belum di-scraper.

## Test

```bash
npm test
```
