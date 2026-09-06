# iLoveIMG Scraper & Image Processing API Client

Zero-dependency, pure Node.js (>= 18) client & scraper untuk memproses gambar gratis via **iLoveIMG** (Compress, Resize, Convert JPG, Upscale, Crop) tanpa perlu API key berbayar atau browser headless.

---

## Fitur Utama

- **100% Pure HTTP / Zero Dependencies**: Menggunakan native Node.js `fetch`, `FormData`, dan `Blob`. Bebas Chromium / Puppeteer.
- **Auto-Handshake**: Otomatis mengekstrak temporary JWT token publik, server worker (`api1`..`api33`), dan dynamic task ID dari web iLoveIMG.
- **Dukungan Operasi Lengkap**:
  - `compressImage()`: Kompresi gambar (JPG, PNG, GIF, SVG, WebP).
  - `resizeImage()`: Ubah ukuran gambar berdasarkan persentase atau dimensi piksel eksak.
  - `convertToJpg()`: Konversi aneka format gambar (PNG, WebP, GIF, SVG) ke format JPG/PNG.
  - `upscaleImage()`: AI Super-resolution upscaling (2x atau 4x).
- **CLI & Module Ready**: Siap dipanggil sebagai script CLI terminal atau di-import sebagai ES Module di script Node.js lainnya.

---

## Struktur File

```
scrapers/iloveimg-scraper/
├── src/
│   └── index.js         # Core library (getSessionConfig, uploadFile, processTask, downloadResult)
├── test/
│   └── index.test.js    # Live automated tests (node --test)
├── cli.js               # Command-line interface tool
├── package.json
└── README.md
```

---

## Penggunaan CLI

```bash
# Kompres gambar
node cli.js compress input.png output.png

# Resize gambar ke lebar tertentu (misal 800px)
node cli.js resize photo.jpg 800 resized_800.jpg

# Konversi format ke JPG
node cli.js convert banner.webp banner.jpg

# Upscale resolusi gambar (2x atau 4x)
node cli.js upscale icon.png 2 upscale_2x.png
```

---

## Penggunaan Programmatic (ES Module)

```javascript
import fs from "node:fs";
import { compressImage, resizeImage, convertToJpg, upscaleImage } from "iloveimg-scraper";

// 1. Kompresi gambar dari Buffer atau Path
const res = await compressImage("./photo.jpg");
console.log(`Ukuran hemat: ${res.original_size} -> ${res.output_size} (${res.ratio})`);
await fs.promises.writeFile("./compressed.jpg", res.buffer);

// 2. Resize gambar
const resized = await resizeImage("./photo.jpg", { resize_mode: "pixels", pixels_width: 1080 });
await fs.promises.writeFile("./resized_1080.jpg", resized.buffer);

// 3. Konversi format ke JPG
const converted = await convertToJpg("./sticker.webp");
await fs.promises.writeFile("./sticker.jpg", converted.buffer);
```

---

## Hasil Uji Live Test

```
TAP version 13
ok 1 - 1. getSessionConfig: retrieves valid token and task ID
ok 2 - 2. compressImage: live compression of test image
ok 3 - 3. convertToJpg: converts PNG to JPG
ok 4 - 4. resizeImage: resizes image via percentage
1..4
# pass 4
# fail 0
```
