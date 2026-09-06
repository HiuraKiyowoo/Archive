import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  generateFluxSchnell,
  generatePollinations,
  generateImage,
  downloadImage
} from '../src/index.js';

describe('Text2Image Multi-Provider Live Test Suite', () => {

  test('generatePollinations() mengembalikan URL valid', async () => {
    const res = await generatePollinations('a cute red apple on table', { width: 512, height: 512 });
    assert.equal(res.provider, 'pollinations');
    assert.equal(res.width, 512);
    assert.equal(res.height, 512);
    assert.ok(res.url.startsWith('https://image.pollinations.ai/prompt/'));
  });

  test('generateFluxSchnell() live inferensi ke HF Space menghasilkan gambar WebP', { timeout: 90000 }, async () => {
    const res = await generateFluxSchnell('cyberpunk samurai glowing katana 8k', {
      width: 1024,
      height: 576,
      steps: 4
    });
    assert.equal(res.provider, 'flux-schnell');
    assert.equal(res.width, 1024);
    assert.equal(res.height, 576);
    assert.ok(res.url.startsWith('https://black-forest-labs-flux-1-schnell.hf.space'));
  });

  test('generateImage() end-to-end auto-save ke disk', { timeout: 90000 }, async () => {
    const outPath = '/tmp/test_t2i_output.webp';
    const res = await generateImage('mysterious locked steel door in bank basement', {
      ratio: '16:9',
      outputPath: outPath
    });

    assert.ok(res.url);
    assert.equal(res.savedTo, outPath);
    assert.ok(res.bytes > 5000, 'Ukuran file gambar harus lebih dari 5KB');

    const stat = await fs.stat(outPath);
    assert.ok(stat.size > 5000, 'File fisik di disk harus ada dan ukurannya > 5KB');
    await fs.unlink(outPath).catch(() => {});
  });

  test('generateImage() mendukung aspect ratio 9:16 untuk YouTube Shorts/TikTok', async () => {
    const res = await generateImage('creepy dark hallway anime style', {
      ratio: '9:16',
      provider: 'pollinations'
    });
    assert.equal(res.width, 576);
    assert.equal(res.height, 1024);
  });

});
