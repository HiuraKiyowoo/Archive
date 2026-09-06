/**
 * Text2Image Multi-Provider Client & Generator
 * Providers:
 * 1. flux-schnell: Official Black Forest Labs FLUX.1-schnell Gradio Space (High quality GPU)
 * 2. pollinations: Pollinations.ai instant HTTP image endpoint (Fast fallback)
 *
 * Zero external dependencies (Pure Node.js 18+).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const HF_FLUX_SPACE = 'https://black-forest-labs-flux-1-schnell.hf.space';
const POLLINATIONS_URL = 'https://image.pollinations.ai/prompt';

const ASPECT_RATIOS = {
  '16:9': { width: 1024, height: 576 },
  '9:16': { width: 576, height: 1024 },
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 }
};

/**
 * Generate image via Black Forest Labs FLUX.1 Schnell Gradio Space
 * @param {string} prompt
 * @param {Object} opts { width, height, steps, seed }
 */
export async function generateFluxSchnell(prompt, opts = {}) {
  const width = opts.width || 1024;
  const height = opts.height || 576;
  const steps = opts.steps || 4;
  const seed = opts.seed || 0;
  const randomize = opts.seed === undefined;

  // 1. POST request untuk registrasi job ke Gradio v5
  const callRes = await fetch(`${HF_FLUX_SPACE}/gradio_api/call/infer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    },
    body: JSON.stringify({
      data: [prompt, seed, randomize, width, height, steps]
    })
  });

  if (!callRes.ok) {
    throw new Error(`FLUX Schnell Call Failed: ${callRes.status} ${callRes.statusText}`);
  }

  const callData = await callRes.json();
  const eventId = callData.event_id;
  if (!eventId) {
    throw new Error('Tidak mendapatkan event_id dari Gradio FLUX Schnell');
  }

  // 2. Listen SSE stream sampai event: complete
  const streamRes = await fetch(`${HF_FLUX_SPACE}/gradio_api/call/infer/${eventId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });

  if (!streamRes.ok) {
    throw new Error(`FLUX Schnell Stream Failed: ${streamRes.status}`);
  }

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop(); // simpan sisa potongan belum lengkap

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === 'event: complete') {
        const nextLine = (lines[i + 1] || '').trim();
        if (nextLine.startsWith('data:')) {
          const raw = JSON.parse(nextLine.replace(/^data:\s*/, ''));
          const imgObj = Array.isArray(raw) ? raw[0] : raw;
          const imgUrl = imgObj?.url || `${HF_FLUX_SPACE}/gradio_api/file=${imgObj?.path}`;
          const usedSeed = Array.isArray(raw) ? raw[1] : null;
          return {
            provider: 'flux-schnell',
            url: imgUrl,
            seed: usedSeed,
            width,
            height
          };
        }
      } else if (line === 'event: error') {
        const errLine = lines[i + 1] || '';
        throw new Error(`FLUX Schnell error event: ${errLine}`);
      }
    }
  }

  throw new Error('Stream FLUX Schnell selesai tanpa event complete');
}

/**
 * Generate image via Pollinations.ai (Instant HTTP direct stream)
 * @param {string} prompt
 * @param {Object} opts { width, height, seed, model }
 */
export async function generatePollinations(prompt, opts = {}) {
  const width = opts.width || 1024;
  const height = opts.height || 576;
  const model = opts.model || 'flux';
  const seed = opts.seed || Math.floor(Math.random() * 1000000);

  const encodedPrompt = encodeURIComponent(prompt);
  const url = `${POLLINATIONS_URL}/${encodedPrompt}?width=${width}&height=${height}&model=${model}&nologo=true&seed=${seed}`;

  return {
    provider: 'pollinations',
    url,
    seed,
    width,
    height
  };
}

/**
 * Download file gambar dari URL ke storage lokal
 * @param {string} url
 * @param {string} outputPath
 */
export async function downloadImage(url, outputPath) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!res.ok) {
    throw new Error(`Gagal download image: HTTP ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);
  return {
    path: outputPath,
    bytes: buffer.length
  };
}

/**
 * Unified smart generate: mencoba FLUX Schnell terlebih dahulu,
 * otomatis fallback ke Pollinations jika ada error atau timeout.
 * @param {string} prompt
 * @param {Object} opts { ratio, width, height, provider, outputPath, seed }
 */
export async function generateImage(prompt, opts = {}) {
  let { width, height } = opts;
  if (opts.ratio && ASPECT_RATIOS[opts.ratio]) {
    width = ASPECT_RATIOS[opts.ratio].width;
    height = ASPECT_RATIOS[opts.ratio].height;
  }
  width = width || 1024;
  height = height || 576;

  let result = null;
  const preferred = opts.provider || 'flux-schnell';

  if (preferred === 'flux-schnell') {
    try {
      result = await generateFluxSchnell(prompt, { width, height, seed: opts.seed });
    } catch (err) {
      console.warn(`[Warn] FLUX Schnell gagal (${err.message}). Beralih ke fallback Pollinations...`);
      result = await generatePollinations(prompt, { width, height, seed: opts.seed });
    }
  } else {
    result = await generatePollinations(prompt, { width, height, seed: opts.seed });
  }

  if (opts.outputPath) {
    const dl = await downloadImage(result.url, opts.outputPath);
    result.savedTo = dl.path;
    result.bytes = dl.bytes;
  }

  return result;
}
