# ainz-scraper

Zero-dep scraper untuk **Ainz Scans ID** (`https://v3.ainzscans01.com`) — situs webcomic (manhwa/manhua/manga) dengan SvelteKit SPA di depan + NestJS REST API di belakang Cloudflare (mode lenient).

Node >= 18, **tanpa dependency** (pakai global `fetch` + fallback `curl`).

## Proteksi / Bypass

- Cloudflare ada tapi **tanpa challenge** (gak ada Turnstile / "Just a moment..." / clearance cookie).
- WAF cuma blokir **User-Agent bot default** (403). UA browser → 200.
- TLS fingerprint Node **TIDAK** diblokir di site ini (beda dengan nhentai) — `fetch` native langsung lolos.
- Fallback `curl` otomatis kalau fetch kena 403/503/520 atau error jaringan.
- Rate-limit: belum ketemu, tapi library udah bawa retry+backoff (1.2s × n).

## Install & Test

```bash
node --test test/index.test.js   # 7/7 live test (butuh internet + curl)
```

## CLI

```bash
node cli.js search "leveling" --page 1     # cari comic
node cli.js home                            # hot/popular/latest + slug chapter terbaru
node cli.js series <slug>                   # detail series (metadata, genre, jumlah chapter)
node cli.js chapters <slug>                 # daftar chapter (asc, 49 item)
node cli.js chapter <slug> <chapter-slug>   # detail chapter (jumlah halaman + prev/next)
node cli.js images <slug> <chapter-slug>    # list URL gambar tiap halaman
```

Contoh nyata:
```bash
node cli.js images im-a-super-rich-guy-so-its-reasonable-for-me-to-be-a-scumbag chapter-49
# 1  https://cdn.uqni.net/users/244/2026/08/001-511298.webp
# 2  https://cdn.uqni.net/users/244/2026/08/002-700942.webp
# ...
```

## API Library

```js
import { search, homeSections, seriesDetail, chapterList, chapterDetail, getChapterImages, imageUrl } from "./src/index.js";

const r = await search("leveling", { page: 1 });          // { items, total, total_pages, ... }
const d = await seriesDetail("leveling-in-the-future");   // metadata + units (chapters)
const list = await chapterList("leveling-in-the-future"); // [{number, slug, title, is_premium, ...}]
const ch = await getChapterImages("leveling-in-the-future", "chapter-50");
// -> { series, chapter, pages: [{n:1, url:"https://cdn..."}, ...], prev, next }
```

## Endpoint (verifikasi live)

| Fungsi | Path |
|---|---|
| Search | `GET /api/search?q=&page=` |
| Home sections | `GET /api/comic/home-sections` |
| Detail series | `GET /api/series/{comic\|anime\|novels}/{slug}` |
| Detail chapter | `GET /api/series/{type}/{slug}/chapter/{chapter-slug}` |
| Genre | `GET /api/genres` |
| Komentar | `GET /api/comments?entity_id=&unit_id=&limit=&offset=` |
| Settings | `GET /api/site/settings` |

Detail lengkap shape respons: lihat `ainz_api.md` di repo parent / hasil rekon API.

## Catatan

- **Gak ada SSR** — `data.json` SvelteKit 404 (balik HTML shell). Semua data via API di atas.
- `seriesDetail.units` bisa kosong buat series baru; pakai `homeSections().latest_comic_updates` buat series aktif + slug chapter-nya.
- Gambar chapter = **strip vertikal** (webtoon) ~1000px wide, di `cdn.uqni.net`.
- Chapter endpoint butuh `series_slug` **lengkap** (jangan di-truncate).
- Tipe path: `COMIC→comic`, `ANIME→anime`, `NOVEL→novels`.
