# DeepAI Text2Img Scraper & Client

Zero-dependency, pure Node.js (>= 18) scraper & generator untuk **DeepAI Text-to-Image** model tanpa perlu API key berbayar.

---

## Fitur Utama

- **100% Pure HTTP / Zero Dependencies**: Native Node.js `fetch` & `FormData`.
- **Dynamic Hashing Handshake**: Mengimplementasikan algoritma hashing JS asli DeepAI (`generateIslandKey` dengan salt internal) untuk menghasilkan header otentikasi browser yang valid.
- **IPv4 Fallback Ready**: Mengatasi masalah network unreachable / IPv6 routing di lingkungan Linux/PRoot/Termux.
- **CLI & Module Ready**: Siap dieksekusi langsung di CLI atau di-import ke script lain.

---

## Penggunaan CLI

```bash
# Generate gambar dari teks
node cli.js "cyberpunk samurai robot katana neon rain" samurai.jpg
```

---

## Penggunaan Programmatic (ES Module)

```javascript
import fs from "node:fs";
import { text2img, generateAndDownload } from "deepai-scraper";

// 1. Dapatkan URL gambar langsung
const res = await text2img("cat wearing space suit on moon 8k");
console.log("Image URL:", res.output_url);

// 2. Generate dan simpan buffer langsung ke disk
const output = await generateAndDownload("futuristic cyber city floating cars");
await fs.promises.writeFile("city.jpg", output.buffer);
```

---

## Hasil Uji Live Test

```
TAP version 13
ok 1 - 1. generateIslandKey: creates valid dynamic hash token
ok 2 - 2. text2img: generates live image URL from prompt
ok 3 - 3. generateAndDownload: downloads live generated image buffer
1..3
# pass 3
# fail 0
```
