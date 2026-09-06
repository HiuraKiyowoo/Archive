#!/usr/bin/env node

import { textToVideo, imageToVideo } from './src/index.js';

function printHelp() {
  console.log(`
Text2Video & Image2Video CLI
Synthesize cinematic video clips with dynamic camera motion & FLUX AI

Usage:
  node cli.js t2v "<prompt>" -o <output.mp4> [options]
  node cli.js i2v <input-image> -o <output.mp4> [options]

Commands:
  t2v    Text-to-Video: Generate AI visual -> synthesize kinetic MP4
  i2v    Image-to-Video: Transform image into kinetic MP4

Options:
  -o, --output <path>       Output file .mp4 (wajib)
  -d, --duration <seconds>  Durasi video dalam detik (default: 3.5)
  -r, --ratio <ratio>       Aspect ratio: 16:9 (default), 9:16 (Shorts/TikTok), 1:1
  -m, --motion <preset>     Motion: zoom-in (default), zoom-out, pan-left, pan-right, tilt-up, tilt-down, drone-drift
  --fps <number>            Frames per second (default: 30)
  --keep-image              Simpan frame gambar sumber (khusus t2v)
  --help                    Tampilkan pesan bantuan

Contoh:
  # Text-to-Video horizontal untuk YouTube dokumenter
  node cli.js t2v "cinematic dark vault with opened safe and scattered diamonds" -o ./vault.mp4 --ratio 16:9 --duration 4.0 --motion zoom-in

  # Text-to-Video vertikal untuk YouTube Shorts / TikTok
  node cli.js t2v "cursed ancient doll in dark dusty attic" -o ./doll.mp4 --ratio 9:16 --duration 3.5 --motion pan-right

  # Image-to-Video dari file gambar yang sudah ada
  node cli.js i2v ./photo.jpg -o ./photo_clip.mp4 --ratio 16:9 --duration 3.0 --motion drone-drift
`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  const inputTarget = args[1];
  let outputPath = null;
  let duration = 3.5;
  let ratio = '16:9';
  let motion = 'zoom-in';
  let fps = 30;
  let keepImage = false;

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-o' || arg === '--output') && args[i + 1]) {
      outputPath = args[++i];
    } else if ((arg === '-d' || arg === '--duration') && args[i + 1]) {
      duration = parseFloat(args[++i]);
    } else if ((arg === '-r' || arg === '--ratio') && args[i + 1]) {
      ratio = args[++i];
    } else if ((arg === '-m' || arg === '--motion') && args[i + 1]) {
      motion = args[++i];
    } else if (arg === '--fps' && args[i + 1]) {
      fps = parseInt(args[++i], 10);
    } else if (arg === '--keep-image') {
      keepImage = true;
    }
  }

  if (!inputTarget || !outputPath) {
    console.error('Error: Input target dan -o <output.mp4> wajib ditentukan!');
    printHelp();
    process.exit(1);
  }

  try {
    const start = Date.now();
    let res = null;

    if (cmd === 't2v') {
      console.log(`[T2V] Generating Text-to-Video...`);
      console.log(`- Prompt: "${inputTarget}"`);
      console.log(`- Ratio: ${ratio} | Motion: ${motion} | Durasi: ${duration}s`);
      res = await textToVideo(inputTarget, outputPath, {
        duration,
        ratio,
        motion,
        fps,
        keepImage
      });
    } else if (cmd === 'i2v') {
      console.log(`[I2V] Generating Image-to-Video...`);
      console.log(`- Input: ${inputTarget}`);
      console.log(`- Ratio: ${ratio} | Motion: ${motion} | Durasi: ${duration}s`);
      res = await imageToVideo(inputTarget, outputPath, {
        duration,
        ratio,
        motion,
        fps
      });
    } else {
      console.error(`Command tidak dikenal: "${cmd}". Gunakan 't2v' atau 'i2v'.`);
      process.exit(1);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`[Success] Video berhasil dibuat dalam ${elapsed}s!`);
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('[Error] Gagal membuat video:', err.message);
    process.exit(1);
  }
}

main();
