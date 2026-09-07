#!/usr/bin/env node
import {
  MODELS,
  ASPECT_RATIOS,
  RESOLUTIONS,
  DEFAULT_MODEL,
  generateAndWait,
  generateImage,
  getRequest,
  getRequests,
  getCredits,
  uploadAsset,
  getGoogleAuthConfig,
} from './src/index.js';

const args = process.argv.slice(2);
const cmd = args[0];

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function usage() {
  console.log(`nanobananana — Nano Banana (Gemini image gen) direct API, tanpa extension
Base: https://nanobananana.com/api  |  auth: session cookie (env NBN_COOKIE)

Commands:
  info                          Model, aspect ratio, resolusi yang didukung
  credits                       Sisa kredit akun
  generate "prompt" [--model M] [--aspect 9:16] [--res 2K] [--n 2] [--wait]
                                Submit + (default) poll sampe jadi, cetak URL gambar
  request <requestId>           Status 1 request
  requests [--page N] [--size N]
  upload <file>                 Upload gambar -> asset id (untuk image-to-image)

Env:
  NBN_COOKIE=<cookie>   Copy dari browser (DevTools -> Network -> request /api/credits
                        -> header 'cookie'). Contoh ambil: DevTools Console: document.cookie
`);
}

function opt(name, dflt = undefined) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : dflt;
}

function cookie() {
  return process.env.NBN_COOKIE || null;
}

async function main() {
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      usage();
      return;
    case 'info': {
      const cfg = await getGoogleAuthConfig();
      console.log(JSON.stringify({
        source: 'nanobananana.com',
        command: 'info',
        ok: true,
        google_oauth_client_id: cfg.clientId,
        default_model: DEFAULT_MODEL,
        models: MODELS,
        aspect_ratios: ASPECT_RATIOS,
        resolutions: RESOLUTIONS,
      }, null, 2));
      return;
    }
    case 'credits': {
      if (!cookie()) die('Butuh NBN_COOKIE (lihat `nanobananana` / README).');
      const r = await getCredits(cookie());
      console.log(JSON.stringify({ source: 'nanobananana.com', command: 'credits', ok: true, totalRemaining: r.totalRemaining, raw: r.raw }, null, 2));
      return;
    }
    case 'generate': {
      if (!cookie()) die('Butuh NBN_COOKIE (lihat `nanobananana` / README).');
      const prompt = args[1];
      if (!prompt || prompt.startsWith('--')) die('generate butuh prompt. Contoh: nanobananana generate "cyberpunk cat" --aspect 9:16');
      const opts = {
        cookie: cookie(),
        model: opt('--model', DEFAULT_MODEL),
        aspectRatio: opt('--aspect', '1:1'),
        n: parseInt(opt('--n', '1'), 10),
      };
      const res = opt('--res');
      if (res) opts.resolution = res;
      const wait = args.includes('--wait') || !args.includes('--nowait');
      if (wait) {
        const r = await generateAndWait(prompt, opts);
        console.log(JSON.stringify({ source: 'nanobananana.com', command: 'generate', ok: r.status === 'completed', requestId: r.requestId, status: r.status, imageUrls: r.imageUrls }, null, 2));
      } else {
        const r = await generateImage(prompt, opts);
        console.log(JSON.stringify({ source: 'nanobananana.com', command: 'generate', ok: true, submitted: true, requestId: r.requestId, raw: r.raw }, null, 2));
      }
      return;
    }
    case 'request': {
      if (!cookie()) die('Butuh NBN_COOKIE.');
      const id = args[1];
      if (!id) die('request butuh requestId.');
      const r = await getRequest(cookie(), id);
      console.log(JSON.stringify({ source: 'nanobananana.com', command: 'request', ok: true, data: r }, null, 2));
      return;
    }
    case 'requests': {
      if (!cookie()) die('Butuh NBN_COOKIE.');
      const page = parseInt(opt('--page', '1'), 10);
      const size = parseInt(opt('--size', '20'), 10);
      const r = await getRequests(cookie(), { page, pageSize: size });
      console.log(JSON.stringify({ source: 'nanobananana.com', command: 'requests', ok: true, page: r.page, count: r.total, data: r.data }, null, 2));
      return;
    }
    case 'upload': {
      if (!cookie()) die('Butuh NBN_COOKIE.');
      const file = args[1];
      if (!file) die('upload butuh path file. Contoh: nanobananana upload ref.png');
      const r = await uploadAsset(cookie(), file);
      console.log(JSON.stringify({ source: 'nanobananana.com', command: 'upload', ok: true, assetId: r.assetId, url: r.url, raw: r.raw }, null, 2));
      return;
    }
    default:
      die(`Command tidak dikenal: ${cmd}`);
  }
}

main().catch((e) => {
  if (e.code === 'AUTH_REQUIRED') die(`⚠️  ${e.message}`);
  die(`❌ ${e.message}`);
});
