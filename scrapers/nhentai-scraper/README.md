# nhentai-scraper

Zero-dependency scraper untuk **nhentai.net** (HTTP-first). Pola sama dengan
`anime-indo-scraper`: Node + native module doang, transport HTTP via `curl`.

## Kenapa pakai curl sebagai transport

Cloudflare nhentai **memblok TLS fingerprint Node native `fetch`** (undici/OpenSSL)
— semua request dari Node fetch selalu dapat `403 Just a moment...`, apapun
headernya. `curl` (OpenSSL host) lolos dan mengembalikan halaman penuh
(HTTP 200, ~76KB). Jadi scraper ini mem-`spawn` `curl` per request.

Kebiasaan rate-limit Cloudflare juga aktif (kadang balik 403 / "Just a moment"
saat request beruntun), jadi semua GET lewat queue serial dengan minimal
spacing 1.5 detik + retry/backoff (7s → 14s → 28s).

## Cara kerja

Halaman galeri `/g/{id}/` men-embed **inline `<script>` JSON** berisi entity
galeri lengkap (`id`, `media_id`, `title{english,japanese,pretty}`, `tags[]`,
`num_pages`, `pages[{number,path,width,height,thumbnail}]`, `num_favorites`,
`scanlator`, `related`). Halaman punya **lebih dari satu** block JSON
(block pertama = state app `{"zones":...}`) — parser mencari block yang
`body`-nya punya `media_id`.

Gambar:
- Halaman full: `https://i.nhentai.net/galleries/{media_id}/{n}.webp`
- Thumbnail: `https://t{n}.nhentai.net/galleries/{media_id}/{n}t.webp`
- Cover: kadang bawa bug double-extension `cover.webp.webp` (sudah dinormalisasi `pageUrl`)

## API

```js
const { getGallery, search, pageUrl } = require('./src');

// Gallery entity penuh
const g = await getGallery(676674);
// g.media_id, g.title, g.tags, g.pages, g.num_favorites, ...

// URL gambar halaman
pageUrl(g.media_id, g.pages[0].path); // https://i.nhentai.net/galleries/.../1.webp

// Pencarian
const r = await search('original big breasts', 1); // { total, results: [{id, thumb, title}] }
```

## Test

```bash
node --test test/index.test.js
```

Semua test berjalan **live** ke nhentai (memvalidasi isi JSON, bukan hanya
HTTP 200). Karena spacing + backoff, suite ~20-60 detik.

## Catatan

- Zero dependency (`fetch` native Node tidak dipakai; hanya `child_process` + stdlib)
- Node >= 18, `curl` terpasang
- Rate limit: jangan fire request masif; pakai spacing bawaan
