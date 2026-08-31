# kanzenin-scraper

Scraper **zero-dependency** (Node ≥ 18) untuk [kanzenin.info](https://kanzenin.info) — komik doujin/manhwa bahasa Indonesia.

Semua data diambil dari HTML server-side. Tidak ada API JSON, tidak ada browser headless, tidak ada dependency npm.

## Stack site (audit 2026-08-31)

| Aspek | Nilai |
|---|---|
| CMS | WordPress 7.1 + theme `mangareader` (keluarga Madara/TS) |
| Rendering | HTML SSR penuh — chapter list ikut di HTML |
| CDN/proteksi | Cloudflare, **lenient** (HTTP 200 tanpa UA, tanpa challenge/Turnstile) |
| Encoding | `content-encoding: zstd` (dipakai `--compressed` di fallback curl) |
| Katalog | **2.362 series** (`/manga/?list`, cocok dgn walk `browse()`) |
| Genre | 44 |
| Gambar reader | CDN eksternal berganti-ganti: `cdnasu.xyz`, `cdn.uqni.net` (sebagian plain HTTP) |
| `admin-ajax.php` | ada, **tidak dipakai** (chapter list sudah di HTML) |

## Install

```bash
node --version   # >= 18
node cli.js home
```

## Route yang dipetakan

| Fungsi | Route site | Pagination |
|---|---|---|
| `home()` | `/` | — |
| `feed()` | `/feed/` | — |
| `project` | `/project/` + `/project/page/N/` | ✅ 104 halaman, `?page=N` 301 |
| `search(q)` | `/page/N/?s=q` | `max_page` |
| `browse(filter)` | `/manga/?page=N&genre[]=&status=&type=&order=` | `has_next` / `next_page` |
| `listMode()` | `/manga/?list` | 1 request, seluruh katalog |
| `azList(letter)` | `/a-z-list/?show=A` (+ `&page=N`) | `max_page` |
| `byGenre(slug)` | `/genres/<slug>/page/N/` | `max_page` |
| `genres()` | widget filter di `/manga/` | — |
| `series(slug)` | `/manga/<slug>/` | chapter list inline |
| `chapterImages(slug)` | `/<slug>-chapter-<n>/` | — |

## CLI

```bash
node cli.js home                                    # 4 section homepage + rilis terbaru
node cli.js feed                                    # 10 rilis terakhir (timestamp ISO)
node cli.js project --page 3                         # series garapan sendiri (20/page, 104 hal)
node cli.js project --all                           # walk semua (~65 s, 2068 series)
node cli.js genres                                  # 44 genre (id + slug + nama)

node cli.js search "love" --page 2                  # pencarian
node cli.js browse --type manhwa --status completed --order popular
node cli.js browse --genre 64,1693 --page 2         # filter genre pakai ID (dari `genres`)
node cli.js list-mode                               # SELURUH katalog 1 request (2328 series)
node cli.js az A --page 2                           # per huruf
node cli.js all A,B,C                               # gabung beberapa huruf
node cli.js genre romance --page 5                  # per genre (pakai slug)

node cli.js series rooftop-sex-king                 # metadata + semua chapter
node cli.js images rooftop-sex-king-chapter-78      # URL gambar per halaman
node cli.js download im-a-vampire-43 ./out --first 5
node cli.js slug rooftop-sex-king 67.5              # -> rooftop-sex-king-chapter-67-5
```

Semua output JSON ke stdout, error ke stderr + exit code 1.

## Filter `browse()`

- `order`: `title`, `titlereverse`, `update`, `latest`, `popular` (kosong = default site)
- `status`: `ongoing`, `completed`, `hiatus`
- `type`: `manga`, `manhwa`, `manhua`
- `genre`: array **ID numerik** (dari `genres()`), bisa lebih dari satu → AND

Nilai live: `completed` 2.112 + `ongoing` 250 = 2.362 (= total katalog, tanpa overlap); `manhwa` 231; genre `Vanilla` 450; genre `Yuri` 1.

## Catatan penting

- **Ambil URL chapter dari `series().chapters[].url`**, jangan bikin sendiri. Slug chapter di site tidak konsisten: umumnya `-chapter-<n>`, tapi ada `-chapter-45-end` dan ada yang tanpa kata "chapter" (`/im-a-vampire-43/`). `chapterSlug()` cuma best-effort.
- `data-num` di chapter list bisa non-numerik (`"45 End"`) → di-parse jadi `number` + `number_raw` + `label` + `is_end`.
- Chapter duplikat ada di HTML site (contoh `rooftop-sex-king`: 81 `li` → 78 unik) → otomatis di-dedup by nomor.
- Gambar reader difilter berdasarkan **host** (bukan domain `kanzenin.info`), bukan whitelist CDN, supaya tahan kalau CDN berganti.
- Sebagian gambar dilayani lewat **HTTP biasa** (bukan HTTPS). `downloadChapter()` mengirim header `Referer`.
- `listMode()` memakai `/manga/?list` (live, 2.362) — cocok persis dengan hasil walk `browse()`.
- Throttle default 600 ms antar request, retry + backoff pada 429/5xx. `fetch` dipakai lebih dulu, fallback ke `curl` kalau gagal.

## Batasan jujur

- Tidak ada endpoint komentar/rating write — read-only.
- `browse()` tidak dapat total halaman dari site (mode ini tidak merender `page-numbers`), hanya `has_next`. Kalau butuh total, pakai `listMode()` (1 request) lalu bagi 27.
- Beberapa series me-listing chapter tidak lengkap di halaman series-nya (contoh `torokeru-tsuma-chichi` cuma listing ch-2 walau ch-1 bisa dibuka). Parser mengikuti data site apa adanya, bukan menambal.
- Filter `order`/`type`/`status` yang tidak valid diabaikan site (fallback ke default), bukan error.
- Sebagian gambar dirender site dengan `http://`, tapi CDN-nya mendukung `https://` — aman di-upgrade sendiri kalau butuh (diuji: 29/29 URL http balik 200 juga via https).
- `/manga/list-mode/` **jangan dipakai** — halaman statis basi (`last-modified` Juni 2026, 2.328 series). `listMode()` sengaja memakai `/manga/?list` yang live (2.362).
- `project({ all: true })` walk 104 halaman (~65 s, 2.068 series). Semua ada di katalog utama, jadi ini subset — bukan sumber data terpisah.

## Test

```bash
node --test test/index.test.js
```

**27/27 pass** live (durasi ±30 s). Mencakup: 44 genre, semua filter browse + persistensi filter antar halaman, list-mode (termasuk cek `/list-mode/` yang basi), home 4 section, feed, project + pagination, search 3 kasus, az-list, byGenre, metadata series lengkap, dedup chapter, one-shot 1 chapter, `data-num` non-numerik, 3 varian slug chapter, upgrade http→https CDN, entity HTML, 404, dan download gambar nyata.
