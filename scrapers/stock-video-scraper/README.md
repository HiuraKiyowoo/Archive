# Stock Video Scraper

Zero-dependency Node.js scraper untuk free stock video HD dari Mixkit (no login, CDN download).

---

## 1. Arsitektur

**Source yang jalan:**
| Source | Auth | Download | Resolusi | Metode |
|--------|------|----------|----------|--------|
| Mixkit | ❌ No | ✅ CDN `assets.mixkit.co` | 720p | HTML scrape |

**Source yang JS-rendered (butuh browser):**
Videezy, SplitShire, Videvo — semua konten video di-load via JavaScript. Perlu Puppeteer/Playwright untuk scrape.

---

## 2. Cara Kerja Mixkit

1. `GET mixkit.co/free-stock-video/?q={query}` → parse HTML `div.item-grid-video-player`
2. `GET mixkit.co/free-stock-video/{slug}-{id}/` → extract MP4 links dari `assets.mixkit.co/videos/{id}/{id}-{res}.mp4`
3. Download langsung dari CDN (no auth)

---

## 3. CLI Usage

```bash
# Search
node cli.js mixkit nature
node cli.js mixkit nature 2

# Get detail + download links
node cli.js mixkit-detail https://mixkit.co/free-stock-video/going-down-a-curved-highway-through-a-mountain-range-41576/

# Search all (Mixkit only for now)
node cli.js all ocean
```

Output JSON envelope:
```json
{
  "source": "stock-video-scraper",
  "command": "mixkit \"nature\"",
  "ok": true,
  "data": {
    "source": "mixkit",
    "query": "nature",
    "page": 1,
    "count": 40,
    "videos": [
      {
        "id": "41576",
        "title": "Going down a curved highway through a mountain range",
        "thumbnail": "https://mixkit-resized.envatousercontent.com/...",
        "url": "https://mixkit.co/free-stock-video/going-down-a-curved-highway-through-a-mountain-range-41576/"
      }
    ]
  }
}
```

---

## 4. Programmatic Usage

```javascript
import { searchMixkit, getMixkitVideo } from "./src/index.js";

// Search
const results = await searchMixkit("nature");
console.log(`${results.count} videos found`);

// Get detail + download links
const detail = await getMixkitVideo(results.videos[0].url);
console.log(detail.downloads);  // { "720": "https://...", "360": "https://..." }
console.log(detail.best);       // Best quality available
```

---

## 5. Test Suite

```bash
npm test
# atau
node --test test/index.test.js
```

Hasil:
```
✔ 1. searchMixkit - returns video results for 'nature'
✔ 2. searchMixkit - pagination works
✔ 3. searchVideezy - returns video results for 'city'  [expect: fail - JS rendered]
✔ 4. searchSplitShire - returns video results          [expect: fail - JS rendered]
✔ 5. searchVidevo - returns video results              [expect: fail - JS rendered]
✔ 6. searchAll - returns results from all sources

tests 6 | pass 3 | fail 3
```

---

## 6. Batasan

1. **Mixkit** — 720p only (4K available via API key, but API key requires signup)
2. **Videezy/SplitShire/Videvo** — JS-rendered, tidak bisa di-scrape dengan curl-only
3. **Rate limiting** — Mixkit tidak documented, tapi CDN stabil
4. **License** — Mixkit Free License (commercial OK, no attribution required)

---

## 7. Transport

Semua request via `curl --curves X25519` + Chrome User-Agent (bypass Cloudflare JA3/JA4 fingerprinting).
