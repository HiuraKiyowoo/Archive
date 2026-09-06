# RyuKomik Scraper & API Client

Scraper dan API client multi-source komprehensif untuk [ryukomik.my.id](https://ryukomik.my.id/) dan backend [api.ryukomik.web.id](https://api.ryukomik.web.id/).

- **API-First**: 90% endpoint membaca langsung dari REST API resmi tanpa parsing HTML.
- **Zero Dependencies**: Murni menggunakan `fetch` bawaan Node.js (Node.js 18+).
- **Multi-Source Aggregator**:
  - `project`: Seri komik original terjemahan tim RyuKomik (Sicario, dll).
  - `komiku`: Ribuan manga/manhwa/manhua terjemahan Indonesia.
  - `doujindesu`: Katalog komik doujin & manhwa dewasa.
  - `komikid` & `kiryuu`: Katalog komik alternatif.
  - `anime`: Mesin streaming & jadwal anime (nontonanimeid aggregator).
  - `social`: XP Leaderboard & ranking pengguna.

---

## 🚀 Quick Start (CLI)

```bash
# 1. Project RyuKomik
node cli.js project:filters
node cli.js project:pustaka 1 manhwa Action
node cli.js project:detail sicario
node cli.js project:chapter sicario chapter-1

# 2. Source Komiku
node cli.js komiku:terbaru
node cli.js komiku:search "magic emperor"
node cli.js komiku:detail magic-emperor
node cli.js komiku:chapter magic-emperor-chapter-905

# 3. Source Doujindesu
node cli.js doujin:terbaru
node cli.js doujin:manhwa
node cli.js doujin:search "sister"

# 4. Source Komikid & Kiryuu
node cli.js komikid:pustaka 1
node cli.js komikid:detail the-villain-wants-to-live
node cli.js kiryuu:pustaka 1

# 5. Anime Engine
node cli.js anime:terbaru
node cli.js anime:ongoing
node cli.js anime:jadwal
node cli.js anime:detail kaijuu-8-gou-narumi-no-heijitsu
node cli.js anime:stream kaijuu-8-gou-narumi-no-heijitsu-episode-1

# 6. Leaderboard
node cli.js leaderboard
```

---

## 💻 Penggunaan Programatik (JavaScript / Node.js)

```javascript
import {
  getProjectPustaka,
  getProjectDetail,
  getProjectChapter,
  getKomikuTerbaru,
  getKomikuDetail,
  getKomikuChapter,
  getAnimeTerbaru,
  getAnimeEpisode,
  getLeaderboard
} from './src/index.js';

// Ambil katalog project RyuKomik
const projectList = await getProjectPustaka({ page: 1, tipe: 'manhwa' });
console.log(projectList.data);

// Ambil detail komik & chapter list
const detail = await getProjectDetail('sicario');
console.log(detail.title, detail.total_chapters);

// Baca gambar chapter
const chapter = await getProjectChapter('sicario', 'chapter-1');
console.log(chapter.images); // ['https://storage.ryukomik.my.id/...']

// Komiku rilis terbaru
const latest = await getKomikuTerbaru();
console.log(latest.data);

// Leaderboard XP
const topUsers = await getLeaderboard();
console.log(topUsers);
```

---

## 🗺️ Peta Lengkap Arsitektur & Endpoint

### A. RyuKomik Project (`https://ryukomik.my.id/api/`)
| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/api/project/filters` | Opsi filter katalog (tipe, status, genre) |
| `GET` | `/api/project/pustaka?{tipe,status,genre,page}` | Katalog komik project RyuKomik |
| `GET` | `/api/project/chapter/:slug/:chapter` | Daftar gambar halaman chapter |
| `GET` | `/api/leaderboard` | Peringkat pembaca & level XP |

### B. Multi-Source Backend (`https://api.ryukomik.web.id/`)
| Source | Method | Endpoint | Keterangan |
|---|---|---|---|
| **Komiku** | `GET` | `/komiku/terbaru` | 40 rilis komik terbaru |
| | `GET` | `/komiku/pustaka-filter?{page,tipe,genre}` | Pustaka katalog berpaginasi |
| | `GET` | `/komiku/search?q=:query` | Pencarian judul komik |
| | `GET` | `/komiku/detail/:slug` | Info sinopsis, genre, list chapter |
| | `GET` | `/komiku/chapter/:slug` | Array gambar chapter |
| **Doujindesu** | `GET` | `/doujindesu/terbaru` | Doujin terbaru |
| | `GET` | `/doujindesu/manhwa/terbaru` | Manhwa dewasa terbaru |
| | `GET` | `/doujindesu/search?q=:query` | Pencarian doujin |
| | `GET` | `/doujindesu/detail/:slug` | Detail doujin |
| | `GET` | `/doujindesu/chapter/:slug` | Gambar chapter |
| **Komikid** | `GET` | `/komikid/pustaka?page=N` | Katalog komikid |
| | `GET` | `/komikid/detail/:slug` | Detail komikid |
| | `GET` | `/komikid/chapter/:slug` | Gambar chapter |
| **Kiryuu** | `GET` | `/kiryuu/pustaka-filter?page=N` | Katalog kiryuu |

### C. Anime Streaming Engine (SSR HTML)
| Method | Route | Output |
|---|---|---|
| `GET` | `/anime/terbaru` | List anime episode baru |
| `GET` | `/anime/ongoing` | List anime musim ini |
| `GET` | `/anime/jadwal` | Jadwal mingguan Senin–Minggu |
| `GET` | `/anime/detail/:slug` | Detail anime & episode list |
| `GET` | `/anime/episode/:slug` | Iframe streaming video player |

---

## 🧪 Testing

Jalankan test suite langsung menggunakan test runner native:

```bash
node --test test/index.test.js
```
