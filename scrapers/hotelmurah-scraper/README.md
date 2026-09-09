# HotelMurah.com Scraper & API Client

> Zero-dependency Node.js scraper dan klien API nyata untuk platform pemesanan hotel, akomodasi, tiket, promo, dan layanan digital (PPOB) **HotelMurah.com**.

---

## 1. Arsitektur & Rekayasa Balik (Reverse Engineering)

Dari hasil investigasi HTTP-first dan dekonstruksi bundle frontend JavaScript, HotelMurah.com menggunakan arsitektur **hibrida (Dual-Stack)**:

1. **Frontend Hotel Booking (Next.js App Router)**:
   - Terpasang di path `/hotel`.
   - Menggunakan Next.js App Router dengan route chunks terpisah (`app/hotel/[city]/page-*.js`, `app/hotel/[city]/[slug]/page-*.js`).
   - Berkomunikasi melalui dua jalur API:
     - **BFF API (Backend-for-Frontend)** di `/hotel/api/bff/*` (misal: `search/hotels`, `hotel/detail`, `hotel/rooms`, `hotel/cheapest-prices`).
     - **Microservice Search v1** di `https://hotelmurah.com/search/v1/api/*` (misal: `cities/top-accommodations`, `accommodations/search/suggestions`).
2. **Backend Legasi & Layanan Digital (CodeIgniter / PHP)**:
   - Mengelola beranda utama (`/`), autocomplete klasik (`/home/search_hotel_location`), promo (`/promo/listpromo`), serta modul pulsa/PPOB (`/pulsa/`).
   - Menggunakan session cookie `ci_session` dan CSRF token protection (`hm_csrf_hash_name`) via endpoint `getCsrf`.

---

## 2. Analisis WAF (Cloudflare) & Solusi Transport

- **WAF**: Dilindungi oleh Cloudflare.
- **Perilaku TLS Fingerprinting (JA3/JA4)**:
  - Request menggunakan native `fetch` (undici) atau `node:https` dari Node.js langsung diblokir dengan HTTP 403 (*"Just a moment..." challenge*), sekalipun header User-Agent Chrome browser telah disematkan.
  - Request via binary `curl` sistem dengan User-Agent browser Chrome modern dan curve `X25519` tembus lancar dengan status HTTP 200 tanpa hambatan Turnstile.
- **Solusi Transport**:
  - Mengimplementasikan helper transport `child_process.spawn('curl', ...)` zero-dependency di `src/transport.js`.
  - Dilengkapi antrean *polite spacing* (delay 250ms) antar request untuk mencegah rate limiting Cloudflare.
  - Menyediakan manajemen *ephemeral cookie jar* untuk transaksi yang membutuhkan state session CodeIgniter (seperti modul pulsa).

---

## 3. Daftar Endpoint Nyata & Terverifikasi

| # | Fitur / Layanan | Metode | Endpoint | Tipe Return |
|---|---|---|---|---|
| 1 | **Top Cities / Destinasi Populer** | `GET` | `https://hotelmurah.com/search/v1/api/cities/top-accommodations` | JSON |
| 2 | **Autocomplete / Saran Akomodasi** | `GET` | `https://hotelmurah.com/search/v1/api/accommodations/search/suggestions?q={query}` | JSON |
| 3 | **Pencarian Lokasi Legasi (PHP)** | `POST` | `https://www.hotelmurah.com/home/search_hotel_location` | JSON Array |
| 4 | **Pencarian & Daftar Hotel (BFF)** | `POST` | `https://www.hotelmurah.com/hotel/api/bff/search/hotels` | JSON |
| 5 | **Detail Metadata Hotel & Kebijakan** | `POST` | `https://www.hotelmurah.com/hotel/api/bff/hotel/detail` | JSON |
| 6 | **Kamar, Paket & Harga (Rooms)** | `POST` | `https://www.hotelmurah.com/hotel/api/bff/hotel/rooms` | JSON |
| 7 | **Cek Harga Termurah (Batch)** | `POST` | `https://www.hotelmurah.com/hotel/api/bff/hotel/cheapest-prices` | JSON |
| 8 | **CSRF Token Pulsa & PPOB** | `GET` | `https://www.hotelmurah.com/pulsa/ewallet/getCsrf` | JSON |
| 9 | **Katalog Operator & Denom Pulsa** | `POST` | `https://www.hotelmurah.com/pulsa/index.php/home/ambil_logo` | JSON |
| 10 | **Daftar Promo Aktif** | `GET` | `https://www.hotelmurah.com/promo/listpromo` | HTML (Scraped) |
| 11 | **Katalog E-Wallet Top-up (DANA/GoPay/OVO/ShopeePay/LinkAja)** | `POST` | `https://www.hotelmurah.com/pulsa/index.php/ewallet/getProductEwallet` | JSON |
| 12 | **Validasi Nomor Tujuan (check akun)** | `POST` | `https://www.hotelmurah.com/pulsa/index.php/ewallet/isOrderValidated` | JSON (token) |
| 13 | **Detail Order / Payment Channel + Fee** | `POST` | `https://www.hotelmurah.com/pulsa/Ewallet/detailOrder` | JSON (channel + biaya) |
| 14 | **Submit Order (QRIS / VA / Checkout Link)** | `POST` | `https://www.hotelmurah.com/pulsa/ewallet/submitorder` | JSON (order + payload bayar) |
| 15 | **Lacak Status Order** | `GET` | `https://www.hotelmurah.com/pulsa/pln/pln_trx/{orderId}/{idUser}` | HTML (status) |

