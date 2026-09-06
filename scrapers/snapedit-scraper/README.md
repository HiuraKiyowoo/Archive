# SnapEdit Video Enhance Scraper (#22)

Reverse engineered API client untuk fitur **SnapEdit Video Enhance** (`https://snapedit.app/id/video-enhance`). Murni berbasis HTTP stdlib Node.js (zero dependencies, anti-bloat, tanpa Playwright/Puppeteer di runtime).

---

## Arsitektur & Reverse Engineering

### 1. Client-Side HMAC-SHA256 Token
SnapEdit menggunakan backend API di `https://be-prod-web.snapedit.app`. Setiap request wajib menyertakan token JWT internal pada header `Authorization: Bearer <JWT>`.
Secret signing key di-reverse engineer dari chunk `29792-3879af8c8bd85f84.js` (modul `50031`):
```javascript
const SECRET = Buffer.from("HBmQJoIurA0HVLyUaCiFlxF+JJc14eHmZNttilecFGQ=", "base64");
// Algorithm: HS256
// Payload: { sub: "ignore", platform: "web", is_pro: bool, exp: timestamp + 600 }
```

### 2. Device Fingerprint
Dihitung dari string format `${UserAgent}::Asia/Jakarta::id` menggunakan algoritma 32-bit bitwise hash:
```javascript
for (let i = 0; i < str.length; i++) {
  hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
}
return Math.abs(hash).toString(16);
```

### 3. Pipeline Eksekusi Video Enhance
1. **Config Discovery**:
   - `GET https://be-prod-web.snapedit.app/api/enhance_video/upload-configs` -> Limit 200 MB.
2. **Signed Upload Negotiation**:
   - `POST https://be-prod-web.snapedit.app/api/enhance_video/v2/upload`
   - Respon: `{ task_id, upload_signed_url, bucket, "x-goog-content-length-range" }`
3. **Direct Cloud Storage Upload**:
   - `PUT {upload_signed_url}` langsung ke BytePlus TOS Storage (`snapedit-enhance-video-v2-asia-northeast3-prod.tos-ap-southeast-1.bytepluses.com`) tanpa membebani server web.
4. **Task Dispatch**:
   - `POST https://be-prod-web.snapedit.app/api/enhance_video/v2/tasks`
   - Form parameters: `task_id`, `zoom_factor` (`FHD` / `2K`), `is_preview` (`true` / `false`).
   - *Catatan Autentikasi*: Backend SnapEdit mewajibkan header `X-FIREBASE-TOKEN` untuk queue pengerjaan AI.
5. **Status Polling**:
   - `GET https://be-prod-web.snapedit.app/api/enhance_video/v2/tasks/{task_id}`
   - Status: `PROCESSING` -> `COMPLETED` / `COMPLETED_PREVIEW` -> Mengembalikan URL video hasil enhancement.

---

## Penggunaan CLI

```bash
# Cek konfigurasi limit upload
node cli.js config

# Generate client auth token & fingerprint
node cli.js token

# Inisialisasi task_id dan signed cloud storage URL
node cli.js init-upload

# Eksekusi enhancement video lokal
node cli.js enhance /path/to/video.mp4 --scale FHD
```

---

## Penggunaan Programatik

```javascript
import {
  initVideoUpload,
  uploadVideoBinary,
  submitEnhanceTask,
  getTaskStatus,
  enhanceVideo
} from './src/index.js';

// High level one-liner
const result = await enhanceVideo('./input.mp4', {
  zoomFactor: 'FHD',
  isPreview: true
});
console.log('Enhanced Video URL:', result.resultUrl);
```

---

## Testing

Jalankan test suite resmi:
```bash
node --test test/index.test.js
```
