# moviezone-scraper

Scraper zero-dependency (Node.js >= 18, `fetch` bawaan) untuk **moviezone.web.id** —
katalog film & serial berbahasa Indonesia.

**Pakai API, bukan parsing HTML.** Situsnya Next.js 14 App Router di Vercel;
daftar filmnya diisi oleh komponen client lewat route handler internal
`/api/movies/*`, jadi HTML awalnya tidak memuat daftar apa pun. Datanya sendiri
berasal dari **TMDB** (poster ke `image.tmdb.org`, nama genre sudah dilokalkan
ke bahasa Indonesia, pesan error TMDB bocor apa adanya ke respons).

## Catatan robots.txt — baca dulu

```
User-agent: *
Allow: /
Disallow: /api/
```

`robots.txt` situs ini **melarang** crawler otomatis menyentuh `/api/*`.
Scraper ini memakai `/api/*` karena itu satu-satunya sumber data (HTML tidak
memuat daftarnya). Karena itu transport-nya dibuat sopan: **serial, satu
koneksi, jeda 1,2 detik per request, tanpa paralelisme**. Konsekuensi
pemakaiannya ada di tangan kamu.

## Pemakaian

```bash
node cli.js --help

node cli.js trending --pretty
node cli.js popular --type tv --pages 3
node cli.js discover --genre horror --page 2
node cli.js search --q "spider" --pretty
node cli.js detail movie-860508
node cli.js episodes tv-108978 --season 1
node cli.js all-episodes tv-108978
```

Sebagai modul:

```js
import { getTrending, discover, getDetail, getSemuaEpisode } from "./src/index.js";

const tren = await getTrending({ page: 1 });
const horor = await discover({ genre: "horror", type: "movie", page: 1 });
const film = await getDetail("movie-860508");
const serial = await getSemuaEpisode("tv-108978");
```

## API

| Fungsi | Endpoint upstream | Keluaran |
|---|---|---|
| `getHero()` | `/api/movies/hero` | 6 judul slider, punya `titleLogo` |
| `getTrending({page})` | `/api/movies/trending` | 20/hal, Movie + Series campur |
| `getPopular({type,page})` | `/api/movies/popular` | 20/hal (`type:"all"` → 40) |
| `getTopRated({type,page})` | `/api/movies/top-rated` | 20/hal |
| `getLatest({type,page})` | `/api/movies/latest` | 20/hal (`type:"all"` → 40) |
| `getUpcoming({page})` | `/api/movies/upcoming` | film saja, katalog pendek |
| `getGenres()` | `/api/movies/genres` | 27 genre + ID TMDB |
| `discover({genre,type,page})` | `/api/movies/discover` | 20/hal per genre |
| `search({q,page})` | `/api/movies/search` | 20/hal |
| `getDetail(slug)` | `/api/movies/detail/<slug>` | detail + daftar server stream |
| `getEpisodes(slug,season)` | `/api/movies/episodes/<slug>?season=N` | episode 1 season |
| `getSemuaEpisode(slug)` | gabungan | semua season sekaligus |
| `ambilHalaman(fn,{mulai,jumlahHalaman})` | – | multi-halaman + dedupe slug |

Slug detail wajib `movie-<tmdbId>` atau `tv-<tmdbId>`.

## Jebakan yang sudah ditutup (semua terukur, bukan dugaan)

**1. `total_pages` upstream bohong untuk crawling.**
`popular?type=movie` melaporkan `total_pages: 58710`, tapi halaman 501 balas
HTTP 500 `TMDB /movie/popular → 400 Bad Request`. TMDB memotong di halaman 500.
Karena itu tiap respons daftar membawa dua angka terpisah:
`halamanTotalUpstream` (klaim upstream) dan `halamanBisaDiambil`
(`min(klaim, 500)`). `page > 500` ditolak lokal, tidak dikirim ke server.

