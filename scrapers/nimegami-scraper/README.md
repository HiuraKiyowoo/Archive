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
node cli.js home
node cli.js search "solo leveling"
node cli.js search "solo leveling" 2
node cli.js genre "action"
node cli.js genre "comedy" 2
node cli.js genres
node cli.js detail "https://nimegami.id/oni-no-hanayome-sub-indo/"
node cli.js chapter "https://nimegami.id/oni-no-hanayome-sub-indo/"
```

Semua perintah mengeluarkan JSON.

## Testing

```bash
npm test
```

18 tes live: homepage, search, genre, daftar genre, detail ×3, metadata HTML,
stream+download per episode, integritas merge, chapter ×3, filter episode,
pagination, dan audit anti-null.

## Arsitektur

Data satu series datang dari **dua sumber** dan digabung, karena masing-masing
tidak lengkap sendirian:

| Sumber | Dipakai untuk |
|---|---|
| REST API WordPress (`/wp-json/wp/v2/`) | homepage, search, id/slug/tanggal, class_list, media, pagination (`X-WP-Total`) |
| Tabel `div.info2` di HTML | studio, rating, musim, durasi, subtitle, credit, judul alternatif, **type asli** |
| `#LinkDownload` di HTML | mirror unduhan per kualitas (Berkasdrive, Usersdrive, dll) |
| `li.select-eps[data]` di HTML | **link streaming** (base64 JSON) |
| HTML `/category/{slug}/` | daftar genre (tidak ada REST route kategori) |

`detailWithDownloads()` dan `chapter()` mengambil keempatnya. `detail()` hanya
REST — dipakai kalau cuma butuh metadata dasar dan mau hemat satu request.

### Kenapa HTML masih dibutuhkan

Diverifikasi live 2026-08-31 di `/oni-no-hanayome-sub-indo/`:

- REST tidak punya field studio, rating, musim, durasi, subtitle, credit sama sekali.
- REST `type` selalu `"post"`; type sebenarnya (`TV`, `OVA`, `ONA`, `Movie`) hanya
  ada di baris "Type" tabel `info2`.
- REST `title` termasuk embel-embel: `"Oni no Hanayome Sub Indo : Episode 1 – 12 (End)"`.
  Judul bersih (`"Oni no Hanayome"`) ada di baris "Judul" tabel.
- Link streaming path `/streaming/` **hanya** ada di atribut `data` base64 pada
  `li.select-eps`. Blok `#LinkDownload` isinya link unduhan mirror, path-nya beda.

## Struktur data

`detailWithDownloads()` — field dari HTML ditandai:

```json
{
  "id": 30520,
  "title": "Oni no Hanayome Sub Indo : Episode 1 – 12 (End)",
  "clean_title": "Oni no Hanayome",
  "alternative_title": "Onihana",
  "type": "TV",
  "studio": "Colored Pencil Animation Japan",
  "rating": 7.07,
  "rating_source": "MAL",
  "rating_raw": "7.07 [MAL]",
  "season": "Summer 2026",
  "release_year": 2026,
  "duration": "24 min per ep",
  "subtitle": "Indonesia",
  "credit": "Doronime",
  "series": "Oni no Hanayome",
  "genres": ["drama", "fantasy", "mythology", "romance", "urban-fantasy"],
  "categories": ["Drama", "Fantasy", "Mythology", "Romance", "Urban Fantasy"],
  "info": { "judul": "...", "studio": "...", "...": "seluruh tabel apa adanya" },
  "chapter_count": 9,
  "chapters": [ /* lihat di bawah */ ]
}
```

Tiap episode membawa unduhan dan streaming sekaligus:

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
        { "label": "Berkasdrive", "url": "https://stordl.halahgan.com/RkHVJR?name=..." },
        { "label": "Usersdrive", "url": "https://usersdrive.com/41lnj4xv5jsl.html" }
      ]
    }
  ],
  "streams": [
    {
      "quality": "360p",
      "urls": ["https://stordl.halahgan.com/streaming/RkHVJR?name=..."]
    }
  ]
}
```

## Catatan

- Situs ini anime, bukan manga/komik. Konsep "chapter" di sini = episode anime.
- Episode tidak punya halaman sendiri — semuanya inline di halaman series.
  `chapter(url, { number: 3 })` untuk mengambil satu episode saja.
- `chapter.url` dan `chapter.date` selalu `null`: situs tidak menyediakannya.
- **Jumlah stream bisa lebih sedikit dari jumlah unduhan** dan itu data situs,
  bukan parser kehilangan data. Terverifikasi dari HTML mentah: Asako Get You
  punya 2 `li.select-eps` vs 3 blok unduhan; Kimetsu Katanakaji 11 vs 12;
  Kimetsu Hashira 8 vs 9. Merge memakai nomor episode, jadi episode yang cuma
  ada di satu sumber tetap ikut — tidak ada episode hilang.
- `rating`, `season`, `alternative_title` bisa `null` untuk series yang barisnya
  memang tidak ada di tabel situs (mis. Kimetsu Katanakaji tanpa rating).
- Link download/stream mengarah ke layanan file eksternal (Berkasdrive, Usersdrive, dsb).
- Cache in-memory 10 menit dipakai agar request sama tidak berulang.
