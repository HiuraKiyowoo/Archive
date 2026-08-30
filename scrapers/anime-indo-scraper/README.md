# anime-indo.lol — Scraper (Node.js, pure HTTP)

Scraper lengkap untuk **https://anime-indo.lol/** berbasis **HTTP request + parsing HTML** —
**tanpa** Puppeteer/Playwright/Chromium di runtime. Situs ini server-rendered (template
OtakuDesu/Anitoki) di balik Cloudflare CDN; tidak ada JS-challenge dan tidak ada
API/XHR internal — semua data ada di HTML response.

## Struktur website (hasil bedah)

| Halaman | URL | Notes |
|---|---|---|
| Homepage | `/` , `/page/N/` | Section `Update Terbaru` (16 item, `<div class="list-anime">`) + `Popular` (10 item, `<table class="ztable">`) |
| Search | `/search.php?q=<q>` → 302 → `/search/<q>/` , `/search/<q>/page/N/` | Hasil `<table class="otable">` (10/item), label `TV / durasi / tahun` |
| Genre | `/genres/<slug>/` , `/genres/<slug>/page/N/` | `<table class="otable">`; action = **117 halaman** |
| Daftar genre | `/list-genre/` | A–Z |
| Detail | `/anime/<slug>/` | `<div class="detail">`: poster, genre (link), sinopsis; episode list `<div class="ep">` (hanya angka, tanpa judul/tanggal) |
| Episode | `/<slug>-episode-<n>/` | iframe player `#tontonin` + `<div class="servers">` (mirror `data-video`), nav Prev/Semua Episode |
| Player B-TUBE | `/btube3.php?url=<token>` | HTML VideoJS → `<source src="googlevideo.com/videoplayback?...&expire=...&sig=...">` — **MP4, signed, EXPIRING** |
| Player CEPAT | `xtwap.top/cepat.php?url=<token>` | HTML JWPlayer → `file: /play.php?n=...` → **HLS master** → varian `480p/720p/1080p` → `.ts` |
| Player GDRIVE | `gdplayer.to/x/?<token>` | JWPlayer + config/sumber di-dekripsi **client-side** (AES-CBC + PBKDF2, token single-use) — tidak di-reverse-engineer (lihat di bawah) |

### Chain stream (per hop)

```
episode page
  ├── B-TUBE  iframe src=/btube3.php?url=<tok>
  │     → GET btube3.php          (pure HTTP)
  │     → <source src=googlevideo.com/videoplayback?expire=…&sig=…&ip=…>   [MP4, SIGNED/EXPIRING, IP-BOUND]
  │     → GET range               (pure HTTP; verified 206 + "ftyp" mp4 box when the
  │                                egress IP matches the one bound in the signature —
  │                                e.g. from a static-IP host; may 403 from a rotating
  │                                egress pool, in which case re-resolve the episode)
  │
  ├── CEPAT   data-video=xtwap.top/cepat.php?url=<tok>
  │     → GET cepat.php           (pure HTTP)
  │     → JWPlayer "file": /play.php?n=…  → GET (HLS master, 3 varian)
  │     → GET ?q=720p             (media playlist, ~200 .ts segments)
  │     → GET segment_*.ts        (pure HTTP, verified: 200 video/mp2t, sync byte 0x47)
  │
  └── GDRIVE  data-video=gdplayer.to/x/?<tok>
        → GET /x/?<tok>           (HTML, pure HTTP)
        → config+sources: client-side AES-CBC/PBKDF2 decrypt of a single-use,
          time-bound token (verified: token berbeda di setiap load).
          Re-implementasi = bypass kontrol akses obfuscated provider → TIDAK dilakukan
          (aturan: jangan bypass akses yang memang dirancang membatasi).
        → hanya embed URL yang dilaporkan.
```

## Instalasi

```bash
node >= 18   # fetch global; TIDAK ADA dependency npm (dependencies: {})
```

## CLI

```bash
node scraper.js home [page]
node scraper.js search "keyword" [page]
node scraper.js genre "action" [page]
node scraper.js genres
node scraper.js detail "https://anime-indo.lol/anime/<slug>/"
node scraper.js episode "https://anime-indo.lol/<slug>-episode-<n>/"
node scraper.js stream "https://anime-indo.lol/<slug>-episode-<n>/"
```

Output: JSON konsisten (envelope `{source, command, url, ok, pagination, data}`).
URL boleh relatif (mis. `/anime/bleach/`) — akan di-normalisasi.

## API modul

```js
const { home, search, genre, genres, detail, episode, stream } = require('./scraper.js');
const r = await home(1);            // {data:{sections:{...}, counts:{...}}, pagination:{...}}
const s = await search('bleach', 2);
const g = await genre('romance', 1);
const d = await detail('/anime/bleach/');
const e = await episode(d.data.episodes[0].url);
const t = await stream(e.url);
```

## Field detail (jangan di-tebak)

Template situs tidak merender rating/status/studio/durasi/season/tahun di halaman detail —
field yang tidak ditemukan diisi `null` (dan `related` = `null`). Yang tersedia:
`title`, `alternative_title` (jika beda), `poster`, `genres[]`, `description`/`synopsis`,
`episodes[]` (`number, title=null, url, date=null, sub=true, dub=false` — situs Sub-Indo saja).

Listing (search/genre) justru punya label `type` (TV/Movie/…), `status`, `year`, `duration`.

## Pagination

Dibaca dari `<div class="pag">`. «/» = prev/next (bukan nomor halaman); halaman aktif
`<span class='cur'>N</span>` (bukan link); halaman terakhir = nomor terbesar di anchor
(yang muncul setelah `...`). `last` pada genre `action` = 117 — «/» tidak pernah
dianggap halaman terakhir.

## Efisiensi & etika request

- Delay 600 ms antar request (concurrency 1)
- Cache in-run per URL (tidak fetch ulang dalam satu proses)
- Timeout 20 s, retry hanya untuk 5xx/network (max 1x, backoff)
- **403/429/503: tidak di-retry** — error dilanjut sebagai kegagalan eksplisit
- Dedup episode (Set URL)

## Testing

```bash
node test/test.js    # atau: npm test
```

Suite menjalankan request nyata (home, search ×2, genre ×2, daftar genre, detail ×3,
episode, stream) dan memvalidasi isi JSON (bukan hanya HTTP 200), termasuk verifikasi
byte video: CEPAT → playlist HLS 720p + segmen MPEG-TS (sync byte `0x47`); B-TUBE →
`206` + MP4 `ftyp` box (dicatat informatif karena URL signed-nya mengunci egress IP
saat generation — dari host static-IP selalu lulus, dari pool egress rotasi bisa 403).

## Disclaimer

Scraper ini untuk edukasi/personal use. Hormati situs sumber: jangan scrape bulk,
jangan distribusi ulang konten, dan perhatikan bahwa URL stream B-TUBE bersifat
signed & akan kadaluarsa (perlu re-resolve dari halaman episode).