**2. `discover` cuma menerima ID genre ANGKA, dan gagalnya SUNYI.**
`?genre=action&type=movie` → HTTP 200 dengan `total_results: 0`.
`?genre=28&type=movie` → 49.665 hasil. Halaman genre di situs menerjemahkan
slug → ID di sisi klien. Karena respons salahnya 200-dengan-nol (bukan error),
salah kirim akan tampak seperti "genre ini memang kosong". `resolveGenre()`
memetakan slug → ID dan **melempar error** untuk slug tak dikenal.

**3. Genre film ≠ genre serial.** Terukur untuk `type=tv`: genre 53 (Thriller),
878, 27, 14, 12, 10752, 10402 → **0 item**; genre 10759, 18, 16, 36 → 20 item.
Kalau hasilnya nol, field `catatan` menjelaskan kemungkinan penyebabnya.

**4. Parameter `type` diabaikan di beberapa endpoint.** `trending?type=tv`,
`?type=movie`, dan tanpa param mengembalikan judul pertama yang identik.
`upcoming?type=tv` mengembalikan 19 item yang semuanya `"Movie"`. Fungsi
`getTrending` dan `getUpcoming` karena itu **tidak menerima** `type` — lebih
baik tidak menyediakan tombol yang tidak berfungsi.

**5. `hero` tidak punya paginasi.** `?page=2` mengembalikan byte identik dengan
page 1 (dibandingkan lewat hash). `getHero()` tidak menerima `page`.

**6. 500 di sini sering berarti 404.** Route handler meneruskan kegagalan TMDB
sebagai 500, contoh `{"error":"TMDB /movie/99999999 → 404 Not Found"}`.
Transport mendeteksi penanda 404 di body dan **melewati retry** supaya tidak
membuang 3 request untuk slug yang memang tidak ada.

**7. Field `stream` bukan video milik situs ini.** Isinya tautan iframe pihak
ketiga (2Embed, SuperEmbed, VidSrc, VidLink) yang dirakit dari ID TMDB.
Scraper hanya menyalin tautannya — tidak membuka, mengunduh, atau memproses
videonya.

## Bukti live (2026-09-01)

- UA gating: **tidak ada**. Matriks {Chrome UA, curl default, UA kosong} →
  ketiganya HTTP 200 dengan 37.354 byte identik. Tidak ada Cloudflare, tidak
  ada challenge (`x-powered-by: next.js`, `server: Vercel`).
- `sitemap.xml` cuma memuat **6 URL** (halaman statis) — tidak berguna untuk
  menemukan judul.
- Endpoint ditemukan dengan mengunduh `/_next/static/chunks/**` lalu grep
  literal `/api/movies/`. Endpoint tersebar per-chunk halaman: `page.js`
  (hero/trending/popular/top-rated/latest/upcoming), `search/page.js` (search),
  `genre/[genre]/page.js` (discover + genres), `movie/[slug]/page.js`
  (detail + episodes).
- Ukuran katalog terukur: popular movie 1.174.183 hasil (dibatasi 500 hal),
  popular tv 230.375, discover genre 28 movie 49.665, `search?q=spider` 655
  hasil / 33 halaman, `latest?type=movie` 229 halaman (halaman terakhir 7 item),
  `upcoming` 2 halaman.
- `search?q=` (kosong) → HTTP 400 `Query wajib diisi`.
- `detail/ngawur` → HTTP 400 `Format slug tidak valid`.

## Test

```bash
npm test          # node --test test/index.test.js
```

Semua test menembak API sungguhan (tanpa mock) dan memvalidasi isi JSON —
bukan cuma status HTTP: slug berformat benar, judul tidak kosong, poster
`https://image.tmdb.org/`, tipe cocok dengan `type` yang diminta, halaman 2
bukan duplikat halaman 1, URL server episode membawa nomor season/episode yang
benar, dan input ngawur ditolak. Karena transport-nya sengaja pelan
(1,2 s/request), suite ini butuh beberapa menit.
