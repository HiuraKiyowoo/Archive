# Archive

Kumpulan scraper situs anime / manga / manhwa / donghua. Semua Node.js ≥ 18, output JSON,
HTTP-first (tanpa browser automation kecuali disebut lain).

## Struktur repo

```
scrapers/<nama>-scraper/     project lengkap — library + CLI + test
├── src/index.js             library murni, tanpa side effect (aman di-import)
├── cli.js                   entry CLI, semua output JSON ke stdout
├── test/                    test live (validasi isi JSON, bukan cuma HTTP 200)
├── package.json
├── README.md
└── API.md                   (opsional) referensi tiap fungsi

anime/*.js                   script lepas satu file, belum jadi project
manhwa/*.js
```

## Scraper

| Folder | Situs | Jenis | Dep | Test |
|---|---|---|---|---|
| `scrapers/mangatoon-scraper` | mangatoon.mobi | komik, 5 bahasa | zero-dep | 42 |
| `scrapers/kanzenin-scraper` | kanzenin.info | manga/manhwa ID | zero-dep | 27 |
| `scrapers/anime-indo-scraper` | anime-indo.lol | anime stream+download | zero-dep | 20 |
| `scrapers/ainz-scraper` | v3.ainzscans01.com | manhwa (API JSON) | zero-dep | 14 |
| `scrapers/nimegami-scraper` | nimegami.id | anime download+stream | axios + cheerio | 18 |
| `scrapers/mangasusuku-scraper` | mangasusuku.com | manga/manhwa ID | zero-dep | 12 |
| `scrapers/komikindo-scraper` | komikindo.ch | komik ID | cheerio | 12 |
| `scrapers/maid-scraper` | maid.my.id | manga/manhwa ID | axios + cheerio | 10 |
| `scrapers/nhentai-scraper` | nhentai.net | doujin | zero-dep | 6 |
| `scrapers/donghuastream-scraper` | donghuastream.org | donghua | axios + cheerio | 5 |

Script lepas (belum jadi project, jalankan langsung dengan `node`):
`anime/anichin.js`, `anime/animein.js`, `anime/wibuku.js`, `manhwa/keikomik.js`, `manhwa/voratoon.js`.

## Pemakaian

```bash
cd scrapers/<nama>-scraper
npm install        # hanya untuk yang punya dependency
node cli.js        # tanpa argumen -> daftar perintah
npm test           # test live, butuh koneksi internet
```

Sebagai library:

```js
import { home, search, series } from './src/index.js';
```

## Konvensi

- `src/index.js` tidak boleh punya side effect saat di-import — CLI hidup di `cli.js`.
- Test memakai jaringan sungguhan dan memvalidasi **isi** JSON. HTTP 200 saja tidak dihitung lolos.
- Field yang kosong di sisi situs dibiarkan kosong dan dicatat di README masing-masing,
  bukan diisi placeholder.
- Quirk situs (markup ganda, pagination aneh, angka `253.6M`) ditangani di parser dan
  ditulis sebagai komentar beserta bukti live-nya.
- `robots.txt` dan ToS situs dihormati; route yang dilarang tidak dipakai.
- `node_modules/` tidak masuk repo (lihat `.gitignore`).
