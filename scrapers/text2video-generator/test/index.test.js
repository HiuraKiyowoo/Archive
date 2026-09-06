import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { imageToVideo, textToVideo } from '../src/index.js';

describe('Text2Video & Image2Video Live Test Suite', () => {

  const dummyImage = '/tmp/test_src_image.png';

  test.before(async () => {
    // Siapkan dummy image jika belum ada
    const { spawn } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      const p = spawn('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=1920x1080:d=1',
        '-frames:v', '1', dummyImage
      ]);
      p.on('close', (code) => (code === 0 ? resolve() : reject()));
    });
  });

  test('imageToVideo() menghasilkan video MP4 16:9 dengan zoom-in motion', async () => {
    const outVideo = '/tmp/test_i2v_16_9.mp4';
    const res = await imageToVideo(dummyImage, outVideo, {
      duration: 2.0,
      ratio: '16:9',
      motion: 'zoom-in',
      fps: 30
    });

    assert.equal(res.success, true);
    assert.equal(res.resolution, '1920x1080');
    assert.equal(res.duration, 2.0);
    assert.ok(res.bytes > 1000, 'Video MP4 harus memiliki ukuran > 1KB');

    const stat = await fs.stat(outVideo);
    assert.ok(stat.size > 1000);
    await fs.unlink(outVideo).catch(() => {});
  });

  test('imageToVideo() menghasilkan video MP4 9:16 untuk YouTube Shorts/TikTok', async () => {
    const outVideo = '/tmp/test_i2v_9_16.mp4';
    const res = await imageToVideo(dummyImage, outVideo, {
      duration: 2.0,
      ratio: '9:16',
      motion: 'pan-right',
      fps: 30
    });

    assert.equal(res.success, true);
    assert.equal(res.resolution, '1080x1920');
    assert.ok(res.bytes > 1000);

    const stat = await fs.stat(outVideo);
    assert.ok(stat.size > 1000);
    await fs.unlink(outVideo).catch(() => {});
  });

  test('textToVideo() end-to-end: prompt -> AI visual -> video MP4', { timeout: 90000 }, async () => {
    const outVideo = '/tmp/test_t2v_output.mp4';
    const res = await textToVideo('cinematic futuristic bank safe vault with neon light', outVideo, {
      duration: 2.0,
      ratio: '16:9',
      motion: 'drone-drift'
    });

    assert.equal(res.success, true);
    assert.ok(res.imageProvider, 'Harus mencatat image provider (flux-schnell/pollinations)');
    assert.ok(res.bytes > 10000);

    const stat = await fs.stat(outVideo);
    assert.ok(stat.size > 10000);
    await fs.unlink(outVideo).catch(() => {});
  });

  test.after(async () => {
    await fs.unlink(dummyImage).catch(() => {});
  });

});