### Flow E-Wallet Top-up (3 Tahap)

```
1. getCatalog(wallet)        -> daftar nominal + harga + admin fee
2. getPaymentOptions(wallet, phone, productId)
   -> validasi nomor di isOrderValidated (token one-time)
   -> detailOrder: channel QRIS/GoPay/OVO/VA BCA/Mandiri/BRI/BNI + fee per channel
3. submitOrder({ wallet, phone, productId, channel })
   -> order NYATA status PENDING + payload bayar:
      • QRIS        : QR code PNG (data-url) + expiry
      • VA Bank     : nomor VA virtual account
      • Checkout    : URL link payment (Midtrans)
```

Wallet yang tersedia: `dana`, `gopay`, `ovo`, `shopeepay`, `linkaja` (juga game top-up: COD, Free Fire, Genshin, PUBG).

---

## 4. Contoh Request & Response Nyata

### A. Autocomplete Destinasi (`suggestAccommodations`)
**Request:**
```http
GET https://hotelmurah.com/search/v1/api/accommodations/search/suggestions?q=bandung HTTP/2
User-Agent: Mozilla/5.0 ...
```
**Response Cuplikan:**
```json
{
  "data": [
    {
      "id": "city_182",
      "name": "Bandung",
      "slug": "bandung",
      "type": "city",
      "image_url": null,
      "accommodation_count": 1259,
      "location": {
        "country_id": "ID",
        "country": "Indonesia",
        "city_id": 182,
        "city": "Bandung",
        "region_id": 13,
        "region": "Jawa Barat"
      }
    }
  ],
  "result_count": 20
}
```

### B. Pencarian Hotel (`searchHotels`)
**Request:**
```http
POST https://www.hotelmurah.com/hotel/api/bff/search/hotels HTTP/2
Content-Type: application/json

{
  "city": "jakarta",
  "check_in": "2026-09-10",
  "check_out": "2026-09-11",
  "adults": 2,
  "children": 0,
  "rooms": 1,
  "page": 1,
  "limit": 5,
  "sort": "popular"
}
```
**Response Cuplikan:**
```json
{
  "success": true,
  "message": "Hotel fetched successfully.",
  "code": 200,
  "data": {
    "hotels": [
      {
        "idHotel": "1892",
        "slug": "swiss-belresidence-and-hotel-kalibata-203-828",
        "name": "Swiss-Belresidences Kalibata Jakarta",
        "star": 4,
        "rating": 8.4,
        "review": 13,
        "address": "Jalan Kalibata Raya No. 22",
        "city": "Jakarta Selatan",
        "originalPrice": 648760,
        "discountPrice": null,
        "location": { "lat": -6.255338, "lng": 106.85576 },
        "facilities": [...]
      }
    ],
    "pagination": {
      "page": 1,
      "totalPages": 186,
      "totalItems": 2790
    }
  }
}
```

