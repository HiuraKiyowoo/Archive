# okyykomik-scraper

Scraper **zero-dependency** untuk [www.okyykomik.my.id](https://www.okyykomik.my.id/) — situs baca manga/manhwa/manhua bahasa Indonesia.

Node.js ≥ 18 (pakai `fetch` bawaan). Tidak ada `npm install`, tidak ada browser automation.

## Kenapa Blogger Feed API, bukan parsing HTML?

`www.okyykomik.my.id` adalah blog **Blogger/Blogspot** dengan custom domain (CNAME ke `ghs.google.com`). Blogger menyediakan feed JSON resmi yang mengembalikan *seluruh* isi post:

```
https://www.okyykomik.my.id/feeds/posts/default?alt=json&max-results=100
```

Jadi datanya diambil dari feed itu — bukan dari scraping HTML halaman. Konsekuensinya:

- satu request bisa membawa ratusan post lengkap dengan `content` (HTML body), label, tanggal, jumlah komentar;
- tidak ada Cloudflare / anti-bot;
- `robots.txt` hanya melarang `/search` (dipatuhi: scraper ini **tidak** menyentuh `/search`, kecuali endpoint feed `q=` yang memang bagian dari API feed).

HTML body post tetap diparse, karena metadata series (rating, author, sinopsis, dll.) ditulis di dalam body post oleh tema, bukan sebagai field feed.

## Struktur data situs

Post series dan post chapter hidup di **satu feed yang sama**. Pembedanya label:

- post ber-label `Series` → halaman series (41 judul)
- post ber-label `Chapter` → satu chapter (≈497 post)
- total post ≈538

## Empat jebakan yang sudah ditangani

**1. Pagination Blogger dibatasi ukuran respons, bukan `max-results`.**
Minta `max-results=100` bisa dijawab 72 entri. Kalau `start-index` dimajukan `+100` secara buta, puluhan post hilang tanpa error. `collect()` memajukan cursor **sebanyak entri yang benar-benar diterima**, lalu berhenti saat feed balas kosong. Terbukti: 538/538 post terkumpul, nol duplikat.

**2. Label seri di post chapter sering versi PENDEK dari judul series.**
Contoh: series `Shinmai Necromancer, Maou wo Sosei suru` — chapter-nya cuma ber-label `Shinmai Necromancer`. 16 dari 41 series begini. Memasangkan chapter ke series lewat pencocokan judul akan gagal.
Solusi: bangun peta label → series dari **label unik**. Label yang hanya dipakai oleh satu post `Series` dianggap label judul series itu (setelah label sistem — genre, status, tipe, negara, rating — disingkirkan). Chapter lalu dipasangkan lewat label tersebut.

**3. Judul di feed masih ber-entitas HTML.**
`Why You Shouldn&#39;t Enter a Haunted House`. Pencarian series harus men-decode entitas di kedua sisi, kalau tidak judul ber-apostrof tidak akan ketemu.

**4. Gambar Blogger disajikan dalam ukuran thumbnail.**
URL feed berisi segmen ukuran seperti `/s72-c/` atau `/w200-h300/`. Semua URL gambar (cover maupun halaman chapter) dinaikkan ke `/s0/` supaya dapat resolusi asli. Cover placeholder blog (`OkyyKomik.jpg`) juga dilewati; sumber cover dicari berurutan: gambar pertama di body post → `media$thumbnail` → placeholder.

## Pemakaian sebagai library

```js
import {
  latest, latestChapters, seriesList, seriesDetail,
  chapter, chapterImages, search, labels, byLabel,
  stats, sitemap, walkSeries,
} from "./src/index.js";

// katalog lengkap 41 series
const kat = await seriesList({});
console.log(kat.total_series);          // 41

// filter gabungan
await seriesList({ status: "Ongoing", type: "Manhwa", genre: "Romance" });

// detail + seluruh chapter (urut DESC)
const d = await seriesDetail("Villain Classroom");
console.log(d.data.rating, d.data.author, d.data.chapter_total);

// satu chapter: gambar resolusi asli + nav prev/next
const c = await chapter(d.data.chapters[0].slug);
console.log(c.data.image_count, c.data.nav.prev?.chapter);
```

Semua fungsi mengembalikan bentuk seragam:

```js
{ source: "okyykomik.my.id", command, url, ok: true, ...meta, data }
```

Error dilempar sebagai `HttpError` (punya `.status` dan `.url`) atau `TypeError` untuk argumen tidak valid.

### Fungsi

| Fungsi | Kegunaan |
|---|---|
| `latest({ limit })` | post terbaru (series + chapter campur) |
| `latestChapters({ limit })` | chapter terbaru saja, sudah terpasang ke series induk |
| `seriesList({ limit, status, type, country, genre })` | katalog series + filter |
| `seriesDetail(judul \| label \| slug)` | metadata lengkap + seluruh daftar chapter |
| `chapter(slug \| id \| judul)` | gambar chapter + nav prev/next + info series |
| `chapterImages(...)` | hanya array URL gambar |
| `search(kata, { limit })` | cari post lewat feed `q=` |
| `labels()` | semua label dikelompokkan: genre / sistem / nama seri |
| `byLabel(nama, { limit })` | post ber-label tertentu |
| `stats()` | total post, series, chapter, sebaran status & tipe |
| `sitemap()` | semua URL post dari `sitemap.xml` |
| `walkSeries({ limit })` | rangkuman per series (jumlah & rentang chapter) |

## CLI

```bash
node cli.js latest 10
node cli.js chapters --limit=15
node cli.js series --type=Manhwa --status=Ongoing
node cli.js detail "Villain Classroom"
node cli.js chapter villain-classroom-chapter-27
node cli.js images villain-classroom-chapter-27
node cli.js search regressor
node cli.js labels
node cli.js label Romance 20
node cli.js stats
node cli.js sitemap
node cli.js walk 3
```

Output JSON ke stdout; error JSON ke stderr dengan exit code 1. Tanpa argumen (atau `--help`) menampilkan bantuan dan exit 0.

## Test

```bash
npm test          # node --test test/index.test.js
```

21 test **live** terhadap situs asli — memvalidasi isi, bukan cuma status HTTP:

- 538 post terkumpul utuh lewat pagination, nol duplikat
- 41 series, urut abjad, id unik
- filter `status`/`type`/`country`/`genre` benar-benar menyaring
- metadata series lengkap (rating, author, artist, tahun, sinopsis bersih tanpa tag/entitas, genre, tags, cover resolusi asli)
- chapter urut DESC tanpa duplikat; nav prev/next dua arah, ujung daftar benar (`next` kosong di terbaru, `prev` kosong di terlama)
- gambar chapter **benar-benar diunduh** dan magic number-nya diperiksa (JPEG/PNG/WEBP)
- judul ber-apostrof dan label seri versi pendek tetap ketemu
- label genre bersih dari label sistem, rating, dan nama seri
- search relevan; kata ngawur balas 0 hasil
- error 404 & `TypeError` untuk input tidak valid
- audit anti-null: field inti terisi di 41/41 series

### Catatan batasan sumber

Dua hal berikut adalah batasan data yang diisi pemilik blog, bukan kegagalan parser — diverifikasi live dan diuji dengan ambang batas di test:

- `rating` kosong di **4 dari 41** series (blog belum memberi label rating)
- `author`, `artist`, `year_published`, `country_full` kosong di **16 dari 41** series (post-nya tidak punya blok extra-info)

Field inti (`id`, `title`, `slug`, `url`, `cover`, `status`, `type`, `country`, `genres`, `published`, `updated`, `synopsis`, `chapter_total`) terisi di **41/41** series.
