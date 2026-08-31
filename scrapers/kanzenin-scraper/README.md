# kanzenin-scraper

Scraper zero-dependency untuk **kanzenin.info** (kanzenin — komik doujin bahasa Indonesia). Node.js >= 18, tanpa `npm install`.

## Stack site (audit 2026-08-31)

| Komponen | Detail |
|---|---|
| CMS | WordPress 7.1 + theme `mangareader` (Madara clone) — **server-rendered HTML** |
| WAF | **Cloudflare LENIENT** — 200 langsung, bahkan tanpa UA. Gak ada challenge |
| Search | `/?s=<q>&paged=<n>` — 10/page |
| AZ list | `/a-z-list/?show=<huruf\|0-9\|.\>` + `/a-z-list/page/<n>/` (per huruf) |
| Genre | `/genres/<slug>/page/<n>/` (romance = 127 halaman, 44 genre) |
| Series | `/manga/<slug>/` — **chapter list LANGSUNG di HTML** (gak perlu admin-ajax) |
| Chapter duplikat | ADA (rooftop-sex-king: 80 `li` → 77 unik) — library auto-dedup |
| Reader | `/<slug>-chapter-<n>/` — img di `#readerarea`, **CDN beda-beda** per series (cdnasu.xyz, cdn.uqni.net, dst) |
| Filter img | img valid = dari domain DI LUAR kanzenin.info (ads/cover selalu di domain site) |

## Cara pakai (CLI)

```bash
node cli.js search "love"                 # cari (10/page)
node cli.js search "love" --page 2        # halaman 2
node cli.js az A                          # AZ list (A-Z, 0-9, .)
node cli.js az 0-9 --page 2
node cli.js all --letters A,B             # semua series
node cli.js genres                        # 44 genre
node cli.js genre romance --page 3
node cli.js series rooftop-sex-king       # detail + chapter (dedup, desc)
node cli.js images torokeru-tsuma-chichi-chapter-2
node cli.js download torokeru-tsuma-chichi-chapter-2 --out ./ch2
node cli.js download torokeru-tsuma-chichi-chapter-2 --out ./ch2 --first 3
```

## Cara pakai (library)

```js
import { search, azList, allSeries, genres, byGenre, series,
         chapterImages, chapterSlug, downloadChapter } from "./src/index.js";

const r  = await search("love", { page: 2 });     // {items, page, max_page}
const az = await azList("A", { page: 1 });        // {items, page, max_page, letter}
const g  = await genres();                        // [{slug,name}] x44
const gp = await byGenre("romance", { page: 2 }); // {items, page, max_page}
const d  = await series("rooftop-sex-king");
// -> { slug, title, url, image, status, type, released, author, artist,
//      serialization, posted_on, updated_on, views, rating, followers, genres,
//      post_id, first_chapter, latest_chapter, synopsis,
//      chapters: [{number, url, title, date}] }  // DEDUP, urut desc
const slug = chapterSlug("rooftop-sex-king", 78); // "rooftop-sex-king-chapter-78"
const c  = await chapterImages(slug);             // {url, number, title, pages, count}
await downloadChapter(slug, "./ch78");
```

## Catatan produksi

- **CDN gambar beda-beda per series** (bahkan per chapter) — filter pakai
  domain (bukan hardcode CDN): di area `#readerarea`, ambil img dari domain
  luar kanzenin.info.
- **Chapter bisa duplikat** di HTML — `series()` auto-dedup by number.
- **Cakupan chapter beda per series**: rooftop-sex-king ch 2–78 (77 unik),
  series lain bisa beda. `series().chapters` = yang beneran ada.
- Rate-limit gak pernah ketemu; library bawa throttle 600ms + retry 3x +
  backoff + fallback curl.
- Test: `node --test test/index.test.js` (12 live tests).

## Endpoints ringkas

| Fungsi | Method | Path |
|---|---|---|
| Search | GET | `/?s=<q>&paged=<n>` |
| AZ list | GET | `/a-z-list/?show=<A..Z\|0-9\|.\>` (+ `/page/<n>/`) |
| Genre | GET | `/genres/<slug>/page/<n>/` |
| Series | GET | `/manga/<slug>/` |
| Reader | GET | `/<slug>-chapter-<n>/` (img di `#readerarea`) |
| Cover | GET | `kanzenin.info/wp-content/uploads/...` |
