# DonghuaStream Scraper

Scraper untuk **https://donghuastream.org/** — situs streaming & download donghua (Chinese anime) multi-subtitle.

Tanpa browser automation. Hanya HTTP request + parsing JSON/HTML.

## Instalasi

```bash
cd donghuastream-scraper
npm install
```

## Pemakaian

```bash
node cli.js list
node cli.js series "a-record-of-mortals-journey-to-immortality-season-5"
node cli.js episode "https://donghuastream.org/a-record-of-mortals-journey-to-immortality-season-5-episode-13-ep-189-multiple-subtitles/"
node cli.js post "https://donghuastream.org/a-record-of-mortals-journey-to-immortality-season-5-episode-13-ep-189-multiple-subtitles/"
```

Semua perintah mengeluarkan JSON.

## Testing

```bash
npm test
```

## Arsitektur

- **REST API WordPress** (`/wp-json/wp/v2/posts`) dipakai untuk: resolve slug ke post ID + metadata post (judul, tanggal, kategori, tag).
- **HTML halaman `/az-lists/`** dipakai untuk daftar semua anime; ada pagination di `/az-lists/pagg/N/`.
- **HTML halaman `/anime/{slug}/`** dipakai untuk daftar episode (`.eplister`).
- **HTML halaman episode** dipakai untuk streaming + download link:
  - Streaming: iframe Dailymotion, atribut `data-litespeed-src` (lazy-load LiteSpeed).
  - Download: section `.soraddlx` berisi nama server + link (mis. Vikingfile).

Catatan: link download TIDAK tersedia lewat REST (`content` REST cuma berisi sinopsis singkat), jadi wajib fetch HTML halaman episode.