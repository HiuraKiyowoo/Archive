# deepfakemaker-scraper

Zero-dependency Node.js client for [deepfakemaker.io](https://deepfakemaker.io) AI tools.

Reversed from the official Nuxt 3 frontend bundle. No login, no browser, no headless Chrome required.

## Install

No install needed. Node.js >= 18 stdlib only (`node:crypto`, `node:https`, `node:http`).

```bash
git clone https://github.com/HiuraKiyowoo/Archive.git
cd Archive/scrapers/deepfakemaker-scraper
node --test test/index.test.js
```

## Supported Tools

| Tool | Method | Notes |
|------|--------|-------|
| Photo Face Swap | `photoFaceSwap(swapBuf, targetBuf)` | Free, result via `face_swap_url` |
| HD Photo Face Swap | `hdFaceSwap(swapBuf, targetBuf)` | Paid/higher quality route |
| Video Face Swap | `videoFaceSwap(faceBuf, targetVideoUrl)` | MP4/GIF support |
| Text-to-Image (KIE) | `kieImageGen(prompt)` | Free route |
| Flux Image Gen | `fluxTask(itemJson)` | Free route |
| Background Replace | `backgroundReplace(imageBuf, bgBuf)` | Free route |
| Clothes Remover | `clothesRemover(imageBuf)` | Free route |
| Clothes Changer | `clothesChanger(imageBuf, prompt)` | Free route |
| Upscaler | `upscale(imageBuf)` | Free route |
| Video Generate | `videoGenerate(itemJson)` | Free route |

## Quick Start

```js
import { DeepFakeMaker } from './src/index.js';

const dfm = new DeepFakeMaker({ debug: true });

// Photo Face Swap
const face = fs.readFileSync('face.jpg');
const body = fs.readFileSync('body.jpg');
const result = await dfm.photoFaceSwap(face, body);
console.log('Result URL:', result.resultUrl);

// Text to Image
const img = await dfm.kieImageGen('a cute cyberpunk cat, 8k, neon', { aspectRatio: '9:16' });
console.log('Image URL:', img.resultUrl);

// Upload file to CDN
const upload = await dfm.uploadFile(fs.readFileSync('photo.jpg'), 'image/jpeg', 'photo.jpg');
console.log('CDN:', upload.cdnUrl);
```

## CLI

```bash
node cli.js faceswap face1.jpg face2.jpg --out result.png
node cli.js text2img "a cute anime girl" --aspect 9:16 --format png
node cli.js upload photo.jpg
node cli.js info
```

## Architecture

```
src/index.js
  ├── Auth: RSA public key + AES-128-CBC per-request signature
  ├── Upload: Aliyun OSS signed PUT -> cdn.deepfakemaker.io
  ├── Submit: multipart/form-data or JSON body
  └── Poll: GET task status until generate_url appears

No external dependencies. No login required. Free endpoints use `/free/` routes.
```

## License

MIT
