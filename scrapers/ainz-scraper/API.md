# Ainz Scans ID — API Reference (v3.ainzscans01.com)

Di-bongkar 2026-08-30 via network capture (Playwright) + grep 196 JS chunks SvelteKit + live probe.

## Proteksi
- Cloudflare ada (server: cloudflare, cf-ray) tapi **LENIENT** — TIDAK ada challenge/Turnstile/clearance cookie.
- WAF cuma blokir **UA bot default** (`Python-urllib/3.13` → 403). UA browser/curl → 200.
- **Solusi: set User-Agent browser. Tanpa itu 403.**
- Rate-limit: belum di-trigger, tapi jaga-jaga pakai spacing 1s.

## Stack
- Frontend: SvelteKit SPA (HTML shell, data via API client).
- Backend: NestJS REST API (pola error `{"message":"Route GET:/x not found","statusCode":404}`).
- API base: `/api` (bisa override via env `PUBLIC_API_BASE_URL`, fallback `http://api:3000/api`).
- CDN gambar: `cdn.uqni.net` (cover) + `api.ainzscans01.com/api/uploads/...`.

## Endpoint (semua GET, JSON)
Base: `https://v3.ainzscans01.com`

| Fungsi | Path |
|---|---|
| Search | `/api/search?q=<query>&page=<n>` |
| Home sections | `/api/comic/home-sections` |
| Detail series | `/api/series/comic/<slug>` (juga `anime`, `novels`) |
| Detail chapter | `/api/series/comic/<slug>/chapter/<chapter-slug>` |
| Genre list | `/api/genres` |
| Komentar | `/api/comments?entity_id=<id>&unit_id=<id>&limit=&offset=` |
| Settings | `/api/site/settings` |

## Shape respons

### /api/search?q=&page=
```
{ data: [ {id, type:"COMIC", title, slug, alternative_titles, synopsis,
  poster_image_url, banner_image_url, language, age_rating, is_adult,
  release_year, first_release_date, rating_average, rating_count,
  followers_count, readers_count, view_count, is_published,
  is_premium_enabled, default_chapter_coin_price, created_at, updated_at,
  comic_subtype:"MANHUA|MANGA", comic_status, series_status,
  author_name, artist_name, ...} ],
  page, limit, total, total_pages }
```

### /api/series/comic/<slug>
```
{ id, type, title, slug, synopsis, poster_image_url, banner_image_url,
  comic_subtype, comic_status, series_status, author_name, artist_name,
  publisher_name, genres:[{id,slug,name}],
  uploaders:[{id,username,avatar_url,role}],
  units: [ ...chapter... ],   # daftar chapter series ini
  ... }
```

### /api/series/comic/<slug>/chapter/<chapter-slug>
```
{ series: {id,title,slug,poster_image_url,...},
  chapter: { id, number, sort_number, slug, title, cover_image_url,
             coin_price, created_at, is_premium, is_locked,
             pages: [ {id, page_number, image_url, width, height}, ... ] },
  units: [ ...semua chapter... ],
  previous_chapter: {...}|null,
  next_chapter: {...}|null }
```
- `chapter.pages[].image_url` = **URL gambar chapter** (di `cdn.uqni.net/.../NNN-hash.webp`).
- Gambar = strip vertikal lebar 1000px (manhwa webtoon). Download langsung, tanpa header khusus (Referer opsional).
- `units` di sini = daftar **chapter** (bukan halaman).

### /api/comic/home-sections
```
{ hot_weekly:[...], popular_daily:[...], latest_projects:[...],
  latest_comic_updates:[ {series_id,series_title,series_slug,
      poster_image_url, chapters:[{id,number,slug,title,coin_price,is_premium}], ...} ] }
```

## Konvensi nama
- Type: `COMIC` → path `comic`, `ANIME` → `anime`, `NOVEL` → `novels`.
- Chapter slug: `chapter-49` (number 49.00). Di-`encodeURIComponent`.
- Cover domain beda-beda: `cdn.uqni.net`, `api.ainzscans01.com`, `adminv2.ainzscans01.com`.

## Catatan
- Detail series `units` kadang kosong (series baru / belum ada chapter) — pakai `home-sections` atau search buat dapat series yang aktif.
- Chapter endpoint butuh `series_slug` LENGKAP (jangan dipotong).
- Endpoint `/data.json` SvelteKit = 404 (server balikin SPA shell) — ini client-only routing, TIDAK bisa di-scrape via SSR.
