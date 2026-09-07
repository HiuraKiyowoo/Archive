# zoneid-scraper

Zero-dependency Node.js client untuk **my.zone.id** (Zone.ID Member Area).
Direverse-engineer dari bundle SPA Vue 3 + Vite (`/assets/index-ZY4FlPCJ.js`).

## Arsitektur target (hasil reverse engineering)

| | |
|---|---|
| Frontend | Vue 3 + Vite SPA (semua route balik shell HTML 1034 byte + `<div id="app">`) |
| WAF | Cloudflare **lenient** — UA `Python-urllib` → 403, browser UA / curl / none → 200 |
| API base | `https://my.zone.id/api` |
| Transport asli | axios `withCredentials:true`, header `Authorization: Bearer <accessToken>` |
| Auth flow | `GET /authurl` → onboarding `autz.org` → redirect balik `?auth_code=...` → `POST /authorize` → simpan `{user, token}` ke pinia store `auth` (localStorage) |
| Refresh | `POST /refresh-token` (butuh session cookie, hanya valid dari browser) |

## Endpoint

### Publik (tanpa token) — TERUJI LIVE
| Endpoint | Hasil (2026-09-07) |
|---|---|
| `GET /featured?limit=N` | Katalog subdomain featured, **142 item** total. `limit` di-hormati (≥142 = semua dalam 1 request). **Order RANDOM per request** — scraper sort `created_at` desc lokal biar deterministik |
| `GET /official` | 4 layanan resmi (upld, wa, qris, terusmail) |

Bukti order random: 3 call `limit=5` berurutan mengembalikan 15 nama berbeda.
Bukti limit: `limit=100`→100, `limit=150`→142 (cap = total katalog).
Bukti filter upstream **tidak ada**: `?search=` `?mode=` `?page=` `?type=` semua diabaikan (selalu 100 item) — jadi `searchFeatured()` = filter lokal di sisi client.

### Token-gated (member, 401 `{"message":"Invalid token"}` tanpa token)
| Endpoint | Fungsi |
|---|---|
| `GET /subdomains` | List subdomain milik akun (maks 10 sesuai UI "My Domains (N of 10)") |
| `GET /subdomains/:id` | Detail (field: `subdomain, status, mode, plan, expired_at, created_at, ...`) |
| `GET /subdomains/:id/dns` | DNS records `{records: [{id, hostname, type, content}]}` |
| `GET /subdomains/:id/urlforwarder` | Forwarders `{urlforwarders: [{id, path, destination}]}` |
| `POST /subdomains` | Buat subdomain baru `{subdomain}` (min 4 char, dislug-kan) |
| `PATCH /subdomains/:id` | Ganti mode `{mode}` atau close-request `{usage_type, usage_description, will}` |
| `DELETE /subdomains/:id` | Hapus (tidak bisa di-undo) |
| `POST /subdomains/:id/transfer` | Transfer kepemilikan `{email}` |

> Endpoint mutasi (POST/PATCH/DELETE/transfer) sengaja **tidak** dibungkus — ini akun lu, bukan target scraping. Kebutuhan read-only dicukupi 6 GET di atas.

## Cara pakai

```bash
node cli.js featured            # katalog publik (JSON)
node cli.js search blog         # filter lokal
node cli.js official            # layanan resmi
node cli.js authurl             # URL login OAuth
node cli.js mine                # butuh ZONEID_TOKEN
node cli.js detail <id>         # butuh ZONEID_TOKEN
node cli.js dns <id>            # butuh ZONEID_TOKEN
node cli.js forwarders <id>     # butuh ZONEID_TOKEN
```

### Cara ambil access token (sekali saja, utk endpoint member)
1. `node cli.js authurl` → buka URL-nya di browser, login.
2. Setelah masuk di `my.zone.id`, buka DevTools Console:
   ```js
   JSON.parse(localStorage.getItem('auth')).state.accessToken
   ```
   (pinia persist store `auth` → state `{user, token}`; field token di state bernama `token`/`accessToken` — cek isi store, keduanya mungkin ada.)
3. `export ZONEID_TOKEN=<paste>` → `node cli.js mine`

Token bisa habis umur pakainya — refresh otomatis cuma jalan di dalam browser (axios interceptor + cookie). Kalau 401, ambil ulang token.

### Library

```js
import { getFeatured, getOfficial, searchFeatured, getMySubdomains } from './src/index.js';

const f = await getFeatured();            // {total: 142, data: [{id, nama, mode, plan, status, ...}], catatan}
const o = await getOfficial();            // {total: 4, data: [{title, url, description}]}
const s = await searchFeatured('blog');   // {total, matches, data}
const mine = await getMySubdomains(TOKEN);// {total, data}
```

## Test

```bash
node --test test/index.test.js
```

Test suite bikin request LIVE ke `my.zone.id/api` dan assert isi JSON (bukan cuma status 200):
total featured, field per-item, format subdomain `*.zone.id`, total official, error 401 utk endpoint member, dan idempotency sort.

## Catatan jujur
- Katalog featured itu **data publik** (user-nya sengaja publish untuk fitur "featured"; field `user` di-null oleh server).
- Data member (list/DNS/forwarder milik akun) **bukan** data publik — aksesnya via token milik lu sendiri, scraper hanya memfasilitasi.
- `records_count` / `forwarders_count` di featured = metadata hitungan record, bukan isi record-nya (isi hanya via endpoint member).
- Total katalog bisa naik/turun; angka 142 adalah snapshot 2026-09-07.

## Dependencies
None. Node.js ≥ 18 (`node:https` saja).
