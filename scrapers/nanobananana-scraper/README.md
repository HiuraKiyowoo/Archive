# nanobananana-scraper

Zero-dependency Node.js client untuk **nanobananana.com** (Nano Banana = image generation model Gemini).

> **Kabar baik: extension nggak perlu.** Situs ini Next.js — "extension" yang ribet itu cuma client UI alternatif. Semua fiturnya dipanggil via **plain HTTP API same-origin** dengan **session cookie**. Scraper ini langsung menendang API-nya.

## Hasil reverse engineering (47 chunk webpack, 1.67 MB)

| | |
|---|---|
| Stack | Next.js + Cloudflare (lenient: `Python-urllib` UA → 403, browser UA → 200) |
| Transport | `fetch` same-origin, **auth = session cookie** (bukan Bearer, bukan API key di client) |
| Login | Google OAuth → server set cookie sesi di `nanobananana.com` |
| Envelope | `{ok:true, data}` / `{ok:false, error:{code, message}}` |
| Tanpa cookie | Semua `/api/*` → `401 {"ok":false,"error":{"code":"COMMON.UNAUTHORIZED"}}` (terverifikasi) |
| Publik | `GET /api/auth/google/config` → `{clientId: "580562041338-..."}` |

## Endpoint (dibungkus)

| Fungsi | Endpoint | Catatan |
|---|---|---|
| Generate gambar | `POST /api/generation/image/generate` | body `{prompt, model, aspectRatio, resolution?, n, inputAssetIds?}` |
| Status request | `GET /api/generation/image/:id` | `status: processing → completed` |
| List request | `GET /api/generation/image?page&pageSize&type` | UI poll list tiap 15 dtk |
| Hapus request | `DELETE /api/generation/image/:id` | |
| Sisa kredit | `GET /api/credits` | `data.totalRemaining` |
| Riwayat kredit | `GET /api/credits/transactions?page&pageSize` | |
| Upload reference | `POST /api/assets/upload` | FormData `file` → `{assetId, url}` |
| List assets | `GET /api/assets?page&pageSize&source` | |
| Hapus asset | `DELETE /api/assets/:id` | |

## Nilai valid (diharvest dari bundle JS)

- **model**: `google/nano-banana` (standard) · `google/nano-banana-pro` · `google/nano-banana-2` (default UI) · `alibaba/z-image`
- **aspectRatio**: `1:1, 16:9, 3:2, 2:3, 3:4, 4:3, 9:16`
- **resolution**: `1K` (1024) · `2K` (2048) · `4K` (4096)
- **n**: jumlah gambar per request
- **inputAssetIds**: id asset buat image-to-image

⚠️ **Jebakan validasi server (diverifikasi live):** `google/nano-banana-pro` dan `google/nano-banana-2` **mewajibkan** field `resolution` — tanpa itu balik `400 COMMON.BAD_REQUEST` bahkan *sebelum* cek auth. Scraper otomatis mengisinya `1K` (default UI) kalau lo nggak kasih. Model `google/nano-banana` & `alibaba/z-image` tidak wajib.
Reference/image-to-image hanya didukung `google/nano-banana-pro`, `google/nano-banana-2`, `alibaba/z-image` (list `Q` di bundle).

## Pakai

```bash
node cli.js info
node cli.js credits
node cli.js generate "a cyberpunk cat, neon, 8k" --model google/nano-banana-2 --aspect 9:16 --res 2K --n 1
node cli.js request <requestId>
node cli.js requests --page 1 --size 20
node cli.js upload reference.png
```

`generate` default **submit + poll** sampe `completed` lalu cetak `imageUrls`. Tambah `--nowait` kalau mau submit doang.

### Library

```js
import { generateAndWait, getCredits, uploadAsset } from './src/index.js';

const COOKIE = process.env.NBN_COOKIE;
const r = await generateAndWait('cute anime girl, 8k', { cookie: COOKIE, aspectRatio: '9:16' });
// r.imageUrls -> [ 'https://...' ]

const c = await getCredits(COOKIE);       // { totalRemaining }
const a = await uploadAsset(COOKIE, 'ref.png'); // { assetId, url }
```

## Cara ambil cookie (sekali saja)

1. Login `nanobananana.com` di browser (Google).
2. DevTools → Network → refresh → klik request `/api/credits` → **Request Headers** → salin seluruh nilai header `cookie:`.
   (Atau Console: `document.cookie` — tapi kalau cookie-nya httpOnly, cara Network ini yang bisa.)
3. `export NBN_COOKIE="<paste>"`

Cookie ada masa berlaku — kalau balik `AUTH_REQUIRED`, ambil ulang. Nggak perlu refresh token / extension / automation.

## Test

```bash
node --test test/index.test.js          # test publik + auth-gate + validasi (tanpa cookie)
NBN_COOKIE="..." node --test test/index.test.js   # aktifkan test live endpoint privat juga
```

## Catatan jujur
- Kredit = bayar/berlangganan di situs. Scraper memakai kredit akun lu sendiri via cookie — bukan bypass billing, bukan free unlimited.
- Endpoint mutasi lain (billing/checkout, support, admin) ada di bundle tapi **tidak** dibungkus — di luar kebutuhan generate.
- Format field response bisa berubah sewaktu-waktu normalizer-nya sudah defensif (`??` fallback) tapi tetap cek `raw`.

## Dependencies
None. Node.js ≥ 18 (`node:https` saja).
