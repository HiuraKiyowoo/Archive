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
node scraper.js series "slug"                 # metadata + daftar chapter
node scraper.js chapter "URL-chapter"         # daftar gambar chapter
node scraper.js post "URL-chapter"            # metadata chapter via REST
node scraper.js search "kata"                 # pencarian manga
node scraper.js genre "slug"                  # daftar manga per genre
```

Contoh:

```bash
node scraper.js series furoufushi-shoujo-no-naedoko-ryokouki
node scraper.js chapter "https://www.maid.my.id/furoufushi-shoujo-no-naedoko-ryokouki-chapter-22-2-bahasa-indonesia/"
node scraper.js search solo
node scraper.js genre ecchi
```

## API (import modul)

```js
import * as s from './scraper.js';

await s.home();                 // { total_items, items: [{title,url,poster,chapters[]}] }
await s.mangaList({ maxPages });
await s.series(slugOrUrl);      // { title, poster, score, author, published, genres[], chapters[] }
await s.chapter(url);           // { title, image_count, images: [{url, alt}] }
await s.search(query);
await s.genre(slugOrUrl);
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
- Tidak ada halaman indeks genre terpusat; slug genre diambil dari halaman series
  (mis. `ecchi`, `fantasy`, `magic`, `smut`).
- `list` default memindai sampai halaman terakhir (±56 halaman). Batasi dengan
  `{ maxPages: N }` kalau cuma butuh sebagian.

## Test

```bash
npm test
```
