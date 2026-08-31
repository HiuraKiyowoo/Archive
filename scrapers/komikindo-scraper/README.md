# komikindo-scraper

Node.js scraper untuk **komikindo.ch** — baca komik/manga/manhwa/manhua bahasa Indonesia.

## Install

```bash
npm install
```

## CLI

```bash
node cli.js home                          # homepage
node cli.js search "solo leveling"        # cari komik
node cli.js search "swordmaster" 2        # cari + halaman 2
node cli.js genre action                  # daftar komik per genre
node cli.js genre romance 2               # genre + halaman 2
node cli.js detail "https://komikindo.ch/komik/magic-emperor/"
node cli.js chapter "https://komikindo.ch/magic-emperor-chapter-901/"
```

Output berupa JSON.

## Fitur

- Homepage: title, url, thumbnail, type (Manhwa/Manhua/Manga), latest chapter, rating
- Search: query + pagination
- Genre: slug + pagination (total page otomatis)
- Detail: title, alt title, poster, synopsis, author, artist, status, type, genres, rating, daftar chapter (nomor + url)
- Chapter: daftar gambar berurutan (tanpa download)
- Timeout 30 detik, retry 3x, cache in-memory, dedupe, filter iklan

## Test

```bash
npm test
```

Menjalankan 12 skenario nyata: home, search ×2, genre ×2, detail ×3, chapter ×3, pagination.

## Struktur

```
komikindo-scraper/
├── src/
│   └── index.js
├── cli.js
├── package.json
├── README.md
└── test/
    └── test.js
```