### C. Daftar Kamar & Paket (`getHotelRooms`)
**Request:**
```http
POST https://www.hotelmurah.com/hotel/api/bff/hotel/rooms HTTP/2
Content-Type: application/json

{
  "hotel_id": "swiss-belresidence-and-hotel-kalibata-203-828",
  "check_in": "2026-09-10",
  "check_out": "2026-09-11",
  "adults": 2,
  "childs": 0,
  "rooms": 1,
  "strategy": "full"
}
```
**Response Cuplikan:**
```json
{
  "success": true,
  "data": {
    "strategy": "full",
    "lowestPrice": 648760,
    "highestPrice": 1995041,
    "isAvailable": true,
    "rooms": [
      {
        "idRoom": "ID001",
        "name": "Deluxe Twin Room",
        "roomPackage": [
          {
            "roomCode": "87494571",
            "name": "Tanpa Sarapan",
            "originalPrice": 648760,
            "facilitiesInfo": {
              "bed": "2 twin beds",
              "breakfast": "Tanpa Sarapan",
              "refund": "Gratis batalkan hingga tanggal 9 September 2026."
            }
          }
        ]
      }
    ]
  }
}
```

### D. Katalog Pulsa & Operator (`getPulsaProducts`)
**Request:**
```http
POST https://www.hotelmurah.com/pulsa/index.php/home/ambil_logo HTTP/2
Content-Type: application/x-www-form-urlencoded

no_depan=812&hm_csrf_hash_name=...
```
**Response Cuplikan:**
```json
{
  "operator": "Telkomsel",
  "logoUrl": "https://img.hotelmurah.com/m-assets/img/operator/tselnew.png",
  "products": [
    {
      "id": "1",
      "productId": "17",
      "name": "Telkomsel 5.000",
      "price": 5680,
      "originalPrice": 6500,
      "isPromo": true,
      "isAvailable": true
    }
  ]
}
```

---

## 5. Penggunaan CLI (Command-Line Interface)

CLI mengembalikan output berformat JSON envelope:
```json
{
  "source": "hotelmurah.com",
  "command": "<perintah>",
  "url": "<endpoint url>",
  "ok": true,
  "data": [...]
}
```

### Perintah Tersedia:

```bash
# 1. Menampilkan kota/destinasi populer
node cli.js top-cities

# 2. Autocomplete pencarian
node cli.js suggest "bali"
node cli.js suggest "bandung"

# 3. Autocomplete legasi
node cli.js search-location "surabaya"

# 4. Pencarian hotel
node cli.js search-hotels jakarta
node cli.js search-hotels bandung 2026-09-20 2026-09-21 2 1

# 5. Detail lengkap hotel
node cli.js hotel-detail swiss-belresidence-and-hotel-kalibata-203-828

# 6. Daftar tipe kamar & paket harga live
node cli.js hotel-rooms swiss-belresidence-and-hotel-kalibata-203-828

# 7. Cek harga termurah beberapa hotel sekaligus
node cli.js cheapest-prices swiss-belresidence-and-hotel-kalibata-203-828,favehotel-pluit-junction-203-503

# 8. Cek operator & harga pulsa berdasarkan prefix nomor HP
node cli.js pulsa 0812
node cli.js pulsa 0878

# 9. Menampilkan promo aktif
node cli.js promos

# 10. E-Wallet top-up (DANA/GoPay/OVO/ShopeePay/LinkAja)
node cli.js ewallet-catalog dana                                  # Step 1: daftar nominal
node cli.js ewallet-quote dana 081234567890 50000                 # Step 1+2: channel + fee (tanpa order)
node cli.js ewallet-order dana 081234567890 50000 "QRIS"          # Step 1+2+3: order NYATA (PENDING, belum dibayar)
node cli.js order-status 101300606 0812345678901788885494         # Lacak status order (butuh login member)
```

---

## 6. Penggunaan Programmatic (Node.js ES Module)

