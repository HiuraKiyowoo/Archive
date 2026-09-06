# pollinations-scraper

Zero-dependency Node.js scraper & client untuk Pollinations.ai AI Image (Flux, Turbo) & Text Generator.

## Fitur
- **Pure Node.js**: Zero external npm dependencies.
- **Image Generation**: Flux, Turbo, Flux-Anime, Flux-Realism, Flux-3D.
- **Text Generation**: OpenAI GPT-4o-mini, Mistral, Llama 3 via Pollinations.
- **Tanpa API Key / Auth**: 100% gratis, unlimited, public tier.

## Penggunaan CLI
```bash
# Generate Image Flux
node cli.js image "cyberpunk city neon lights" --model flux --width 1024 --height 1024 --out city.jpg

# Generate Text LLM
node cli.js text "Jelaskan apa itu quantum computing secara singkat" --model openai
```

## Penggunaan Modul
```js
import { generateImage, generateText } from "pollinations-scraper";

// Ambil Buffer JPEG
const buffer = await generateImage("cute anime cat", { model: "flux-anime" });

// Teks
const answer = await generateText("Hello world!");
```
