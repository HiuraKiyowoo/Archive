# iLoveIMG Scraper & Image Processing API Client

Zero-dependency, pure Node.js (>= 18) client & scraper untuk memproses gambar gratis via **iLoveIMG** (Compress, Resize, Convert JPG, Upscale, Crop, Remove BG) tanpa perlu API key berbayar atau browser headless.

---

## Fitur Utama

- **100% Pure HTTP / Zero Dependencies**: Menggunakan native Node.js `fetch`, `FormData`, dan `Blob`. Bebas Chromium / Puppeteer.
- **Auto-Handshake**: Otomatis mengekstrak temporary JWT token publik, server worker (`api1g`..`api34g`), dan dynamic task ID dari web iLoveIMG.
- **Dukungan Operasi Lengkap**:
  - `compressImage()`: Kompresi gambar (JPG, PNG, GIF, SVG, WebP).
  - `resizeImage()`: Ubah ukuran gambar berdasarkan persentase atau dimensi piksel eksak.
  - `convertToJpg()`: Konversi format gambar (PNG, WebP, GIF, SVG) ke format JPG/PNG.
  - `cropImage()`: Potong area gambar berdasarkan koordinat x, y, width, height.
  - `upscaleImage()`: AI Super-resolution upscaling (2x atau 4x).
  - `removeBackground()`: AI Background Removal (potong latar belakang otomatis).
- **CLI & Module Ready**: Siap dipanggil sebagai script CLI terminal atau di-import sebagai ES Module di script Node.js lainnya.

---

## Struktur File

```
scrapers/iloveimg-scraper/
├── src/
│   └── index.js         # Core library (compress, resize, convert, crop, upscale, remove-bg)
├── test/
│   └── index.test.js    # Live automated tests (7/7 tests passed)
├── cli.js               # Command-line interface tool
├── package.json
└── README.md
```

---

## Penggunaan CLI

```bash
# 1. Kompres gambar
node cli.js compress input.png output.png

# 2. Resize gambar ke lebar tertentu (misal 800px)
node cli.js resize photo.jpg 800 resized_800.jpg

# 3. Konversi format ke JPG
node cli.js convert banner.webp banner.jpg

# 4. Potong (crop) gambar (x, y, w, h)
node cli.js crop banner.jpg 10 10 300 300 cropped.jpg

# 5. Upscale resolusi gambar (2x atau 4x HD)
node cli.js upscale icon.png 2 upscale_2x.png

# 6. Hapus background gambar (AI Cutout)
node cli.js remove-bg product.jpg product_nobg.png
```

---

## Penggunaan Programmatic (ES Module)

```javascript
import fs from "node:fs";
import { 
  compressImage, 
  resizeImage, 
  convertToJpg, 
  cropImage, 
  upscaleImage, 
  removeBackground 
} from "iloveimg-scraper";

// 1. Kompresi gambar
const res = await compressImage("./photo.jpg");
await fs.promises.writeFile("./compressed.jpg", res.buffer);

// 2. AI Upscale 2x HD
const hd = await upscaleImage("./avatar.png", 2);
await fs.promises.writeFile("./avatar_hd.png", hd.buffer);

// 3. AI Hapus background
const cutout = await removeBackground("./portrait.jpg");
await fs.promises.writeFile("./cutout.png", cutout.buffer);
```

---

## Hasil Uji Live Test

```
TAP version 13
ok 1 - 1. getSessionConfig: retrieves valid token and task ID
ok 2 - 2. compressImage: live compression of test image
ok 3 - 3. convertToJpg: converts PNG to JPG
ok 4 - 4. resizeImage: resizes image via percentage
ok 5 - 5. cropImage: crops image to target coordinates
ok 6 - 6. upscaleImage: live 2x super resolution upscale
ok 7 - 7. removeBackground: AI background removal
1..7
# pass 7
# fail 0
```