```javascript
import {
  getTopCities,
  suggestAccommodations,
  searchHotels,
  getHotelDetail,
  getHotelRooms,
  getPulsaProducts,
  getPromos,
  EwalletSession,
  findProductByNominal,
  quoteEwalletTopUp
} from "./src/index.js";

// Cari hotel di Jakarta
const { hotels, pagination } = await searchHotels({
  city: "jakarta",
  checkIn: "2026-09-15",
  checkOut: "2026-09-16",
  adults: 2
});
console.log(`Ditemukan ${pagination.totalItems} hotel. Menampilkan ${hotels.length} hotel pertama.`);

// Ambil paket kamar hotel
const rooms = await getHotelRooms({
  hotelId: "swiss-belresidence-and-hotel-kalibata-203-828"
});
console.log(`Harga termurah: Rp ${rooms.lowestPrice}`);

// E-Wallet: quote saja (tanpa bikin order) — langkah 1+2
const quote = await quoteEwalletTopUp("dana", "081234567890", 50000);
console.log(`Subtotal DANA 50rb: Rp ${quote.subtotal}, ${quote.channels.length} channel tersedia`);

// E-Wallet: full flow bikin order (MEMBUAT order nyata, status PENDING, belum dibayar)
const session = new EwalletSession();
const catalog = await session.getCatalog("dana");
const product = findProductByNominal(catalog, 50000);
const options = await session.getPaymentOptions("dana", "081234567890", product.id);
const order = await session.submitOrder({
  wallet: "dana",
  phone: "081234567890",
  productId: product.id,
  channel: "QRIS"
});
console.log(`Order ${order.orderId} dibuat. Expiry: ${order.expiryTime}`);
console.log(order.payment.kind === "qr" ? "QR code tersedia (data-url)" : `Bayar via: ${order.payment.kind}`);
// const status = await session.checkOrder(order.orderId, order.idUser); // butuh login member
session.close();
```

---

## 7. Pengujian Live (Test Suite)

Scraper diuji langsung terhadap server production HotelMurah.com menggunakan native runner `node --test`:

```bash
npm test
# atau
node --test test/index.test.js
```

### Hasil Test Suite Live:
```text
✔ 1. getTopCities - retrieves popular destination cities
✔ 2. suggestAccommodations - autocomplete suggestions for 'bandung'
✔ 3. searchLocationLegacy - PHP autocomplete endpoint for 'bali'
✔ 4. searchHotels - hotel search listing in Jakarta
✔ 5. getHotelDetail - full hotel metadata and policies
✔ 6. getHotelRooms - room packages with live pricing and bed types
✔ 7. getCheapestPrices - batch price inquiry for multiple hotels
✔ 8. getPulsaProducts - retrieve telco operator and denom catalog (0812 / Telkomsel)
✔ 9. getPromos - parse active promotional banners and validity
✔ 10. ewallet getCatalog - DANA top-up denominations with prices
✔ 11. ewallet getPaymentOptions - channels & fee simulation (no order created)
− 12. ewallet submitOrder + checkOrderStatus - SKIP (membuat order NYATA)

tests 12 | pass 11 | fail 0 | skipped 1
```

Test #12 sengaja di-skip secara default karena **membuat order PPOB nyata** di server production. Jalankan secara eksplisit:
```bash
HM_REAL_ORDER=1 node --test --test-name-pattern="12." test/index.test.js
```
Hasil terakhir (live): order QRIS `101312297` ter-create dengan QR code PNG + expiry, status query terjawab `REQUIRES_LOGIN` (lihat batasan #4).

---

## 8. Catatan Keamanan & Batasan

1. **Zero Browser Runtime**: Tidak membutuhkan Chromium/Puppeteer/Playwright di environment runtime.
2. **Zero NPM Dependencies**: 100% menggunakan library standar Node.js (`node:child_process`, `node:fs`, `node:os`, `node:path`) + binary `curl` sistem.
3. **WAF Compliance**: Menggunakan TLS client curl dengan HTTP/2 & modern curve `X25519` agar tidak tersaring filter JA3/JA4 Cloudflare.
4. **Batasan E-Wallet (jujur, terverifikasi live)**:
   - **Yang BISA di-scrape**: katalog nominal semua e-wallet, validasi nomor tujuan, simulasi channel + fee admin (QRIS/GoPay/OVO/VA bank), dan **pembuatan order PENDING** dengan payload bayar (QRIS QR-code / nomor VA / link checkout). Order akan auto-expire jika tidak dibayar.
   - **Yang TIDAK BISA di-scrape**: (a) pembayaran final — pembayaran QRIS/VA harus diproses dari sisi bank/e-wallet user; (b) **tracking status order** — halaman `/pulsa/pln/pln_trx/{id}/{user}` di belakang login member, order guest di-redirect ke `/member/last_order` (ditegaskan lewat flag `requiresLogin: true` di hasil `checkOrder`); (c) auto-debet saldo DANA langsung — butuh PIN+OTP manusia.
   - **Format nomor**: `cust_number` dikirim dengan `0` di depan (format lokal) — tanpa `0`, validasi DANA menolak (server status 888).
5. **Etika Non-Destruktif**: test suite default tidak pernah membuat order; rate limiting 250ms antar request; token one-time (`isOrderValidated`) tidak di-reuse.
