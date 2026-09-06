#!/usr/bin/env node

import { generateImage, generateFluxSchnell, generatePollinations, downloadImage } from './src/index.js';

function printHelp() {
  console.log(`
Text2Image Generator CLI (FLUX.1 Schnell + Pollinations Fallback)
Usage:
  node cli.js "<prompt>" [options]

Options:
  -o, --output <path>       Simpan gambar ke file tujuan (contoh: ./output.webp)
  -r, --ratio <ratio>       Aspect ratio: 16:9 (default), 9:16 (Shorts), 1:1, 4:3
  -p, --provider <name>     Provider: 'flux-schnell' (default) atau 'pollinations'
  -w, --width <num>         Custom width (pixel)
  -h, --height <num>        Custom height (pixel)
  -s, --seed <num>          Custom seed
  --help                    Tampilkan pesan bantuan ini

Contoh:
  node cli.js "cinematic dark vault with glowing diamonds" -o ./vault.webp --ratio 16:9
  node cli.js "creepy old abandoned classroom anime style" -o ./meme.jpg --ratio 9:16
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const prompt = args[0];
  let outputPath = null;
  let ratio = '16:9';
  let provider = 'flux-schnell';
  let width = null;
  let height = null;
  let seed = null;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-o' || arg === '--output') && args[i + 1]) {
      outputPath = args[++i];
    } else if ((arg === '-r' || arg === '--ratio') && args[i + 1]) {
      ratio = args[++i];
    } else if ((arg === '-p' || arg === '--provider') && args[i + 1]) {
      provider = args[++i];
    } else if ((arg === '-w' || arg === '--width') && args[i + 1]) {
      width = parseInt(args[++i], 10);
    } else if ((arg === '-h' || arg === '--height') && args[i + 1]) {
      height = parseInt(args[++i], 10);
    } else if ((arg === '-s' || arg === '--seed') && args[i + 1]) {
      seed = parseInt(args[++i], 10);
    }
  }

  console.log(`[Text2Image] Generating image...`);
  console.log(`- Prompt: "${prompt}"`);
  console.log(`- Provider: ${provider}`);
  console.log(`- Ratio: ${ratio} ${width && height ? `(${width}x${height})` : ''}`);

  try {
    const startTime = Date.now();
    const res = await generateImage(prompt, {
      ratio,
      width,
      height,
      provider,
      outputPath,
      seed
    });
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`[Success] Selesai dalam ${duration}s!`);
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error(`[Error] Gagal generate image:`, err.message);
    process.exit(1);
  }
}

main();
