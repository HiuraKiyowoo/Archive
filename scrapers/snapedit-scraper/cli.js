#!/usr/bin/env node

/**
 * CLI runner for snapedit-scraper
 */

import {
  generateClientToken,
  computeDeviceFingerprint,
  getUploadConfigs,
  initVideoUpload,
  enhanceVideo
} from './src/index.js';

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
snapedit-scraper CLI

Usage:
  node cli.js config                             Ambil batas upload config
  node cli.js token                              Generate client HMAC-SHA256 JWT
  node cli.js init-upload                        Inisialisasi task_id dan signed URL
  node cli.js enhance <file.mp4> [options]       Eksekusi full pipeline enhance video

Options:
  --token <firebase_token>    Firebase Authentication Token (jika login)
  --scale <FHD|2K>            Target zoom factor (default: FHD)
  --full                      Request full video enhance (PRO)
  --preview                   Request 5s preview enhance (default: true)
`);
}

async function main() {
  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  try {
    if (command === 'config') {
      const res = await getUploadConfigs();
      console.log(JSON.stringify(res, null, 2));
    } else if (command === 'token') {
      const token = generateClientToken();
      const fp = computeDeviceFingerprint();
      console.log(JSON.stringify({ token, fingerprint: fp }, null, 2));
    } else if (command === 'init-upload') {
      const res = await initVideoUpload();
      console.log(JSON.stringify(res, null, 2));
    } else if (command === 'enhance') {
      const filePath = args[1];
      if (!filePath) {
        console.error("Error: Path file video diperlukan. Contoh: node cli.js enhance sample.mp4");
        process.exit(1);
      }

      const tokenIdx = args.indexOf('--token');
      const firebaseToken = tokenIdx !== -1 ? args[tokenIdx + 1] : null;
      const scaleIdx = args.indexOf('--scale');
      const zoomFactor = scaleIdx !== -1 ? args[scaleIdx + 1] : 'FHD';
      const isPreview = !args.includes('--full');

      console.log(`Starting enhance for: ${filePath} (Scale: ${zoomFactor}, Preview: ${isPreview})`);
      const result = await enhanceVideo(filePath, {
        zoomFactor,
        isPreview,
        firebaseToken,
        onProgress: (p) => {
          console.log(`[${p.step}] ${p.message || JSON.stringify(p.status || '')}`);
        }
      });
      console.log("\nEnhance Selesai:");
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
    }
  } catch (err) {
    console.error("Execution Error:", err.message);
    process.exit(1);
  }
}

main();
