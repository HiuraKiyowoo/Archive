# Text2Image Generator

Modul & CLI AI Text-to-Image client multi-provider dengan auto-fallback.
Didesain khusus untuk pipeline konten video (Long-form 16:9 & Shorts/TikTok 9:16) tanpa perlu API key atau setup kartu kredit.

- **Primary Provider**: **FLUX.1 Schnell** via Black Forest Labs GPU Space (4 steps, ultra sharp, fotorealistik).
- **Secondary / Fallback Provider**: **Pollinations.ai** (instant HTTP, direct stream).
- **Zero External Dependencies**: 100% menggunakan native Node.js 18+ (`fetch`, `node:fs`, `node:stream`).
- **Auto Aspect Ratio**:
  - `16:9` (1024x576) untuk YouTube Long-form & landscape video.
  - `9:16` (576x1024) untuk YouTube Shorts, Instagram Reels, dan TikTok.
  - `1:1` (1024x1024) untuk thumbnail, avatar, cover.

---

## 🚀 Penggunaan CLI

```bash
# Generate visual 16:9 untuk dokumenter / video horizontal
node cli.js "cinematic dark bank vault with opened safe and scattered diamonds, dramatic lighting" -o ./vault.webp --ratio 16:9

# Generate visual 9:16 untuk YouTube Shorts / TikTok
node cli.js "cursed haunted doll sitting in abandoned hospital room, gloomy atmospheric" -o ./doll.webp --ratio 9:16

# Pakai fallback instan pollinations
node cli.js "futuristic neon Tokyo street at night" -o ./tokyo.jpg -p pollinations --ratio 16:9
```

---

## 💻 Penggunaan Programatik (Node.js / JS)

```javascript
import { generateImage } from './src/index.js';

// Auto generate & langsung simpan ke file disk
const result = await generateImage("Leonardo Notarbartolo plotting diamond heist in antique Italian cafe", {
  ratio: "16:9",
  outputPath: "/tmp/assets/heist_scene.webp"
});

console.log(result.provider); // 'flux-schnell' atau 'pollinations'
console.log(result.savedTo);  // '/tmp/assets/heist_scene.webp'
console.log(result.bytes);    // 83414
```

---

## 🧪 Testing

```bash
node --test test/index.test.js
```
