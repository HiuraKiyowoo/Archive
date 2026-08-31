# animexin-scraper

Scraper HTTP untuk **[animexin.dev](https://animexin.dev/)** — situs donghua (animasi China) dengan subtitle Indonesia & English.

- **Zero dependency**, cuma butuh Node.js ≥ 18 (`fetch` bawaan).
- Murni HTTP + parsing HTML. Tidak pakai browser, tidak pakai Puppeteer/Playwright.
- 22 test live, semua memvalidasi **isi JSON**, bukan cuma status HTTP 200.

## Pemakaian cepat

```bash
node cli.js home
node cli.js detail renegade-immortal
node cli.js episode renegade-immortal-episode-156-indonesia-english-sub
```

Sebagai library:

```js
import { seriesDetail, episode } from './src/index.js';

const s = await seriesDetail('renegade-immortal');
console.log(s.data.title, s.data.chapter_count);

const e = await episode(s.data.chapters[0].url);
console.log(e.data.mirrors.map((m) => m.label));
```

## Perintah CLI

| Perintah | Keterangan |
|---|---|
| `home` | Rilis episode terbaru di halaman depan |
| `series [hal] [--order= --genre= --status= --type=]` | Katalog series, 30 per halaman |
| `detail <slug\|url>` | Metadata series + seluruh daftar episode |
| `episode <slug\|url>` | Mirror stream, tautan unduhan, navigasi |
| `search <kata> [hal]` | Pencarian judul |
| `genres` | 41 genre (dari sitemap) |
| `taxlist <taxonomy>` | Daftar entri taxonomy: `genres`, `studio`, `season`, `network`, `country`, `label`, `cast`, `director` |
| `taxonomy <tax> <slug> [hal]` | Listing series di dalam satu taxonomy |
| `schedule` | Jadwal rilis mingguan |
| `sitemap` | 301 series dari `anime-sitemap.xml` |
| `walk-series [maxPages]` | Iterasi katalog sampai habis, sudah dedup |

Nilai `--order`: `title`, `titlereverse`, `update`, `latest`, `popular`, `rating`, `oldest`.

## Tiga jebakan situs ini

**1. Semua path `/anime/*` diblokir Cloudflare.** Arsip `/anime/` dan `/anime/{slug}/` selalu balas **403 "Just a moment"**, sementara halaman series yang sama dapat dibuka tanpa prefix (`/{slug}/`). Jadi:

- katalog series → `/?post_type=anime&page=N` (bukan `/anime/`)
- detail series → `/{slug}/`

`toSeriesUrl()` otomatis membuang prefix `/anime/`, termasuk untuk URL yang datang dari `/schedule/` (di sana beberapa link memang memakai prefix terblokir itu — ditandai `blocked_path: true`).

**2. Kelas CSS tema muncul di dalam `<style>`.** Halaman `/season/{slug}/` mengandung 11 kemunculan string `bsx`, semuanya aturan CSS, nol kartu asli. Menghitung kartu tanpa membuang `<style>`/`<script>` dulu menghasilkan angka palsu — itu tugas `declutter()`. Halaman season juga memakai markup berbeda (`.listseries > .card`), ditangani `parseSeasonCards()`.

**3. Daftar genre di `/genres/` tidak lengkap.** Halaman itu hanya menampilkan genre yang dipakai series yang sedang tampil → 12 unik. Sumber lengkapnya `genres-sitemap.xml` → **41 genre**. Pola yang sama berlaku untuk taxonomy lain: studio 69, season 24, network 12, label 3, country 2.

## Struktur data

`seriesDetail()` → 26 field, di antaranya:

```
id, title, alternative_title, slug, poster, status, type, network, studio,
country, released, duration, episodes_declared, fansub, posted_by,
released_on, updated_on, date_published, date_modified, rating, rating_votes,
genres[], synopsis, synopsis_en, synopsis_id, chapter_count, chapters[]
```

`chapters[]` terurut DESC (terbaru dulu), tiap entri: `number`, `title`, `subtitle`, `date`, `url`.

`episode()`:

```
title, slug, episode, type, series{url,title},
mirrors[]   -> { label, host, embed, kind }
downloads[] -> { language, quality, vip, links[{provider,url}] }
prev, next, all_episodes, date_published, date_modified
```

Catatan soal mirror: `embed` adalah URL **iframe pihak ketiga** (Dailymotion, Odysee, ok.ru, Mega, Rumble, D.Tube, SeekPlayer, PlayMogo), bukan file MP4/HLS langsung. Nilainya di-base64 pada `<option value>` dan sudah didekode. Contoh nyata: Renegade Immortal ep 156 → 16 mirror, 8 jenis host.

Blok download terakhir biasanya "Membership VIP" (tautan Ko-fi, kualitas 4K) — tetap diambil tetapi ditandai `vip: true`, dan `download_count` hanya menghitung yang non-VIP.

## Metadata `.spe`

Nilai di tabel metadata series tidak selalu teks polos: `Network`/`Studio`/`Country` berupa `<a>`, `Posted by` berupa `<i class="fn">`, `Released on`/`Updated on` berupa `<time datetime>`. Parser mengambil seluruh isi `<span>` setelah `</b>` lalu membersihkan tagnya, jadi ketiga bentuk itu tertangkap.

Field `season` **null** untuk banyak series termasuk Renegade Immortal — situs memang tidak mengisinya di tabel `.spe`. Untuk data musim, pakai `taxonomy('season', slug)`.

## Test

```bash
npm test          # node --test test/index.test.js
```

22 test live, ~41 detik. Yang divalidasi antara lain:

- paginasi halaman 1 vs 2 tidak tumpang tindih, halaman 12 kosong
- `--order` dan `--status` benar-benar mengubah hasil (bukan diterima lalu diabaikan)
- nilai metadata spesifik: `studio == "Build Dream"`, `episodes_declared == 180`, `duration == "25 min"`
- integritas daftar episode: urutan DESC, nomor tanpa duplikat
- navigasi episode bolak-balik: ep 156 → prev 155 → next kembali 156
- audit anti-null pada 20 field series + 9 field episode
- `/anime/` memang melempar `BlockedError`/`HttpError`, bukan lolos diam-diam
- slug tidak ada → error 404, bukan objek kosong

## Transport

`src/http.js` memakai `fetch` bawaan Node dengan header UA Chrome desktop. Node native fetch **lolos** Cloudflare di situs ini (tidak seperti nhentai yang memblokir TLS fingerprint Node). Ada retry berjenjang untuk 429/5xx, jeda antar-request 700 ms, cache in-memory, dan `BlockedError` khusus saat halaman challenge terdeteksi.
