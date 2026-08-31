# mangasusuku-scraper

Scraper zero-dependency untuk **mangasusuku.com** (Mangasusu — baca manga/manhwa bahasa Indonesia). Node.js >= 18, tanpa `npm install`.

## Stack site (audit 2026-08-31)

| Komponen | Detail |
|---|---|
| CMS | WordPress 7.1 + theme `mangareader` (Madara clone) — **server-rendered HTML** |
| WAF | **Sucuri Cloudproxy** — challenge JS intermittent per-IP |
| Search | `/?s=<q>` + `&paged=<n>` — **10 hasil/page** (kata umum "the" = 51 page) |
| AZ list | `/az-list/?show=<huruf\|0-9\|.\>` — 1 halaman per huruf |
| Genre | `/genres/<slug>/page/<n>/` — 10 series/page (romance = 72 page) |
| Series | `/komik/<slug>/` — metadata + sinopsis + `post_id` (dari `class="post-N"`) |
| Chapter list | `POST /wp-admin/admin-ajax.php` body `action=get_chapters&id=<post_id>` |
| Reader | `/<slug>-chapter-<n>/` — gambar di `#readerarea` |
| Chapter desimal | ch-67.5 → slug `chapter-67-5` (helper `chapterSlug()`) |

## Anti-bot (penting)

Site dibalik **Sucuri Cloudproxy**. Challenge-nya **intermittent per-IP**:
- Biasanya: request biasa (Node `fetch` / curl + UA browser) langsung 200.
- Kadang: balas `307` + halaman "You are being redirected..." berisi JS
  (blob base64 + `eval`) yang set cookie `sucuri_cloudproxy_uuid_*` + reload.
  Cookie tsb **tidak bisa disimulasikan manual** (one-time nonce).
- **Solusi saat kena**: buka site sekali pakai browser sungguhan
  (Playwright headless, atau browser lu) — JS challenge jalan otomatis,
  setelah itu IP lu "bersih" lagi untuk request HTTP biasa.
- Library sudah auto-retry + fallback `curl` (fingerprint beda), dan throw
  error jelas kalau challenge belum kepecah.

## Cara pakai (CLI)

```bash
node cli.js search "leveling"               # cari (10/page)
node cli.js search "the" --page 2           # halaman 2 (dari 51)
node cli.js az A                            # AZ list (A-Z, 0-9, .)
node cli.js all --letters A,B               # semua series (loop huruf)
node cli.js genres                          # daftar genre (16)
node cli.js genre romance --page 2          # series per genre (pagination)
node cli.js series solo-leveling            # detail + daftar chapter
node cli.js images solo-leveling-chapter-155     # list URL gambar
node cli.js images wireless-onahole-chapter-67-5 # chapter desimal
node cli.js download solo-leveling-chapter-155 --out ./ch155
node cli.js download solo-leveling-chapter-155 --out ./ch155 --first 3
```

## Cara pakai (library)

```js
import { search, azList, allSeries, genres, byGenre, series,
         chapterImages, chapterSlug, downloadChapter } from "./src/index.js";

const r  = await search("the", { page: 2 });        // {items, page, max_page}
const az = await azList("A");                       // [{url,title,image,status,latest,rating}]
const g  = await genres();                          // [{slug,name}] x16
const gp = await byGenre("romance", { page: 2 });   // {items, page, max_page}
const d  = await series("solo-leveling");
// -> { slug, title, url, image, status, type, released, author, artist,
//      serialization, posted_on, updated_on, rating, followers, genres,
//      post_id, latest_chapter, synopsis, chapters: [{id, url, title}] }
const slug = chapterSlug("wireless-onahole", 67.5); // "wireless-onahole-chapter-67-5"
const c  = await chapterImages(slug);               // {url, number:67.5, title, pages, count}
await downloadChapter("solo-leveling-chapter-155", "./ch155");
```

## Catatan produksi

- **Cakupan chapter beda-beda per series** — solo-leveling cuma 7 chapter
  (149–155), wireless-onahole penuh 117 chapter (1–116). `series().chapters`
  (dari `admin-ajax get_chapters`) = daftar lengkap yang tersedia di site.
  Jangan asumsikan "cuma chapter terbaru".
- Search **punya pagination** (`&paged=N`, 10/page). Query yang gak ada =
  `items: []` (bukan error).
- Genre `romance` = 72 halaman x 10 series (~720 series).
- Chapter number bisa desimal (67.5 → `chapter-67-5`).
- Page di luar jangkauan (genre page > max) = throw `404 Not Found` (status 404).
- Rate-limit belum pernah ketemu; library bawa throttle 700ms + retry 3x
  + backoff + fallback curl.
- Test: `node --test test/index.test.js` (12 live tests).

## Endpoints ringkas

| Fungsi | Method | Path / data |
|---|---|---|
| Search | GET | `/?s=<q>&paged=<n>` |
| AZ list | GET | `/az-list/?show=<A..Z\|0-9\|.\>` |
| Genre | GET | `/genres/<slug>/page/<n>/` |
| Series | GET | `/komik/<slug>/` |
| Chapter list | POST | `/wp-admin/admin-ajax.php` · `action=get_chapters&id=<post_id>` |
| Reader | GET | `/<slug>-chapter-<n>/` (img di `#readerarea`) |
| Cover | GET | `/wp-content/uploads/...` |
