# Nimegami Scraper

Scraper untuk **https://nimegami.id/** — situs download & streaming anime sub Indo.

Tanpa browser automation. Hanya HTTP request + parsing JSON/HTML.

## Instalasi

```bash
cd nimegami-scraper
npm install
```

## Pemakaian

```bash
node scraper.js home
node scraper.js search "solo leveling"
node scraper.js search "solo leveling" 2
node scraper.js genre "action"
node scraper.js genre "comedy" 2
node scraper.js genres
node scraper.js detail "https://nimegami.id/oni-no-hanayome-sub-indo/"
node scraper.js chapter "https://nimegami.id/oni-no-hanayome-sub-indo/"
```

Semua perintah mengeluarkan JSON.

## Testing

```bash
npm test
```

## Arsitektur

- **REST API WordPress** (`/wp-json/wp/v2/`) dipakai untuk: homepage, search, detail metadata, daftar media, pagination (`X-WP-Total` / `X-WP-TotalPages`).
- **HTML halaman posting** dipakai hanya untuk mengambil daftar episode + link download, karena link tersebut TIDAK tersedia lewat REST (`content` REST hanya berisi sinopsis).
- **Genre/kategori** diambil dari HTML `/category/{slug}/` (tidak ada REST route untuk kategori di situs ini).

## Struktur data

`detail()` mengembalikan `chapters` dengan bentuk:

```json
{
  "title": "Oni no Hanayome Episode 1 Sub Indo",
  "number": 1,
  "url": null,
  "date": null,
  "downloads": [
    {
      "quality": "360p",
      "links": [
        { "label": "Berkasdrive", "url": "https://..." },
        { "label": "Usersdrive", "url": "https://..." }
      ]
    }
  ]
}
```

## Catatan

- Situs ini anime, bukan manga/komik. Konsep "chapter" di sini = episode anime.
- Link download mengarah ke layanan file eksternal (Berkasdrive, Usersdrive, dsb).
- Cache in-memory 10 menit dipakai agar request sama tidak berulang.