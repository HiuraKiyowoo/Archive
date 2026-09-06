# Text2Video & Image2Video Generator

Modul & CLI untuk memproduksi klip video sinematik berkualitas studio (1080p 60fps) berbasis AI visual & kinetic camera motion. Didesain khusus untuk automasi video YouTube Long-Form (16:9) dan Shorts / TikTok (9:16) secara deterministik tanpa jitter.

- **Text-to-Video (`t2v`)**: Mengonversi prompt teks narasi -> AI visual beresolusi tinggi (FLUX.1 Schnell / Pollinations) -> klip video bergerak dengan durasi presisi mengunci jeda audio.
- **Image-to-Video (`i2v`)**: Mengonversi foto still apa pun menjadi rekaman kamera sinematik bergerak dinamis.
- **Anti-Jitter Pre-Scale Engine**: Menggunakan teknik scaling 2.8K sebelum interpolasi gerakan untuk menghilangkan getaran pixel (pixel shaking) pada zoom & pan.
- **Dukungan Rasio Multi-Platform**:
  - `16:9` (1920x1080): YouTube dokumenter, video landscape.
  - `9:16` (1080x1920): YouTube Shorts, TikTok, Instagram Reels.
  - `1:1` (1080x1080): Postingan media sosial feed.

---

## 🚀 Penggunaan CLI

```bash
# 1. Text-to-Video (T2V) untuk YouTube Landscape (16:9)
node cli.js t2v "cinematic dark bank vault with scattered diamonds" -o ./vault.mp4 --ratio 16:9 --duration 3.5 --motion zoom-in

# 2. Text-to-Video (T2V) untuk YouTube Shorts / TikTok (9:16)
node cli.js t2v "cursed ghost reflection in antique mirror" -o ./mirror.mp4 --ratio 9:16 --duration 3.0 --motion pan-right

# 3. Image-to-Video (I2V) dari gambar still yang sudah ada
node cli.js i2v ./scene_01.jpg -o ./scene_01.mp4 --ratio 16:9 --duration 4.2 --motion drone-drift
```

### Motion Presets
- `zoom-in`: Kamera maju perlahan (fokus subjek / tensi dramatis).
- `zoom-out`: Kamera mundur perlahan (reveal lanskap / skala TKP).
- `pan-left`: Gerakan kamera horizontal dari kanan ke kiri.
- `pan-right`: Gerakan kamera horizontal dari kiri ke kanan.
- `tilt-up`: Gerakan kamera vertikal ke atas.
- `tilt-down`: Gerakan kamera vertikal ke bawah.
- `drone-drift`: Gerakan diagonal melayang sinematik.

---

## 💻 Penggunaan Programatik (Node.js)

```javascript
import { textToVideo, imageToVideo } from './src/index.js';

// 1. Text-to-Video: Prompt -> Video MP4
const res = await textToVideo("detective walking in rainy alley neon light", "/tmp/clip.mp4", {
  duration: 3.8,
  ratio: "16:9",
  motion: "zoom-in"
});
console.log(res.resolution, res.bytes); // 1920x1080, 1542000

// 2. Image-to-Video: Image -> Video MP4
const clip = await imageToVideo("/path/to/image.jpg", "/tmp/clip_motion.mp4", {
  duration: 3.0,
  ratio: "9:16",
  motion: "pan-right"
});
console.log(clip.duration); // 3.0
```

---

## 🧪 Testing

```bash
node --test test/index.test.js
```
