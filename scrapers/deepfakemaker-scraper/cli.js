#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import {
  DeepFakeMaker,
  generateUUID64,
  buildQueryString,
  httpRequest,
} from './src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`
deepfakemaker-scraper - Zero-dependency CLI for deepfakemaker.io

Usage:
  node cli.js faceswap <source.jpg> <target.jpg> [--out result.jpg]
  node cli.js text2img "a cyberpunk cat" [--aspect 1:1] [--format png]
  node cli.js upload <file.jpg>
  node cli.js info

Examples:
  node cli.js faceswap face1.jpg face2.jpg
  node cli.js text2img "a cute anime girl, 8k" --aspect 9:16
`);
}

async function cmdInfo() {
  const auth = buildQueryString(DeepFakeMaker.generateAuthParams ? undefined : {});
  // Quick auth sanity check
  const auth2 = {};
  const now = new Date();
  const utcSeconds = Math.floor(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()
  ) / 1000);

  const nonce = generateUUID64().slice(0, 36);
  const aesKey = Math.random().toString(36).slice(2, 18);
  const encryptedKey = 'test';
  auth2.app_id = 'ai_df';
  auth2.t = utcSeconds;
  auth2.nonce = nonce;
  auth2.sign = 'test';
  auth2.secret_key = encryptedKey;

  console.log('DeepFakeMaker Scraper v1.0.0');
  console.log('Base URL:', 'https://apiv1.deepfakemaker.io/api');
  console.log('Auth: RSA + AES-128-CBC signature (zero login)');
  console.log('Endpoints available:');
  console.log('  - photo-face-swap');
  console.log('  - hd-face-swap');
  console.log('  - video-face-swap');
  console.log('  - text-to-image (KIE/Flux)');
  console.log('  - background-replace');
  console.log('  - clothes-remover');
  console.log('  - clothes-changer');
  console.log('  - upscaler');
  console.log('  - video-generate');
}

async function cmdFaceSwap(sourcePath, targetPath, opts = {}) {
  const dfm = new DeepFakeMaker({ debug: true });
  const swapBuf = fs.readFileSync(sourcePath);
  const targetBuf = fs.readFileSync(targetPath);

  const swapMime = sourcePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const targetMime = targetPath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  console.log(`Face swap: ${sourcePath} -> ${targetPath}`);
  const res = await dfm.photoFaceSwap(swapBuf, targetBuf, {
    swapFilename: path.basename(sourcePath),
    targetFilename: path.basename(targetPath),
    swapMime,
    targetMime,
    ...opts,
  });

  console.log('Job ID:', res.jobId);
  console.log('Submit:', JSON.stringify(res.submit, null, 2));
  if (res.resultUrl) {
    console.log('\nResult URL:', res.resultUrl);
    if (opts.out) {
      const outPath = path.resolve(opts.out);
      const urlObj = new URL(res.resultUrl);
      const outBuf = await new Promise((resolve, reject) => {
        https.get(urlObj, (r) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
      });
      fs.writeFileSync(outPath, outBuf);
      console.log('Saved to:', outPath);
    }
  } else {
    console.log('Poll:', JSON.stringify(res.poll, null, 2));
  }
}

async function cmdText2Img(prompt, opts = {}) {
  const dfm = new DeepFakeMaker({ debug: true });
  console.log(`Text2Img: "${prompt}"`);
  const res = await dfm.kieImageGen(prompt, {
    aspectRatio: opts.aspect || '1:1',
    format: opts.format || 'png',
  });

  console.log('Task ID:', res.taskId);
  console.log('Submit:', JSON.stringify(res.submit, null, 2));
  if (res.resultUrl) {
    console.log('\nResult URL:', res.resultUrl);
    if (opts.out) {
      const outPath = path.resolve(opts.out);
      const urlObj = new URL(res.resultUrl);
      const outBuf = await new Promise((resolve, reject) => {
        https.get(urlObj, (r) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
      });
      fs.writeFileSync(outPath, outBuf);
      console.log('Saved to:', outPath);
    }
  } else {
    console.log('Poll:', JSON.stringify(res.poll, null, 2));
  }
}

async function cmdUpload(filePath) {
  const dfm = new DeepFakeMaker({ debug: true });
  const buf = fs.readFileSync(filePath);
  const mime = filePath.endsWith('.png') ? 'image/png' : filePath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  console.log(`Upload: ${filePath} (${(buf.length / 1024).toFixed(1)} KB)`);
  const res = await dfm.uploadFile(buf, mime, path.basename(filePath));
  console.log('CDN URL:', res.cdnUrl);
  console.log('Object:', res.object_name);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    usage();
    process.exit(0);
  }

  try {
    switch (cmd) {
      case 'info':
        await cmdInfo();
        break;
      case 'faceswap':
        if (args.length < 3) { console.error('Usage: faceswap <source> <target> [--out file]'); process.exit(1); }
        const fsOpts = {};
        if (args[4] === '--out' && args[5]) fsOpts.out = args[5];
        await cmdFaceSwap(args[1], args[2], fsOpts);
        break;
      case 'text2img':
        if (args.length < 2) { console.error('Usage: text2img "prompt" [--aspect 9:16] [--format png] [--out file]'); process.exit(1); }
        const tOpts = {};
        for (let i = 2; i < args.length; i++) {
          if (args[i] === '--aspect' && args[i + 1]) { tOpts.aspect = args[++i]; }
          else if (args[i] === '--format' && args[i + 1]) { tOpts.format = args[++i]; }
          else if (args[i] === '--out' && args[i + 1]) { tOpts.out = args[++i]; }
        }
        await cmdText2Img(args[1], tOpts);
        break;
      case 'upload':
        if (args.length < 2) { console.error('Usage: upload <file>'); process.exit(1); }
        await cmdUpload(args[1]);
        break;
      default:
        console.error(`Unknown command: ${cmd}`);
        usage();
        process.exit(1);
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  }
}

main();
